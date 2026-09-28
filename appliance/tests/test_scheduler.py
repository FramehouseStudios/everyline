import unittest

from appliance.scheduler import CueScheduler
from appliance.timedtext import Cue


def cues():
    return {
        "en": [Cue(1000, 2000, "one"), Cue(5000, 6000, "two")],
        "es": [Cue(1000, 2000, "uno")],
    }


class TestScheduler(unittest.TestCase):
    def test_lookahead_emits_early(self):
        s = CueScheduler(lookahead_ms=750)
        s.load(cues(), "p1")
        s.set_transport(playing=True, position_ms=300, playout_id="p1")
        msgs = s.poll()
        self.assertEqual({m["id"] for m in msgs}, {"en-0", "es-0"})
        # protocol v0 shape
        m = msgs[0]
        self.assertEqual(
            sorted(m.keys()),
            ["endMs", "id", "issuedAtMs", "lang", "startMs", "text", "type"])
        self.assertEqual(m["type"], "cue")

    def test_no_duplicates(self):
        s = CueScheduler()
        s.load(cues(), "p1")
        s.set_transport(playing=True, position_ms=300, playout_id="p1")
        s.poll()
        self.assertEqual(s.poll(), [])

    def test_pause_freezes(self):
        s = CueScheduler()
        s.load(cues(), "p1")
        s.set_transport(playing=True, position_ms=300, playout_id="p1")
        s.poll()
        s.set_transport(playing=False, position_ms=4800, playout_id="p1")
        self.assertEqual(s.poll(), [])

    def test_seek_back_reemits(self):
        s = CueScheduler()
        s.load(cues(), "p1")
        s.set_transport(playing=True, position_ms=300, playout_id="p1")
        s.poll()
        s.set_transport(playing=True, position_ms=1500, playout_id="p1")
        self.assertEqual(s.poll(), [])  # cue already visible; no re-emit
        s.set_transport(playing=True, position_ms=300, playout_id="p1")
        msgs = s.poll()
        self.assertEqual({m["id"] for m in msgs}, {"en-0", "es-0"})

    def test_playout_mismatch_discards(self):
        s = CueScheduler()
        s.load(cues(), "p1")
        s.set_transport(playing=True, position_ms=300, playout_id="p1")
        s.set_transport(playing=True, position_ms=300, playout_id="p2")
        self.assertEqual(s.poll(), [])
        self.assertIsNone(s.playout_id)

    def test_current_at(self):
        s = CueScheduler()
        s.load(cues(), "p1")
        cur = s.current_at(1500, "en")
        self.assertIsNotNone(cur)
        self.assertEqual(cur["text"], "one")
        self.assertIsNone(s.current_at(3000, "en"))
        self.assertIsNone(s.current_at(1500, "fr"))

    def test_languages(self):
        s = CueScheduler()
        s.load(cues(), "p1")
        self.assertEqual(s.languages(), ["en", "es"])


if __name__ == "__main__":
    unittest.main()
