"""SMPTE 430-10 CSP client: the booth appliance's conversation with the DCS.

Wire format implemented from SMPTE ST 430-10:2010, sections 6-7 and Annexes
A/B: KLV per ST 336, TCP port 4170, fixed 4-byte long-form BER lengths,
big-endian integers, Request_ID echoed in every response, synchronous
request/response pairs, 2 s ACS round-trip budget.

The normative PDFs live in research/vendor/ for reference. They are
(c) SMPTE, all rights reserved, and are NOT redistributed with this repo
(gitignored); the UL values and field layouts below are interoperability
facts implemented in our own code.

Session flow (Annex B):
  Announce -> Get New Lease -> Get Status -> Set RPL Location ->
  (Processing -> poll Get Status -> OK) -> Update Timeline ->
  Set Output Mode enabled -> Update Timeline ...

Join-in-progress: the DCS may send Update Timeline before Set RPL Location
when we connect mid-show. We stash the position and apply it once the RPL
is fetched. The stashed request is answered Playout ID Mismatch per 7.2.6;
the session recovers when the RPL arrives.
"""

import socket
import struct
import time
from dataclasses import replace as _dc_replace
from urllib.parse import urljoin

from .klv import KLVReader
from .rpl import parse_rpl
from .timedtext import parse_timed_text

# ---------------------------------------------------------------------------
# UL registry: ST 430-10:2010 Annex A. Common bytes 1-11, bytes 14-16 zero;
# bytes 12-13 identify the message (Table A.2).
# ---------------------------------------------------------------------------
_UL_BASE = bytes([0x06, 0x0E, 0x2B, 0x34, 0x02, 0x05, 0x01, 0x01,
                  0x02, 0x07, 0x02])


def ul_for(byte12: int, byte13: int) -> bytes:
    return _UL_BASE + bytes([byte12, byte13, 0x00, 0x00, 0x00])


# name -> (byte12, byte13, direction). Direction is DCS->ACS for requests,
# ACS->DCS for responses; the DCS initiates every RRP.
MESSAGES = {
    "announce_req":            (0x02, 0x00, "dcs->acs"),
    "announce_resp":           (0x02, 0x01, "acs->dcs"),
    "get_new_lease_req":       (0x02, 0x02, "dcs->acs"),
    "get_new_lease_resp":      (0x02, 0x03, "acs->dcs"),
    "get_status_req":          (0x02, 0x04, "dcs->acs"),
    "get_status_resp":         (0x02, 0x05, "acs->dcs"),
    "set_rpl_location_req":    (0x02, 0x06, "dcs->acs"),
    "set_rpl_location_resp":   (0x02, 0x07, "acs->dcs"),
    "set_output_mode_req":     (0x02, 0x08, "dcs->acs"),
    "set_output_mode_resp":    (0x02, 0x09, "acs->dcs"),
    "update_timeline_req":     (0x02, 0x0A, "dcs->acs"),
    "update_timeline_resp":    (0x02, 0x0B, "acs->dcs"),
    "terminate_lease_req":     (0x02, 0x0C, "dcs->acs"),
    "terminate_lease_resp":    (0x02, 0x0D, "acs->dcs"),
    "get_log_event_list_req":  (0x02, 0x10, "dcs->acs"),
    "get_log_event_list_resp": (0x02, 0x11, "acs->dcs"),
    "get_log_event_req":       (0x02, 0x12, "dcs->acs"),
    "get_log_event_resp":      (0x02, 0x13, "acs->dcs"),
    "bad_request_resp":        (0x01, 0x01, "acs->dcs"),
}

UL_TO_NAME = {ul_for(b12, b13): name for name, (b12, b13, _) in MESSAGES.items()}

# Status codes: 6.4.1.
STATUS = {
    "success": 0, "failed": 1, "invalid": 2, "busy": 3,
    "lease_timeout": 4, "playout_id_mismatch": 5, "general_error": 6,
    "recoverable": 7, "rpl_error": 8, "resource_error": 9, "processing": 10,
}

PORT = 4170
DEVICE_DESCRIPTION = "everyline booth appliance v0.1.0"


class CspDecodeError(ValueError):
    """A request arrived malformed; answer Bad Request Response (7.1)."""


# ---------------------------------------------------------------------------
# Codec. All integers big-endian (6.2). Lengths are fixed 4-byte long-form
# BER (6.1.2: value length 12 -> 0x83 0x00 0x00 0x0C; we always use the
# 4-byte form 0x84 <u32>).
# ---------------------------------------------------------------------------
def encode_len4(n: int) -> bytes:
    if not 0 <= n < 2 ** 32:
        raise ValueError("length out of range")
    return b"\x84" + struct.pack(">I", n)


