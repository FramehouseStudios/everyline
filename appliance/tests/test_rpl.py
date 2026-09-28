import os
import unittest

from appliance.rpl import parse_rpl, normalize_language

FIX = os.path.join(os.path.dirname(__file__), "..", "fixtures", "rpl.xml")


class TestRpl(unittest.TestCase):
    def test_parse_languages(self):
        doc = parse_rpl(open(FIX).read())
        self.assertEqual(sorted(r.language for r in doc.resources), ["en", "en", "es"])

    def test_playout_id(self):
        doc = parse_rpl(open(FIX).read())
        self.assertEqual(doc.playout_id, 424242)

    def test_english_normalized_with_warning(self):
        doc = parse_rpl(open(FIX).read())
        self.assertTrue(any("English" in w for w in doc.warnings))

    def test_empty_resource_skipped_with_warning(self):
        doc = parse_rpl(open(FIX).read())
        self.assertTrue(any("no ResourceFile" in w for w in doc.warnings))
        self.assertTrue(all(r.url for r in doc.resources))

    def test_edit_units_converted_via_edit_rate(self):
        # 24 fps: Duration 129600 edit units = 5400 s = 5400000 ms.
        doc = parse_rpl(open(FIX).read())
        en = [r for r in doc.resources if r.language == "en"][0]
        self.assertEqual(en.url, "http://dcs.local/captions/feature_en.xml")
        self.assertEqual(en.duration_ms, 5400000)
        self.assertEqual(en.entry_point_ms, 0)

    def test_entry_point_offset_in_edit_units(self):
        # es: EntryPoint 24000 @24fps = 1000 s into the show.
        doc = parse_rpl(open(FIX).read())
        es = [r for r in doc.resources if r.language == "es"][0]
        self.assertEqual(es.entry_point_ms, 1000000)
        self.assertEqual(es.duration_ms, 4400000)  # 105600 / 24

    def test_missing_duration_defaults_to_intrinsic_minus_entry(self):
        doc = parse_rpl(open(FIX).read())
        en2 = [r for r in doc.resources
               if r.url.endswith("feature_en2.xml")][0]
        self.assertEqual(en2.duration_ms, 5400000)  # (129600-0)/24 s

    def test_missing_edit_rate_warns_and_falls_back(self):
        xml = """<ResourcePresentationList xmlns="http://x">
          <ReelResources ReelID="urn:uuid:1" TimelineOffset="5000">
            <ReelResource Id="urn:uuid:2" ResourceType="ClosedCaption"
                          Language="en" IntrinsicDuration="9000">
              <ResourceFile>http://dcs.local/x.xml</ResourceFile>
            </ReelResource>
          </ReelResources>
        </ResourcePresentationList>"""
        doc = parse_rpl(xml)
        self.assertTrue(any("EditRate" in w for w in doc.warnings))
        self.assertEqual(doc.resources[0].entry_point_ms, 5000)

    def test_normalize_language(self):
        self.assertEqual(normalize_language("English"), "en")
        self.assertEqual(normalize_language("ES"), "es")
        self.assertEqual(normalize_language("en-US"), "en")
        self.assertEqual(normalize_language(""), "und")

    def test_invalid_xml(self):
        with self.assertRaises(ValueError):
            parse_rpl("<not xml")


if __name__ == "__main__":
    unittest.main()
