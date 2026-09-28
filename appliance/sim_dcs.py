"""Simulated Digital Cinema Server (DCS) for loopback testing.

Speaks real ST 430-10 over TCP: accepts the ACS connection, sends Announce
first (6.2), then drives a scripted session (Get New Lease, Set RPL
Location, Update Timeline ticks, Set Output Mode, Terminate Lease) and
verifies every ACS response — Request ID echo, status code, fixed 4-byte
BER lengths.

Also serves the RPL and timed-text files over HTTP so the appliance fetches
them for real through its normal fetch path.

This is a test harness, not a product. It is strict where the standard is
strict and records every response it sees for assertions.
"""

import http.server
import socket
import struct
import threading
import time

from .csp import (MESSAGES, STATUS, UL_TO_NAME, encode_message,
                  decode_response, encode_len4)
from .klv import KLVReader


def _u32(n):
    return struct.pack(">I", n)


def _u64(n):
    return struct.pack(">Q", n)


def _i64(n):
    return struct.pack(">q", n)


class _FileHandler(http.server.BaseHTTPRequestHandler):
    files = {}

    def do_GET(self):
        body = self.files.get(self.path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/xml")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


class SimDcs:
    """A fake cinema server. Use as a context manager or start()/stop()."""

    def __init__(self, rpl_template, files, lease_duration=30,
                 device_description="SimDCS 1.0 (loopback)"):
        # rpl_template: RPL XML with {BASE} where the HTTP base URL goes.
        # files: {"/path": "content"} served over HTTP.
        self.rpl_template = rpl_template
        self.extra_files = files
        self.lease_duration = lease_duration
        self.device_description = device_description
        self._next_rid = 1
        self.responses = []  # (resp_name, request_id, status_code, text)
        self._httpd = None
        self._tcp = None
        self._conn = None
        self.tcp_port = None
        self.http_port = None
        self.base_url = None

    # ------------------------------------------------------------ lifecycle
    def start(self):
        handler = type("_H", (_FileHandler,), {})
        self._httpd = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), handler)
        self.http_port = self._httpd.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.http_port}"
        handler.files = {"/rpl.xml":
                         self.rpl_template.replace("{BASE}", self.base_url)}
        handler.files.update(self.extra_files)
        threading.Thread(target=self._httpd.serve_forever,
                         daemon=True).start()

        self._tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._tcp.bind(("127.0.0.1", 0))
        self._tcp.listen(1)
        self.tcp_port = self._tcp.getsockname()[1]
        return self

    def stop(self):
        try:
            if self._conn:
                self._conn.close()
        finally:
            self._conn = None
        if self._tcp:
            self._tcp.close()
            self._tcp = None
        if self._httpd:
            self._httpd.shutdown()
            self._httpd = None

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()

    # ------------------------------------------------------------ wire i/o
    def accept(self, timeout=10.0):
        """Wait for the ACS to connect (6.1: the ACS initiates)."""
        self._tcp.settimeout(timeout)
        self._conn, _ = self._tcp.accept()
        self._conn.settimeout(timeout)

    def _send_request(self, name, payload, expect_code=0):
        rid = self._next_rid
        self._next_rid += 1
        b12, b13, _ = MESSAGES[name]
        self._conn.sendall(encode_message(b12, b13, payload))
        resp_name, request_id, code, text = self._read_response()
        assert request_id == rid, \
            f"{name}: ACS did not echo Request ID (sent {rid}, got {request_id})"
        assert code == expect_code, \
            f"{name}: expected status {expect_code}, got {code} ({text})"
        return resp_name, code, text

    def _read_response(self):
        reader = KLVReader()
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                chunk = self._conn.recv(65536)
            except socket.timeout:
                continue
            if not chunk:
                raise ConnectionError("ACS closed the connection")
            reader.feed(chunk)
            for key, value in reader.messages():
                name = UL_TO_NAME.get(key)
                assert name is not None and name.endswith("_resp"), \
                    f"ACS sent unexpected message: {key.hex()}"
                request_id, code, text, _ = decode_response(name, value)
                self.responses.append((name, request_id, code, text))
                return name, request_id, code, text
        raise TimeoutError("timed out waiting for ACS response")

    # ------------------------------------------------------------ script steps
    def send_announce(self):
        rid = self._next_rid
        payload = _u32(rid) + _i64(int(time.time())) \
            + self.device_description.encode()
        return self._send_request("announce_req", payload)

    def send_get_new_lease(self, duration=None):
        rid = self._next_rid
        payload = _u32(rid) + _u32(self.lease_duration
                                   if duration is None else duration)
        return self._send_request("get_new_lease_req", payload)

    def send_set_rpl_location(self, playout_id, path="/rpl.xml",
                              expect_code=0):
        rid = self._next_rid
        url = self.base_url + path
        payload = _u32(rid) + _u32(playout_id) + url.encode()
        return self._send_request("set_rpl_location_req", payload,
                                  expect_code=expect_code)

    def send_update_timeline(self, playout_id, position_units,
                             edit_rate_num=24, edit_rate_den=1,
                             expect_code=0):
        rid = self._next_rid
        payload = (_u32(rid) + _u32(playout_id) + _u64(position_units)
                   + _u64(edit_rate_num) + _u64(edit_rate_den) + _u32(0))
        return self._send_request("update_timeline_req", payload,
                                  expect_code=expect_code)

    def send_set_output_mode(self, enabled):
        rid = self._next_rid
        payload = _u32(rid) + bytes([1 if enabled else 0])
        return self._send_request("set_output_mode_req", payload)

    def send_get_status(self):
        # Annex B: while the RPL fetch is in flight the ACS answers
        # Processing (10); once loaded it answers Success (0).
        rid = self._next_rid
        self._next_rid += 1
        b12, b13, _ = MESSAGES["get_status_req"]
        self._conn.sendall(encode_message(b12, b13, _u32(rid)))
        resp_name, request_id, code, text = self._read_response()
        assert request_id == rid, \
            f"get_status_req: ACS did not echo Request ID"
        assert code in (STATUS["success"], STATUS["processing"]), \
            f"get_status_req: expected status 0/10, got {code} ({text})"
        return resp_name, code, text

    def poll_until_ready(self, timeout=10.0):
        """Annex B: after a Processing answer, poll Get Status until the ACS
        leaves 'fetching' (ready, empty, or playing). Returns the final
        state text."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            _, code, text = self.send_get_status()
            assert code in (STATUS["success"], STATUS["processing"]), \
                f"get_status: expected 0/10, got {code} ({text})"
            if "state=fetching" not in text:
                return text
            time.sleep(0.05)
        raise TimeoutError("ACS stayed in 'fetching' past poll timeout")

    def send_terminate_lease(self):
        rid = self._next_rid
        return self._send_request("terminate_lease_req", _u32(rid))

    def send_garbage(self, raw=b"\x00" * 16):
        """Send a non-protocol message; expect a Bad Request response."""
        self._conn.sendall(raw + encode_len4(3) + b"xyz")
        name, request_id, code, text = self._read_response()
        assert name == "bad_request_resp", f"expected bad_request_resp, got {name}"
        assert code == STATUS["invalid"], f"expected status 2, got {code}"
        return text

    # ------------------------------------------------------------ scripted run
    def run_session(self, steps):
        """Accept one ACS connection and run script steps.

        Steps: ("announce",), ("get_new_lease",), ("set_rpl_location", pid[, expect]),
        ("poll_until_ready",),
        ("update_timeline", pid, pos[, num, den[, expect]]),
        ("set_output_mode", bool), ("garbage",), ("sleep", s),
        ("terminate_lease",).
        """
        self.accept()
        try:
            for step in steps:
                op = step[0]
                if op == "announce":
                    self.send_announce()
                elif op == "get_new_lease":
                    self.send_get_new_lease()
                elif op == "set_rpl_location":
                    pid = step[1]
                    expect = step[2] if len(step) > 2 else 0
                    self.send_set_rpl_location(pid, expect_code=expect)
                elif op == "poll_until_ready":
                    self.poll_until_ready()
                elif op == "update_timeline":
                    _, pid, pos = step[0], step[1], step[2]
                    num = step[3] if len(step) > 3 else 24
                    den = step[4] if len(step) > 4 else 1
                    expect = step[5] if len(step) > 5 else 0
                    self.send_update_timeline(pid, pos, num, den,
                                              expect_code=expect)
                elif op == "set_output_mode":
                    self.send_set_output_mode(step[1])
                elif op == "garbage":
                    self.send_garbage()
                elif op == "sleep":
                    time.sleep(step[1])
                elif op == "terminate_lease":
                    self.send_terminate_lease()
                else:
                    raise ValueError(f"unknown step {op}")
        finally:
            try:
                self._conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self._conn.close()
            self._conn = None
