"""Tests for the ST 430-10:2010 CSP client: UL registry, codec round-trips,
and full sessions driven over the wire through a fake socket."""

import os
import struct
import unittest

from appliance.csp import (
    CspClient, MESSAGES, STATUS, UL_TO_NAME, ul_for, encode_message,
    encode_response, decode_request, decode_response, encode_len4,
    CspDecodeError, PORT, DEVICE_DESCRIPTION,
)
from appliance.klv import KLVReader
from appliance.scheduler import CueScheduler

HERE = os.path.join(os.path.dirname(__file__), "..", "fixtures")
RPL_URL = "http://dcs.local/rpl.xml"


def files():
    return {
        RPL_URL: open(os.path.join(HERE, "rpl.xml")).read(),
        "http://dcs.local/captions/feature_en.xml":
            open(os.path.join(HERE, "tt_4287.xml")).read(),
        "http://dcs.local/captions/feature_en2.xml":
            open(os.path.join(HERE, "tt_4287.xml")).read(),
        "http://dcs.local/captions/feature_es.xml":
            open(os.path.join(HERE, "tt_cinecanvas.xml")).read(),
    }


def client(files_map=None, **kw):
    fmap = files_map if files_map is not None else files()
    return CspClient(fetch=lambda url: fmap[url],
                     scheduler=CueScheduler(lookahead_ms=750), **kw)


def u32(n):
    return struct.pack(">I", n)


def u64(n):
    return struct.pack(">Q", n)


def i64(n):
    return struct.pack(">q", n)


def req(name, payload):
    b12, b13, _ = MESSAGES[name]
    return encode_message(b12, b13, payload)


def update_timeline_payload(rid, pid, pos, num=24, den=1, exts=()):
    p = u32(rid) + u32(pid) + u64(pos) + u64(num) + u64(den) + u32(len(exts))
    for key, val in exts:
        p += u32(key) + encode_len4(len(val)) + val
    return p


class FakeSocket:
    def __init__(self, inbound: bytes):
        self._in = bytearray(inbound)
        self.out = bytearray()

    def recv(self, n):
        if not self._in:
            raise BlockingIOError()
        chunk = bytes(self._in[:n])
        del self._in[:n]
        return chunk

    def sendall(self, data):
        self.out += data

    def close(self):
        pass

    def setblocking(self, flag):
        pass


def drain(out: bytes):
    """Parse raw response bytes -> [(name, request_id, code, text, extra)]."""
    r = KLVReader()
    r.feed(bytes(out))
    resps = []
    for key, value in r.messages():
        name = UL_TO_NAME[key]
        rid, code, text, extra = decode_response(name, value)
        resps.append((name, rid, code, text, extra))
    return resps


class TestUlRegistry(unittest.TestCase):
    def test_all_uls_distinct_and_well_formed(self):
        uls = [ul_for(b12, b13) for b12, b13, _ in MESSAGES.values()]
        self.assertEqual(len(set(uls)), len(MESSAGES))
        base = bytes([0x06, 0x0E, 0x2B, 0x34, 0x02, 0x05, 0x01, 0x01,
                      0x02, 0x07, 0x02])
        for ul in uls:
            self.assertEqual(len(ul), 16)
            self.assertEqual(ul[:11], base)
            self.assertEqual(ul[13:], b"\x00\x00\x00")

    def test_spot_check_annex_a_values(self):
        self.assertEqual(MESSAGES["announce_req"][:2], (0x02, 0x00))
        self.assertEqual(MESSAGES["announce_resp"][:2], (0x02, 0x01))
        self.assertEqual(MESSAGES["set_rpl_location_req"][:2], (0x02, 0x06))
        self.assertEqual(MESSAGES["update_timeline_req"][:2], (0x02, 0x0A))
        self.assertEqual(MESSAGES["terminate_lease_req"][:2], (0x02, 0x0C))
        self.assertEqual(MESSAGES["get_log_event_list_req"][:2], (0x02, 0x10))
        self.assertEqual(MESSAGES["bad_request_resp"][:2], (0x01, 0x01))

    def test_port(self):
        self.assertEqual(PORT, 4170)


