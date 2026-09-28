"""Loopback integration: the real CspClient talks to the simulated DCS
over a real TCP socket, fetching the RPL and timed-text over real HTTP.

This is the closest we get to a cinema server without bench hardware:
every byte on the wire is real ST 430-10.
"""

import os
import threading
import time
import unittest
import urllib.request

from appliance.csp import CspClient
from appliance.scheduler import CueScheduler
from appliance.sim_dcs import SimDcs

HERE = os.path.join(os.path.dirname(__file__), "..", "fixtures")


def http_fetch(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return r.read().decode("utf-8")


def rpl_template(playout_id="424242"):
    text = open(os.path.join(HERE, "rpl.xml")).read()
    text = text.replace("http://dcs.local", "{BASE}")
    return text.replace('PlayoutID="424242"', f'PlayoutID="{playout_id}"')


def caption_files():
    def read(name):
        return open(os.path.join(HERE, name)).read()
    return {
        "/captions/feature_en.xml": read("tt_4287.xml"),
        "/captions/feature_en2.xml": read("tt_4287.xml"),
        "/captions/feature_es.xml": read("tt_cinecanvas.xml"),
    }


class TestLoopback(unittest.TestCase):
    def _run(self, steps, template=None):
        sim = SimDcs(template or rpl_template(), caption_files()).start()
        self.addCleanup(sim.stop)
        client = CspClient(fetch=http_fetch,
                           scheduler=CueScheduler(lookahead_ms=750))
        client.connect("127.0.0.1", sim.tcp_port)

        errors = []

        def drive():
            try:
                sim.run_session(steps)
            except Exception as e:  # surface thread failures
                errors.append(e)

        t = threading.Thread(target=drive, daemon=True)
        t.start()
        deadline = time.time() + 25
        try:
            while t.is_alive() and time.time() < deadline:
                try:
                    client.pump()
                except ConnectionError:
                    break  # sim closed after its script
                time.sleep(0.005)
            for _ in range(200):  # drain anything left
                try:
                    if client.pump() == 0:
                        break
                except ConnectionError:
                    break
        finally:
            t.join(timeout=10)
        self.assertFalse(t.is_alive(), "simulator session thread hung")
        self.assertEqual(errors, [], f"simulator raised: {errors}")
        return client, sim

    def test_full_session_over_real_sockets(self):
        steps = [
            ("announce",),
            ("get_new_lease",),
            ("set_rpl_location", 424242),
            ("set_output_mode", True),
            ("update_timeline", 424242, 24),  # 24 units @24fps = 1000 ms
        ]
        client, sim = self._run(steps)

        # Every ACS response: Request ID echoed, status success, in order.
        self.assertEqual(
            [(r[1], r[2]) for r in sim.responses],
            [(1, 0), (2, 0), (3, 0), (4, 0), (5, 0)])
        self.assertEqual(
            [r[0] for r in sim.responses],
            ["announce_resp", "get_new_lease_resp", "set_rpl_location_resp",
             "set_output_mode_resp", "update_timeline_resp"])

        # Session state landed where the wire said it should.
        self.assertEqual(client.lease_seconds, 30)
        self.assertEqual(client.state, "playing")
        self.assertEqual(client.position_ms, 1000)
        self.assertEqual(sorted(client.cues_by_lang), ["en", "es"])
        self.assertEqual(len(client.cues_by_lang["en"]), 4)
        self.assertEqual(len(client.cues_by_lang["es"]), 2)

        # And the scheduler emits the right cue through the real path.
        msgs = client.scheduler.poll()
        en_now = [m for m in msgs if m["lang"] == "en"]
        self.assertTrue(any(m["startMs"] == 1000 for m in en_now),
                        f"expected the 1000ms en cue in {msgs}")
        # Spanish cues sit 1000 s in (EntryPoint 24000 @24fps); not due.
        self.assertFalse(any(m["lang"] == "es" for m in msgs))

    def test_terminate_lease_resets_over_wire(self):
        steps = [
            ("announce",),
            ("get_new_lease",),
            ("set_rpl_location", 424242),
            ("terminate_lease",),
        ]
        client, sim = self._run(steps)
        self.assertEqual(sim.responses[-1][0], "terminate_lease_resp")
        self.assertEqual(sim.responses[-1][2], 0)
        self.assertEqual(client.state, "idle")
        self.assertIsNone(client.playout_id)
        self.assertEqual(client.cues_by_lang, {})

    def test_playout_mismatch_answered_over_wire(self):
        steps = [
            ("announce",),
            ("get_new_lease",),
            ("set_rpl_location", 424242),
            ("update_timeline", 999, 100, 24, 1, 5),  # expect mismatch
        ]
        client, sim = self._run(steps)
        name, rid, code, _ = sim.responses[-1]
        self.assertEqual(name, "update_timeline_resp")
        self.assertEqual(code, 5)
        self.assertEqual(client.position_ms, 0)  # position untouched

    def test_bad_request_answered_over_wire(self):
        steps = [
            ("announce",),
            ("get_new_lease",),
            ("garbage",),
        ]
        client, sim = self._run(steps)
        name, _, code, _ = sim.responses[-1]
        self.assertEqual(name, "bad_request_resp")
        self.assertEqual(code, 2)

    def test_rpl_playout_mismatch_over_wire(self):
        steps = [
            ("announce",),
            ("get_new_lease",),
            ("set_rpl_location", 424242, 8),  # RPL says 999: expect rpl_error
        ]
        client, sim = self._run(steps, template=rpl_template("999"))
        name, _, code, text = sim.responses[-1]
        self.assertEqual(name, "set_rpl_location_resp")
        self.assertEqual(code, 8)  # rpl_error
        self.assertEqual(client.cues_by_lang, {})


if __name__ == "__main__":
    unittest.main()