def encode_message(byte12: int, byte13: int, payload: bytes) -> bytes:
    return ul_for(byte12, byte13) + encode_len4(len(payload)) + payload


def encode_status(code: int, text: str = "") -> bytes:
    raw = text.encode("utf-8")
    return bytes([code]) + encode_len4(len(raw)) + raw


class _Reader:
    def __init__(self, buf: bytes):
        self._b = buf
        self._o = 0

    def _take(self, n: int) -> bytes:
        if len(self._b) - self._o < n:
            raise CspDecodeError("truncated field")
        out = self._b[self._o:self._o + n]
        self._o += n
        return out

    def u8(self) -> int:
        return self._take(1)[0]

    def u32(self) -> int:
        return struct.unpack(">I", self._take(4))[0]

    def u64(self) -> int:
        return struct.unpack(">Q", self._take(8))[0]

    def i64(self) -> int:
        return struct.unpack(">q", self._take(8))[0]

    def bool8(self) -> bool:
        v = self.u8()
        if v not in (0, 1):
            raise CspDecodeError(f"boolean out of range: {v}")
        return bool(v)

    def len4(self) -> int:
        raw = self._take(5)
        if raw[0] != 0x84:
            raise CspDecodeError("expected fixed 4-byte BER length")
        return struct.unpack(">I", raw[1:])[0]

    def text_len4(self) -> str:
        n = self.len4()
        try:
            return self._take(n).decode("utf-8")
        except UnicodeDecodeError as e:
            raise CspDecodeError(f"bad utf-8: {e}")

    def text_rest(self) -> str:
        try:
            return self._b[self._o:].decode("utf-8")
        except UnicodeDecodeError as e:
            raise CspDecodeError(f"bad utf-8: {e}")
        finally:
            self._o = len(self._b)

    def status(self):
        code = self.u8()
        text = self.text_len4()
        return code, text

    def end(self):
        if self._o != len(self._b):
            raise CspDecodeError("trailing bytes after message")


def decode_request(name: str, value: bytes):
    """Return (request_id, fields dict). Raises CspDecodeError."""
    r = _Reader(value)
    request_id = r.u32()
    if request_id == 0:
        raise CspDecodeError("Request_ID must be non-zero")
    f = {}
    if name == "announce_req":
        f["current_time"] = r.i64()
        f["device_description"] = r.text_rest()
    elif name == "get_new_lease_req":
        f["lease_duration"] = r.u32()
        r.end()
    elif name == "get_status_req":
        r.end()
    elif name == "set_rpl_location_req":
        f["playout_id"] = r.u32()
        f["resource_url"] = r.text_rest()
    elif name == "set_output_mode_req":
        f["enabled"] = r.bool8()
        r.end()
    elif name == "update_timeline_req":
        f["playout_id"] = r.u32()
        f["position"] = r.u64()
        f["edit_rate_num"] = r.u64()
        f["edit_rate_den"] = r.u64()
        ext_count = r.u32()
        exts = []
        for _ in range(ext_count):
            key = r.u32()
            n = r.len4()
            exts.append((key, r._take(n)))
        f["extensions"] = exts
        r.end()
    elif name == "terminate_lease_req":
        r.end()
    elif name == "get_log_event_list_req":
        f["time_start"] = r.i64()
        f["time_stop"] = r.i64()
        r.end()
    elif name == "get_log_event_req":
        f["event_id"] = r.u32()
        r.end()
    else:
        raise CspDecodeError(f"not a request: {name}")
    return request_id, f


def encode_response(name: str, request_id: int, status_code: int,
                    status_text: str = "", **extra) -> bytes:
    b12, b13, _ = MESSAGES[name]
    p = struct.pack(">I", request_id)
    if name == "announce_resp":
        p += struct.pack(">q", extra["current_time"])
        desc = extra["device_description"].encode("utf-8")
        p += encode_len4(len(desc)) + desc
    elif name == "get_log_event_list_resp":
        ids = extra["event_ids"]
        p += struct.pack(">I", len(ids)) + encode_len4(4)
        for i in ids:
            p += struct.pack(">I", i)
    elif name == "get_log_event_resp":
        p += encode_len4(len(extra["log_text"].encode("utf-8")))
        p += extra["log_text"].encode("utf-8")
    elif name == "bad_request_resp":
        copy = extra["request_copy"]
        p = encode_len4(len(copy)) + copy
    elif name not in MESSAGES or not name.endswith("_resp"):
        raise ValueError(f"not a response: {name}")
    p += encode_status(status_code, status_text)
    return encode_message(b12, b13, p)


