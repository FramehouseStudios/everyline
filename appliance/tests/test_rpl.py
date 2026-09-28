import os
import unittest

from appliance.rpl import parse_rpl, normalize_language

FIX = os.path.join(os.path.dirname(__file__), "..", "fixtures", "rpl.xml")


class TestRpl(unittest.TestCase):
    def test_parse_languages(self):
        doc = parse_rpl(open(FIX).read())
        self.assertEqual(sorted(r.language for r in doc.resources), ["en", "en", "es"])

    def test_english_normalized_with_warning(self):
        doc = parse_rpl(open(FIX).read())
        self.assertTrue(any("English" in w for w in doc.warnings))

    def test_empty_resource_skipped_with_warning(self):
        doc = parse_rpl(open(FIX).read())
        self.assertTrue(any("no ResourceFile" in w for w in doc.warnings))
        self.assertTrue(all(r.url for r in doc.resources))

    def test_resource_fields(self):
        doc = parse_rpl(open(FIX).read())
        en = [r for r in doc.resources if r.language == "en"][0]
        self.assertEqual(en.url, "http://dcs.local/captions/feature_en.xml")
        self.assertEqual(en.duration_ms, 5400000)

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