class TestCodec(unittest.TestCase):
    def test_request_round_trips(self):
        cases = [
            ("announce_req", u32(1) + i64(1700000000) + "GDC SR-1000".encode(),
             {"current_time": 1700000000, "device_description": "GDC SR-1000"}),
            ("get_new_lease_req", u32(2) + u32(60), {"lease_duration": 60}),
            ("get_status_req", u32(3), {}),
            ("set_rpl_location_req", u32(4) + u32(424242) + b"http://x/rpl.xml",
             {"playout_id": 424242, "resource_url": "http://x/rpl.xml"}),
            ("set_output_mode_req", u32(5) + bytes([1]), {"enabled": True}),
            ("update_timeline_req",
             update_timeline_payload(6, 424242, 7200, 24, 1, [(0, b"\x01\x02")]),
             {"playout_id": 424242, "position": 7200, "edit_rate_num": 24,
              "edit_rate_den": 1, "extensions": [(0, b"\x01\x02")]}),
            ("terminate_lease_req", u32(7), {}),
            ("get_log_event_list_req", u32(8) + i64(100) + i64(200),
             {"time_start": 100, "time_stop": 200}),
            ("get_log_event_req", u32(9) + u32(42), {"event_id": 42}),
        ]
        for name, payload, want in cases:
            rid, fields = decode_request(name, payload)
            self.assertEqual(fields, want, name)

    def test_response_ids_and_codes_echo(self):
        plain = ["get_new_lease_resp", "get_status_resp",
                 "set_rpl_location_resp", "set_output_mode_resp",
                 "update_timeline_resp", "terminate_lease_resp"]
        for name in plain:
            rid = 41
            raw = encode_response(name, rid, STATUS["success"])
            rdr = KLVReader()
            rdr.feed(raw)
            [(key, value)] = rdr.messages()
            r2, code, _, _ = decode_response(name, value)
            self.assertEqual((r2, code), (rid, 0), name)
        # get_log_event_resp carries its payload
        raw = encode_response("get_log_event_resp", 9, STATUS["success"],
                              log_text="hello")
        rdr = KLVReader()
        rdr.feed(raw)
        [(key, value)] = rdr.messages()
        r2, code, _, extra = decode_response("get_log_event_resp", value)
        self.assertEqual((r2, code), (9, 0))
        self.assertEqual(extra["log_text"], "hello")
        # responses with payloads
        raw = encode_response("announce_resp", 7, STATUS["success"],
                              current_time=5, device_description="X")
        rdr = KLVReader()
        rdr.feed(raw)
        [(key, value)] = rdr.messages()
        r2, code, _, extra = decode_response("announce_resp", value)
        self.assertEqual((r2, code), (7, 0))
        self.assertEqual(extra["device_description"], "X")

    def test_announce_response_carries_device_description(self):
        raw = encode_response("announce_resp", 1, STATUS["success"],
                              current_time=1700000001,
                              device_description=DEVICE_DESCRIPTION)
        rdr = KLVReader()
        rdr.feed(raw)
        [(key, value)] = rdr.messages()
        rid, code, _, extra = decode_response("announce_resp", value)
        self.assertEqual(rid, 1)
        self.assertEqual(code, 0)
        self.assertEqual(extra["device_description"], DEVICE_DESCRIPTION)
        self.assertEqual(extra["current_time"], 1700000001)

    def test_log_event_list_batch(self):
        raw = encode_response("get_log_event_list_resp", 3, STATUS["success"],
                              event_ids=[7, 8, 9])
        rdr = KLVReader()
        rdr.feed(raw)
        [(key, value)] = rdr.messages()
        _, code, _, extra = decode_response("get_log_event_list_resp", value)
        self.assertEqual(code, 0)
        self.assertEqual(extra["event_ids"], [7, 8, 9])

    def test_truncated_request_raises(self):
        with self.assertRaises(CspDecodeError):
            decode_request("update_timeline_req", u32(1) + u32(2))
        with self.assertRaises(CspDecodeError):
            decode_request("get_status_req", b"\x00")  # short request id

    def test_zero_request_id_rejected(self):
        with self.assertRaises(CspDecodeError):
            decode_request("get_status_req", u32(0))