def decode_response(name: str, value: bytes):
    """Return (request_id, status_code, status_text, extra dict).

    Bad Request Response carries no Request ID field (7.1): it reports
    request_id 0 and returns the request copy under extra."""
    r = _Reader(value)
    extra = {}
    if name == "bad_request_resp":
        request_id = 0
        n = r.len4()
        extra["request_copy"] = r._take(n)
    else:
        request_id = r.u32()
    if name == "announce_resp":
        extra["current_time"] = r.i64()
        extra["device_description"] = r.text_len4()
    elif name == "get_log_event_list_resp":
        count = r.u32()
        item_len = r.len4()
        if item_len != 4:
            raise CspDecodeError("event id item length != 4")
        extra["event_ids"] = [r.u32() for _ in range(count)]
    elif name == "get_log_event_resp":
        extra["log_text"] = r.text_len4()
    code, text = r.status()
    r.end()
    return request_id, code, text, extra


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------
class CspClient:
    """CSP session for one cinema server. Drive via on_* handlers (tests,
    bench harness) or connect()/pump() for a live socket."""

    def __init__(self, fetch, scheduler, lease_seconds=60, clock=None):
        # fetch(url) -> str: HTTP GET of RPL / timed-text. Injected for tests.
        self.fetch = fetch
        self.scheduler = scheduler
        self.lease_seconds = lease_seconds
        self.clock = clock or time.monotonic
        self.sent_responses = []  # (resp_name, request_id, status_code)
        self.warnings = []
        self._sock = None
        self._dcs_host = None
        self._reader = KLVReader()
        self._events = []  # (event_id, epoch_s, text)
        self._next_event_id = 1
        self._announced = False
        self._reset_session()

    # ------------------------------------------------------------------ state
    def _reset_session(self):
        self.playout_id = None
        self.rpl_url = None
        self.cues_by_lang = {}
        self.output_enabled = False
        self.position_ms = 0
        self.edit_rate = (1, 1)
        self.state = "idle"  # idle|fetching|ready|playing|empty
        self.lease_deadline = None
        self.pending_timeline = None
        self.scheduler.reset()

    def log_event(self, text: str):
        self._events.append((self._next_event_id, int(time.time()), text))
        self._next_event_id += 1

    def _touch_lease(self):
        # 7.2.2: the lease timeout resets on every request received.
        self.lease_deadline = self.clock() + self.lease_seconds

    def lease_expired(self) -> bool:
        return self.lease_deadline is not None and self.clock() > self.lease_deadline

    def _respond(self, resp_name, request_id, status, text="", **extra):
        self.sent_responses.append((resp_name, request_id, STATUS[status]))
        self.log_event(f"{resp_name} req={request_id} status={status}")
        return encode_response(resp_name, request_id, STATUS[status], text, **extra)

    def _check_playout(self, playout_id: int) -> bool:
        if playout_id != self.playout_id:
            self.warnings.append(
                f"playout-id mismatch (got {playout_id}, want {self.playout_id}); "
                "discarding per 7.2.6.1")
            return False
        return True

    def _resolve_url(self, url: str) -> str:
        # 7.2.4: a relative URL assumes HTTP and the DCS's IP as host.
        if url.startswith(("http://", "https://")):
            return url
        if not self._dcs_host:
            raise ValueError(f"relative RPL URL {url!r} with no DCS host known")
        return f"http://{self._dcs_host}/{url.lstrip('/')}"

    # ------------------------------------------------------- DCS -> ACS handlers
    def on_announce(self, request_id: int, current_time: int,
                    device_description: str):
        self._announced = True
        self.log_event(f"announce from {device_description!r}")
        self._touch_lease()
        return self._respond("announce_resp", request_id, "success",
                             current_time=int(time.time()),
                             device_description=DEVICE_DESCRIPTION)

    def on_get_new_lease(self, request_id: int, lease_duration: int):
        # 7.2.2: the DCS dictates the lease; renewal cadence is lease/2.
        # Some servers request 5 s (fragile: any delay wipes the session).
        if lease_duration <= 5:
            self.warnings.append(
                f"lease of {lease_duration}s requested; 5 s leases expire on any "
                "slight delay and wipe the session")
        self.lease_seconds = lease_duration
        self._touch_lease()
        self.log_event(f"new lease: {lease_duration}s")
        return self._respond("get_new_lease_resp", request_id, "success")

    def on_get_status(self, request_id: int):
        # Doubles as lease keepalive (7.2.3). While resources are still being
        # fetched we answer Processing; the DCS polls until OK (Annex B).
        status = "processing" if self.state == "fetching" else "success"
        return self._respond("get_status_resp", request_id, status,
                             text=f"state={self.state}")

    def on_set_rpl_location(self, request_id: int, playout_id: int,
                            resource_url: str):
        # A new RPL location always starts a new session, even if the playout
        # ID was seen before. Preserve a stashed join-in-progress timeline
        # across the reset.
        pending = self.pending_timeline
        self._reset_session()
        self.pending_timeline = pending
        self.playout_id = playout_id
        try:
            self.rpl_url = self._resolve_url(resource_url)
        except ValueError as e:
            self.warnings.append(str(e))
            self.state = "empty"
            return self._respond("set_rpl_location_resp", request_id,
                                 "rpl_error", text=str(e))
        self.state = "fetching"

        try:
            doc = parse_rpl(self.fetch(self.rpl_url))
        except Exception as e:
            self.warnings.append(f"RPL fetch/parse failed ({e}); no captions")
            self.state = "empty"
            return self._respond("set_rpl_location_resp", request_id,
                                 "rpl_error", text=str(e)[:200])

        # 7.2.4: verify the RPL's PlayoutID matches the request's.
        if doc.playout_id is not None and doc.playout_id != playout_id:
            self.warnings.append(
                f"RPL PlayoutID {doc.playout_id} != request {playout_id}")
            self.state = "empty"
            return self._respond("set_rpl_location_resp", request_id,
                                 "rpl_error", text="playout id mismatch")

        cues = {}
        for res in doc.resources:
            try:
                url = res.url if res.url.startswith(("http://", "https://")) \
                    else urljoin(rpl_url.rstrip("/") + "/", res.url)
                parsed = parse_timed_text(self.fetch(url), res.language)
            except Exception as e:
                self.warnings.append(f"timed-text fetch/parse failed for "
                                     f"{res.language} ({e}); language skipped")
                continue
            # entry_point_ms is already show-relative: the reel's
            # TimelineOffset (show offset) plus the resource EntryPoint,
            # both converted from edit units via the reel's EditRate.
            offset = res.entry_point_ms
            shifted = [_dc_replace(c, start_ms=c.start_ms + offset,
                                   end_ms=c.end_ms + offset)
                       for c in parsed]
            cues.setdefault(res.language, []).extend(shifted)
        for lang in cues:
            cues[lang].sort(key=lambda c: c.start_ms)
        self.cues_by_lang = cues
        self.warnings.extend(doc.warnings)
        self.scheduler.load(cues, playout_id)
        self.log_event(f"RPL loaded: {sorted(cues)} from {self.rpl_url}")

        # Join-in-progress: a timeline arrived before the RPL did.
        if self.pending_timeline is not None:
            req_id, pid, pos, num, den = self.pending_timeline
            self.pending_timeline = None
            self._apply_timeline(req_id, pid, pos, num, den)

        self.state = "ready" if cues else "empty"
        if not cues:
            return self._respond("set_rpl_location_resp", request_id,
                                 "resource_error",
                                 text="no caption resources survived")
        return self._respond("set_rpl_location_resp", request_id, "success")

    def on_set_output_mode(self, request_id: int, enabled: bool):
        # Some servers never send this (bench note); output then stays off
        # until the first Enabled arrives.
        self.output_enabled = bool(enabled)
        self.scheduler.set_transport(playing=self.output_enabled,
                                     position_ms=self.position_ms,
                                     playout_id=self.playout_id)
        self.state = "playing" if self.output_enabled else "ready"
        self.log_event(f"output {'enabled' if enabled else 'disabled'}")
        return self._respond("set_output_mode_resp", request_id, "success")

    def _apply_timeline(self, request_id, playout_id, position_units,
                        edit_rate_num, edit_rate_den):
        """Convert edit units -> ms and drive the scheduler. Returns status."""
        if self.playout_id is None or not self._check_playout(playout_id):
            return "playout_id_mismatch"
        if edit_rate_den == 0:
            self.warnings.append("Update Timeline with edit-rate denominator 0; "
                                 "position not advanced")
            return "success"
        self.edit_rate = (edit_rate_num, edit_rate_den)
        # 7.2.6.3: edit units -> seconds via the rational edit rate.
        self.position_ms = position_units * 1000 * edit_rate_den // edit_rate_num
        self.scheduler.set_transport(playing=self.output_enabled,
                                     position_ms=self.position_ms,
                                     playout_id=self.playout_id)
        return "success"

    def on_update_timeline(self, request_id: int, playout_id: int,
                           position: int, edit_rate_num: int,
                           edit_rate_den: int, extensions: list):
        # 7.2.6: position is edit units since playout start, not ms. Minimum
        # cadence is 1/min; the DCS is the clock between updates.
        if extensions:
            self.warnings.append(
                f"ignoring {len(extensions)} timeline extension(s) in v1")
        if self.playout_id is None:
            # Timeline before RPL on mid-show connect: stash it, answer
            # Playout ID Mismatch per 7.2.6, recover when the RPL arrives.
            self.pending_timeline = (request_id, playout_id, position,
                                     edit_rate_num, edit_rate_den)
            return self._respond("update_timeline_resp", request_id,
                                 "playout_id_mismatch",
                                 text="no RPL yet; timeline stashed")
        if self.state == "fetching":
            return self._respond("update_timeline_resp", request_id,
                                 "processing")
        status = self._apply_timeline(request_id, playout_id, position,
                                      edit_rate_num, edit_rate_den)
        return self._respond("update_timeline_resp", request_id, status)

    def on_terminate_lease(self, request_id: int):
        # 7.2.7: request carries the Request ID only. Purge everything.
        self.log_event("terminate lease: session purged")
        self._reset_session()
        return self._respond("terminate_lease_resp", request_id, "success")

    def on_get_log_event_list(self, request_id: int, time_start: int,
                              time_stop: int):
        ids = [eid for eid, ts, _ in self._events if time_start <= ts <= time_stop]
        return self._respond("get_log_event_list_resp", request_id, "success",
                             event_ids=ids)

    def on_get_log_event(self, request_id: int, event_id: int):
        for eid, ts, text in self._events:
            if eid == event_id:
                return self._respond("get_log_event_resp", request_id,
                                     "success", log_text=f"{ts} {text}")
        return self._respond("get_log_event_resp", request_id, "failed",
                             text=f"no event {event_id}", log_text="")

    # ------------------------------------------------------------- wire pump
    _DISPATCH = {
        "announce_req": "on_announce",
        "get_new_lease_req": "on_get_new_lease",
        "get_status_req": "on_get_status",
        "set_rpl_location_req": "on_set_rpl_location",
        "set_output_mode_req": "on_set_output_mode",
        "update_timeline_req": "on_update_timeline",
        "terminate_lease_req": "on_terminate_lease",
        "get_log_event_list_req": "on_get_log_event_list",
        "get_log_event_req": "on_get_log_event",
    }

    def _bad_request(self, key: bytes, value: bytes, text: str) -> bytes:
        # 7.1: copy of the misunderstood request + status.
        copy = key + encode_len4(len(value)) + value
        self.sent_responses.append(("bad_request_resp", 0, STATUS["invalid"]))
        return encode_response("bad_request_resp", 0, STATUS["invalid"], text,
                               request_copy=copy)

    def handle_wire(self, key: bytes, value: bytes) -> bytes:
        """Decode one KLV message, dispatch, return the encoded response."""
        name = UL_TO_NAME.get(key)
        if name is None or not name.endswith("_req"):
            self.warnings.append(f"unknown or unexpected UL {key.hex()}")
            return self._bad_request(key, value, "unknown message")
        try:
            request_id, fields = decode_request(name, value)
        except CspDecodeError as e:
            self.warnings.append(f"malformed {name}: {e}")
            return self._bad_request(key, value, str(e)[:200])
        if name != "announce_req" and name != "get_new_lease_req" \
                and not self._announced:
            # 7.2.2: Get New Lease must precede any request but Announce.
            self.warnings.append(f"{name} before Announce/Get New Lease")
        self._touch_lease()  # 7.2.2: any request resets the lease timeout
        handler = getattr(self, self._DISPATCH[name])
        return handler(request_id, **fields)

    # ------------------------------------------------------------- live socket
    def connect(self, host: str, port: int = PORT, timeout: float = 5.0):
        """Open the TCP session to the DCS. The ACS initiates (6.1)."""
        self._dcs_host = host
        self._sock = socket.create_connection((host, port), timeout=timeout)
        self._sock.setblocking(False)

    def pump(self):
        """Read available bytes, decode KLV, dispatch each request and send
        its response. Returns the number of messages processed. RRP pairs
        are synchronous (6.3): one response per request, in order."""
        if self._sock is None:
            raise RuntimeError("not connected; call connect() first")
        try:
            data = self._sock.recv(65536)
        except BlockingIOError:
            return 0
        if not data:
            raise ConnectionError("DCS closed the connection")
        self._reader.feed(data)
        count = 0
        for key, value in self._reader.messages():
            self._sock.sendall(self.handle_wire(key, value))
            count += 1
        return count
