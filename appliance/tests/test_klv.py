import unittest

from appliance.klv import (
    KEY_LEN, Incomplete, KLVReader,
    decode_ber_length, encode_ber_length, encode_klv,
)

KEY = bytes(range(16))


class TestBerLength(unittest.TestCase):
    def test_short_form(self):
        self.assertEqual(encode_ber_length(0), b"\x00")
        self.assertEqual(encode_ber_length(127), b"\x7f")

    def test_long_form(self):
        self.assertEqual(encode_ber_length(128), b"\x81\x80")
        enc = encode_ber_length(1000)
        self.assertEqual(decode_ber_length(enc), (1000, 3))

    def test_truncated_raises_incomplete(self):
        with self.assertRaises(Incomplete):
            decode_ber_length(b"\x82\x01", 0)


class TestKLVReader(unittest.TestCase):
    def test_round_trip(self):
        r = KLVReader()
        r.feed(encode_klv(KEY, b"hello"))
        self.assertEqual(r.messages(), [(KEY, b"hello")])

    def test_long_value(self):
        v = bytes(300)
        r = KLVReader()
        r.feed(encode_klv(KEY, v))
        msgs = r.messages()
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0][1], v)

    def test_split_tcp_feed(self):
        pkt = encode_klv(KEY, b"split-me")
        r = KLVReader()
        r.feed(pkt[:5])
        self.assertEqual(r.messages(), [])
        r.feed(pkt[5:])
        self.assertEqual(r.messages(), [(KEY, b"split-me")])

    def test_two_messages_one_feed(self):
        r = KLVReader()
        r.feed(encode_klv(KEY, b"a") + encode_klv(KEY, b"b"))
        self.assertEqual([m[1] for m in r.messages()], [b"a", b"b"])

    def test_bad_key_length(self):
        with self.assertRaises(ValueError):
            encode_klv(b"short", b"x")


if __name__ == "__main__":
    unittest.main()