class TestSessionOverWire(unittest.TestCase):
    def full_session(self, c):
        c._sock = FakeSocket(b"".join([
            req("announce_req", u32(1) + i64(1700000000) + b"GDC SR-1000"),
            req("get_new_lease_req", u32(2) + u32(60)),
            req("set_rpl_location_req",
                u32(3) + u32(424242) + RPL_URL.encode()),
        ]))
        self.assertEqual(c.pump(), 3)
        first = drain(c._sock.out)
        # The RPL fetch runs on a background thread; a real DCS would poll
        # Get Status (Annex B). The harness just waits for it to land.
        self.assertTrue(c.join_fetch())
        c._sock = FakeSocket(b"".join([
            # 24 edit units @24fps = 1 s -> position 1000 ms
            req("update_timeline_req",
                update_timeline_payload(4, 424242, 24)),
            req("set_output_mode_req", u32(5) + bytes([1])),
            req("update_timeline_req",
                update_timeline_payload(6, 424242, 48)),
        ]))
        self.assertEqual(c.pump(), 3)
        return first + drain(c._sock.out)

    def test_full_session(self):
        c = client()
        resps = self.full_session(c)
        names = [r[0] for r in resps]
        self.assertEqual(names, [
            "announce_resp", "get_new_lease_resp", "set_rpl_location_resp",
            "update_timeline_resp", "set_output_mode_resp",
            "update_timeline_resp",
        ])
        # Set RPL Location answers Processing (Annex B); the rest are OK.
        self.assertEqual([code for _, _, code, _, _ in resps],
                         [0, 0, STATUS["processing"], 0, 0, 0])
        self.assertEqual([r[1] for r in resps], [1, 2, 3, 4, 5, 6])  # echoed
        self.assertEqual(c.lease_seconds, 60)
        self.assertEqual(c.state, "playing")
        # 48 edit units @24fps = 2 s
        self.assertEqual(c.position_ms, 2000)
        self.assertEqual(sorted(c.cues_by_lang.keys()), ["en", "es"])
        self.assertEqual(len(c.cues_by_lang["en"]), 4)
        # cue emission still works through the wire-driven session
        msgs = c.scheduler.poll()
        self.assertTrue(any(m["lang"] == "en" and m["startMs"] == 1000
                            for m in msgs))

    def test_playout_id_mismatch_on_timeline(self):
        c = client()
        self.full_session(c)
        wire = req("update_timeline_req", update_timeline_payload(9, 123, 999))
        c._sock = FakeSocket(wire)
        self.assertEqual(c.pump(), 1)
        [(name, rid, code, _, _)] = drain(c._sock.out)
        self.assertEqual(name, "update_timeline_resp")
        self.assertEqual(code, STATUS["playout_id_mismatch"])
        self.assertEqual(c.position_ms, 2000)  # unchanged

    def test_terminate_lease_resets_everything(self):
        c = client()
        self.full_session(c)
        c._sock = FakeSocket(req("terminate_lease_req", u32(9)))
        self.assertEqual(c.pump(), 1)
        [(name, _, code, _, _)] = drain(c._sock.out)
        self.assertEqual((name, code), ("terminate_lease_resp", 0))
        self.assertEqual(c.state, "idle")
        self.assertIsNone(c.playout_id)
        self.assertEqual(c.cues_by_lang, {})
        self.assertIsNone(c.scheduler.playout_id)

    def test_join_in_progress(self):
        # Timeline before RPL: stashed, answered Playout ID Mismatch (7.2.6),
        # applied when the RPL arrives.
        c = client()
        wire = b"".join([
            req("announce_req", u32(1) + i64(1) + b"DCS"),
            req("get_new_lease_req", u32(2) + u32(60)),
            req("update_timeline_req", update_timeline_payload(3, 424242, 2400)),
            req("set_rpl_location_req", u32(4) + u32(424242) + RPL_URL.encode()),
        ])
        c._sock = FakeSocket(wire)
        self.assertEqual(c.pump(), 4)
        self.assertTrue(c.join_fetch())
        resps = drain(c._sock.out)
        self.assertEqual(resps[2][2], STATUS["playout_id_mismatch"])
        self.assertEqual(resps[3][2], STATUS["processing"])
        # 2400 edit units @24fps = 100 s
        self.assertEqual(c.position_ms, 100000)

    def test_rpl_playout_id_mismatch(self):
        bad = files()
        bad[RPL_URL] = bad[RPL_URL].replace('PlayoutID="424242"',
                                            'PlayoutID="999"')
        c = client(files_map=bad)
        wire = b"".join([
            req("announce_req", u32(1) + i64(1) + b"DCS"),
            req("get_new_lease_req", u32(2) + u32(60)),
            req("set_rpl_location_req", u32(3) + u32(424242) + RPL_URL.encode()),
        ])
        c._sock = FakeSocket(wire)
        self.assertEqual(c.pump(), 3)
        self.assertTrue(c.join_fetch())
        resps = drain(c._sock.out)
        # Processing on the wire; the mismatch surfaces when the fetch lands.
        self.assertEqual(resps[2][2], STATUS["processing"])
        self.assertEqual(c.state, "empty")
        self.assertEqual(c.cues_by_lang, {})
        self.assertTrue(any("PlayoutID" in w for w in c.warnings))

    def test_relative_url_resolves_against_dcs_host(self):
        # The whole asset set lives on the DCS host: absolute URLs to any
        # other host are refused (SSRF guard), so the fixture is remapped.
        fmap = {url.replace("http://dcs.local", "http://10.0.1.9"):
                body.replace("http://dcs.local", "http://10.0.1.9")
                for url, body in files().items()}
        c = client(files_map=fmap)
        c._dcs_host = "10.0.1.9"
        wire = b"".join([
            req("announce_req", u32(1) + i64(1) + b"DCS"),
            req("get_new_lease_req", u32(2) + u32(60)),
            req("set_rpl_location_req", u32(3) + u32(424242) + b"/rpl.xml"),
        ])
        c._sock = FakeSocket(wire)
        self.assertEqual(c.pump(), 3)
        self.assertTrue(c.join_fetch())
        resps = drain(c._sock.out)
        self.assertEqual(resps[2][2], STATUS["processing"])
        self.assertEqual(c.rpl_url, "http://10.0.1.9/rpl.xml")
        self.assertEqual(sorted(c.cues_by_lang.keys()), ["en", "es"])

    def test_absolute_url_to_foreign_host_refused(self):
        c = client()
        c._dcs_host = "10.0.1.9"  # connected DCS
        wire = b"".join([
            req("announce_req", u32(1) + i64(1) + b"DCS"),
            req("get_new_lease_req", u32(2) + u32(60)),
            # RPL itself points off-host: refused before any fetch.
            req("set_rpl_location_req",
                u32(3) + u32(424242) + b"http://evil.example/rpl.xml"),
        ])
        c._sock = FakeSocket(wire)
        self.assertEqual(c.pump(), 3)
        resps = drain(c._sock.out)
        # Refused synchronously: no fetch thread is ever started.
        self.assertEqual(resps[2][2], STATUS["rpl_error"])
        self.assertEqual(c.state, "empty")
        self.assertIsNone(c._fetch_thread)
        self.assertTrue(any("not the DCS host" in w for w in c.warnings))

    def test_dead_rpl_url_gives_rpl_error(self):
        c = client(files_map={})
        c._sock = FakeSocket(b"".join([
            req("announce_req", u32(1) + i64(1) + b"DCS"),
            req("get_new_lease_req", u32(2) + u32(60)),
            req("set_rpl_location_req", u32(3) + u32(424242) + RPL_URL.encode()),
        ]))
        self.assertEqual(c.pump(), 3)
        self.assertTrue(c.join_fetch())
        resps = drain(c._sock.out)
        # Processing on the wire; the dead URL surfaces when the fetch lands.
        self.assertEqual(resps[2][2], STATUS["processing"])
        self.assertEqual(c.state, "empty")
        self.assertTrue(any("RPL fetch/parse failed" in w for w in c.warnings))

    def test_unknown_ul_gets_bad_request(self):
        c = client()
        wire = b"\x00" * 16 + encode_len4(3) + b"xyz"
        c._sock = FakeSocket(wire)
        self.assertEqual(c.pump(), 1)
        [(name, rid, code, _, extra)] = drain(c._sock.out)
        self.assertEqual(name, "bad_request_resp")
        self.assertEqual(code, STATUS["invalid"])
        self.assertTrue(extra["request_copy"].endswith(b"xyz"))

    def test_malformed_request_gets_bad_request(self):
        c = client()
        wire = req("update_timeline_req", u32(1) + u32(2))  # truncated
        c._sock = FakeSocket(wire)
        self.assertEqual(c.pump(), 1)
        [(name, _, code, _, _)] = drain(c._sock.out)
        self.assertEqual((name, code), ("bad_request_resp", STATUS["invalid"]))

    def test_status_and_log_events(self):
        c = client()
        self.full_session(c)
        c._sock = FakeSocket(b"".join([
            req("get_status_req", u32(20)),
            req("get_log_event_list_req", u32(21) + i64(0) + i64(9999999999)),
            req("get_log_event_req", u32(22) + u32(1)),
            req("get_log_event_req", u32(23) + u32(999999)),
        ]))
        self.assertEqual(c.pump(), 4)
        resps = drain(c._sock.out)
        self.assertEqual(resps[0][2], STATUS["success"])
        self.assertIn("state=playing", resps[0][3])
        self.assertGreater(len(resps[1][4]["event_ids"]), 0)
        self.assertEqual(resps[2][2], STATUS["success"])
        self.assertIn("announce", resps[2][4]["log_text"])
        self.assertEqual(resps[3][2], STATUS["failed"])

    def test_short_lease_warns(self):
        c = client()
        c._sock = FakeSocket(b"".join([
            req("announce_req", u32(1) + i64(1) + b"DCS"),
            req("get_new_lease_req", u32(2) + u32(5)),
        ]))
        self.assertEqual(c.pump(), 2)
        self.assertTrue(any("5s" in w for w in c.warnings))
        self.assertEqual(c.lease_seconds, 5)

    def test_request_before_lease_warns(self):
        c = client()
        c._sock = FakeSocket(
            req("get_status_req", u32(1)))
        self.assertEqual(c.pump(), 1)
        self.assertTrue(any("before Announce" in w for w in c.warnings))

    def test_zero_edit_rate_numerator_does_not_crash(self):
        c = client()
        self.full_session(c)
        wire = req("update_timeline_req",
                   update_timeline_payload(9, 424242, 48, 0, 1))
        c._sock = FakeSocket(wire)
        self.assertEqual(c.pump(), 1)
        [(name, _, code, _, _)] = drain(c._sock.out)
        self.assertEqual((name, code), ("update_timeline_resp",
                                        STATUS["success"]))
        self.assertEqual(c.position_ms, 2000)  # not advanced
        self.assertTrue(any("numerator" in w for w in c.warnings))

    def test_handler_crash_answered_as_bad_request(self):
        c = client()

        def boom(request_id):
            raise RuntimeError("simulated handler bug")
        c.on_get_status = boom
        c._sock = FakeSocket(req("get_status_req", u32(1)))
        self.assertEqual(c.pump(), 1)
        [(name, _, code, _, _)] = drain(c._sock.out)
        self.assertEqual((name, code), ("bad_request_resp",
                                        STATUS["invalid"]))
        self.assertTrue(any("handler failed" in w for w in c.warnings))

    def test_malformed_framing_drops_connection(self):
        c = client()
        key = bytes([0x06, 0x0E, 0x2B, 0x34, 0x02, 0x05, 0x01, 0x01,
                     0x02, 0x07, 0x02, 0x02, 0x00, 0x00, 0x00, 0x00])
        c._sock = FakeSocket(key + b"\x80" + b"junk")  # indefinite BER length
        with self.assertRaises(ConnectionError):
            c.pump()
        self.assertIsNone(c._sock)  # closed, not left half-open
        self.assertTrue(any("framing" in w for w in c.warnings))

    def test_clean_close_closes_socket(self):
        c = client()
        sock = FakeSocket(req("get_status_req", u32(1)))
        sock.recv = lambda n: b""  # clean FIN
        c._sock = sock
        with self.assertRaises(ConnectionError):
            c.pump()
        self.assertIsNone(c._sock)

    def test_lease_expiry_purges_session(self):
        now = [1000.0]
        c = client(clock=lambda: now[0])
        self.full_session(c)
        self.assertEqual(c.state, "playing")
        now[0] += 61  # past the 60 s lease, no renewal arrived
        c._sock = FakeSocket(b"")
        c.pump()
        self.assertEqual(c.state, "idle")
        self.assertEqual(c.cues_by_lang, {})
        self.assertIsNone(c.playout_id)
        self.assertTrue(any("lease expired" in w for w in c.warnings))

    def test_send_backpressure_buffers_and_retries(self):
        c = client()
        sock = FakeSocket(req("get_status_req", u32(1)))
        blocked = [True]
        orig_sendall = sock.sendall

        def flaky_sendall(data):
            if blocked[0]:
                raise BlockingIOError()
            orig_sendall(data)
        sock.sendall = flaky_sendall
        c._sock = sock
        self.assertEqual(c.pump(), 1)  # response buffered, not lost
        self.assertTrue(c._send_pending)
        blocked[0] = False
        self.assertEqual(c.pump(), 0)  # flush on the next pump
        self.assertFalse(c._send_pending)
        [(name, rid, code, _, _)] = drain(sock.out)
        self.assertEqual((name, rid, code), ("get_status_resp", 1, 0))

    def test_stale_fetch_result_discarded(self):
        c = client()
        c._sock = FakeSocket(b"".join([
            req("announce_req", u32(1) + i64(1) + b"DCS"),
            req("get_new_lease_req", u32(2) + u32(60)),
            req("set_rpl_location_req",
                u32(3) + u32(424242) + RPL_URL.encode()),
        ]))
        self.assertEqual(c.pump(), 3)
        # A terminate landing before the fetch completes kills the session;
        # the late fetch result must not resurrect it (generation guard).
        c._sock = FakeSocket(req("terminate_lease_req", u32(4)))
        self.assertEqual(c.pump(), 1)
        self.assertTrue(c.join_fetch())
        self.assertEqual(c.state, "idle")
        self.assertEqual(c.cues_by_lang, {})

    def test_event_log_is_capped(self):
        c = client()
        for i in range(25000):
            c.log_event(f"e{i}")
        self.assertLessEqual(len(c._events), 20000)
        # ...but the log-event query path still works.
        c._sock = FakeSocket(
            req("get_log_event_list_req", u32(1) + i64(0) + i64(9999999999)))
        self.assertEqual(c.pump(), 1)
        [(name, _, code, _, extra)] = drain(c._sock.out)
        self.assertEqual(code, 0)
        self.assertTrue(extra["event_ids"])


if __name__ == "__main__":
    unittest.main()
