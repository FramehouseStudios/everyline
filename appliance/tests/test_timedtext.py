import os
import unittest

from appliance.timedtext import (
    parse_4287, parse_cinecanvas, parse_timecode, parse_timed_text,
)

HERE = os.path.join(os.path.dirname(__file__), "..", "fixtures")
F4287 = os.path.join(HERE, "tt_4287.xml")
FCC = os.path.join(HERE, "tt_cinecanvas.xml")


class TestTimecode(unittest.TestCase):
    def test_frames(self):
        self.assertEqual(parse_timecode("00:00:01:00", 24.0), 1000)
        self.assertEqual(parse_timecode("00:00:03:12", 24.0), 3500)

    def test_millis(self):
        self.assertEqual(parse_timecode("00:00:01.500"), 1500)

    def test_seconds(self):
        self.assertEqual(parse_timecode("12.5"), 12500)

    def test_garbage(self):
        with self.assertRaises(ValueError):
            parse_timecode("soon")


class Test4287(unittest.TestCase):
    def test_parse(self):
        cues = parse_timed_text(open(F4287).read(), "en")
        self.assertEqual(len(cues), 2)
        self.assertEqual((cues[0].start_ms, cues[0].end_ms), (1000, 3500))
        self.assertEqual(cues[0].text, "Did you hear that?")
        self.assertIn("Everyone laughed together", cues[1].text)

    def test_2010_namespace(self):
        xml = open(F4287).read().replace(
            "http://www.smptera.org/schemas/428-7/2014/DCST",
            "http://www.smptera.org/schemas/428-7/2010/DCST")
        cues = parse_4287(xml, "en")
        self.assertEqual(len(cues), 2)


class TestCineCanvas(unittest.TestCase):
    def test_ticks(self):
        cues = parse_timed_text(open(FCC).read(), "es")
        self.assertEqual(len(cues), 2)
        # 250 ticks * 4 ms, 750 ticks * 4 ms
        self.assertEqual((cues[0].start_ms, cues[0].end_ms), (1000, 3000))
        self.assertEqual(cues[0].text, "¿Oíste eso?")

    def test_timecode_form(self):
        cues = parse_cinecanvas(open(FCC).read(), "es")
        self.assertEqual((cues[1].start_ms, cues[1].end_ms), (4000, 6000))


class TestDetect(unittest.TestCase):
    def test_unknown_root(self):
        with self.assertRaises(ValueError):
            parse_timed_text("<Nope/>")


class TestRobustness(unittest.TestCase):
    def test_one_bad_cue_does_not_kill_track(self):
        xml = """<SubtitleReel EditRate="24">
          <Subtitle TimeIn="00:00:01:00" TimeOut="00:00:02:00">
            <Text>good</Text></Subtitle>
          <Subtitle TimeIn="bogus" TimeOut="00:00:04:00">
            <Text>bad</Text></Subtitle>
          <Subtitle TimeIn="00:00:05:00" TimeOut="00:00:06:00">
            <Text>also good</Text></Subtitle>
        </SubtitleReel>"""
        w = []
        cues = parse_4287(xml, "en", w)
        self.assertEqual([c.text for c in cues], ["good", "also good"])
        self.assertTrue(any("malformed cue" in x for x in w))

    def test_one_bad_cinecanvas_cue_skipped(self):
        xml = """<DCSubtitle>
          <Subtitle SpotNumber="1" TimeIn="250" TimeOut="750">
            <Text>good</Text></Subtitle>
          <Subtitle SpotNumber="2" TimeIn="zzz" TimeOut="999">
            <Text>bad</Text></Subtitle>
        </DCSubtitle>"""
        w = []
        cues = parse_timed_text(xml, "es", w)
        self.assertEqual(len(cues), 1)
        self.assertTrue(any("malformed cue" in x for x in w))

    def test_entity_declaration_refused(self):
        xml = """<?xml version="1.0"?>
        <!DOCTYPE lolz [<!ENTITY lol "lollollol">]>
        <SubtitleReel EditRate="24">
          <Subtitle TimeIn="00:00:01:00" TimeOut="00:00:02:00">
            <Text>&lol;</Text></Subtitle>
        </SubtitleReel>"""
        with self.assertRaises(ValueError):
            parse_timed_text(xml, "en")


if __name__ == "__main__":
    unittest.main()
