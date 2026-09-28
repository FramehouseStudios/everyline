import os
import unittest

from appliance.csp import CspClient
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


class TestCspFlow(unittest.TestCase):
    def test_full_session(self):
        c = client()
        c.on_set_rpl_location("playout-1", RPL_URL)
        self.assertEqual(c.sent_statuses, [("playout-1", "ok")])
        self.assertEqual(c.state, "ready")
        self.assertEqual(sorted(c.cues_by_lang.keys()), ["en", "es"])
        # english got cues from both en resources
        self.assertEqual(len(c.cues_by_lang["en"]), 4)

        c.on_set_output_mode("playout-1", True)
        self.assertEqual(c.state, "playing")
        c.on_update_timeline("playout-1", 300)
        msgs = c.scheduler.poll()
        self.assertTrue(any(m["lang"] == "en" and m["startMs"] == 1000 for m in msgs))
        self.assertTrue(any(m["lang"] == "es" for m in msgs))

    def test_playout_mismatch_discarded(self):
        c = client()
        c.on_set_rpl_location("playout-1", RPL_URL)
        c.on_update_timeline("playout-OTHER", 99999)
        self.assertEqual(c.position_ms, 0)
        self.assertTrue(any("mismatch" in w for w in c.warnings))

    def test_terminate_lease_resets_everything(self):
        c = client()
        c.on_set_rpl_location("playout-1", RPL_URL)
        c.on_set_output_mode("playout-1", True)
        c.on_terminate_lease("playout-1")
        self.assertEqual(c.state, "idle")
        self.assertIsNone(c.playout_id)
        self.assertEqual(c.cues_by_lang, {})
        self.assertIsNone(c.scheduler.playout_id)

    def test_join_in_progress(self):
        # USL section 7: timeline can arrive before the RPL on mid-show connect.
        c = client()
        c.on_update_timeline("playout-9", 4500)
        self.assertEqual(c.state, "idle")  # nothing to apply to yet
        c.on_set_rpl_location("playout-9", RPL_URL)
        self.assertEqual(c.position_ms, 4500)

    def test_dead_rpl_url_gives_empty_ok(self):
        c = client(files_map={})
        c.on_set_rpl_location("playout-1", RPL_URL)
        self.assertEqual(c.state, "empty")
        self.assertEqual(c.sent_statuses, [("playout-1", "ok")])
        self.assertEqual(c.cues_by_lang, {})

    def test_pump_is_spec_gated(self):
        c = client()
        with self.assertRaises(NotImplementedError):
            c.pump()

    def test_short_lease_warns(self):
        c = client(lease_seconds=5)
        c.on_set_rpl_location("playout-1", RPL_URL)
        self.assertTrue(any("5s" in w or "5 s" in w for w in c.warnings))


if __name__ == "__main__":
    unittest.main()
