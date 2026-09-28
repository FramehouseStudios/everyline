"""KLV encode/decode per SMPTE ST 336 (generic encoding rules; public knowledge).

CSP (430-10) messages are KLV triplets: a 16-byte UL key identifying the
message type, a BER-encoded length, and the value bytes. This module handles
the framing only. Message-specific ULs and payload layouts live in csp.py.
"""

KEY_LEN = 16


class Incomplete(Exception):
    """More bytes needed; feed additional TCP data and retry."""


def encode_ber_length(n: int) -> bytes:
    if n < 0:
        raise ValueError("negative length")
    if n < 128:
        return bytes([n])
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    if len(raw) > 126:
        raise ValueError("length too large for BER long form")
    return bytes([0x80 | len(raw)]) + raw


def decode_ber_length(buf: bytes, off: int = 0):
    """Return (length, bytes_consumed). Raises Incomplete if truncated."""
    if len(buf) <= off:
        raise Incomplete()
    first = buf[off]
    if first < 128:
        return first, 1
    n = first & 0x7F
    if n == 0:
        raise ValueError("indefinite BER length not supported")
    if len(buf) < off + 1 + n:
        raise Incomplete()
    return int.from_bytes(buf[off + 1:off + 1 + n], "big"), 1 + n


def encode_klv(key: bytes, value: bytes) -> bytes:
    if len(key) != KEY_LEN:
        raise ValueError("KLV key must be 16 bytes")
    return key + encode_ber_length(len(value)) + value


class KLVReader:
    """Streaming decoder: feed() TCP bytes, then drain complete messages."""

    def __init__(self):
        self._buf = bytearray()

    def feed(self, data: bytes) -> None:
        self._buf += data

    def messages(self):
        """Yield (key, value) for each complete message buffered. Consumes them."""
        out = []
        while True:
            if len(self._buf) < KEY_LEN + 1:
                break
            try:
                length, lcon = decode_ber_length(bytes(self._buf), KEY_LEN)
            except Incomplete:
                break
            total = KEY_LEN + lcon + length
            if len(self._buf) < total:
                break
            key = bytes(self._buf[:KEY_LEN])
            value = bytes(self._buf[KEY_LEN + lcon:total])
            del self._buf[:total]
            out.append((key, value))
        return out
