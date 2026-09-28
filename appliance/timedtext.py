"""Timed-text parsing: SMPTE ST 428-7 and Interop CineCanvas.

Both formats reduce to the same thing: a list of Cue(start_ms, end_ms, text).
Element shapes below are best-effort from public references (ST 428-7 samples,
CineCanvas-XML, DCP-o-matic behavior); conformance against real DCP assets
happens on bench hardware. Unknown shapes raise ValueError rather than
silently producing wrong timings: a wrong caption time is worse than none.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

NS_4287_2014 = "http://www.smptera.org/schemas/428-7/2014/DCST"
NS_4287_2010 = "http://www.smptera.org/schemas/428-7/2010/DCST"

TICKS_PER_MS_CINECANVAS = 0.25  # 1 tick = 4 ms


@dataclass
class Cue:
    start_ms: int
    end_ms: int
    text: str
    language: str = "en"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _guard_xml(xml_text: str):
    # ElementTree never resolves external entities, but internal entity
    # expansion (billion laughs) is a real DoS on network-sourced XML.
    # Both the RPL and timed-text arrive over the booth LAN; refuse any
    # document that declares entities.
    if "<!ENTITY" in xml_text.upper():
        raise ValueError("XML entity declarations are not allowed")


def parse_timecode(tc: str, edit_rate: float = 24.0) -> int:
    """Parse HH:MM:SS:FF (frames at edit_rate), HH:MM:SS.mmm, or plain seconds."""
    tc = tc.strip()
    m = re.fullmatch(r"(\d+):(\d{2}):(\d{2}):(\d{2})", tc)
    if m:
        h, mi, s, f = map(int, m.groups())
        return int(round(((h * 3600 + mi * 60 + s) + f / edit_rate) * 1000))
    m = re.fullmatch(r"(\d+):(\d{2}):(\d{2})[.,](\d{1,3})", tc)
    if m:
        h, mi, s, frac = m.groups()
        ms = int((frac + "000")[:3])
        return (int(h) * 3600 + int(mi) * 60 + int(s)) * 1000 + ms
    m = re.fullmatch(r"\d+(\.\d+)?", tc)
    if m:
        return int(round(float(tc) * 1000))
    raise ValueError(f"unrecognized timecode: {tc!r}")


def _texts(subtitle_el) -> str:
    parts = []
    for child in subtitle_el:
        if _local(child.tag) == "Text":
            t = "".join(child.itertext()).strip()
            if t:
                parts.append(t)
    if not parts:
        t = "".join(subtitle_el.itertext()).strip()
        if t:
            parts.append(t)
    return "\n".join(parts)


def parse_4287(xml_text: str, language: str = "en",
               warnings: list = None) -> list[Cue]:
    """SMPTE ST 428-7 (2010 and 2014 namespaces). One malformed cue is
    skipped with a warning; it never kills the whole language track."""
    _guard_xml(xml_text)
    root = ET.fromstring(xml_text)
    if _local(root.tag) != "SubtitleReel":
        raise ValueError(f"expected SubtitleReel, got {_local(root.tag)!r}")
    try:
        edit_rate = float(root.get("EditRate", "24"))
    except ValueError:
        edit_rate = 24.0
    cues = []
    for sub in root.iter():
        if _local(sub.tag) != "Subtitle":
            continue
        tin, tout = sub.get("TimeIn"), sub.get("TimeOut")
        if not tin or not tout:
            continue
        text = _texts(sub)
        if not text:
            continue
        try:
            start_ms = parse_timecode(tin, edit_rate)
            end_ms = parse_timecode(tout, edit_rate)
        except ValueError as e:
            if warnings is not None:
                warnings.append(f"skipping malformed cue "
                                f"({tin!r}->{tout!r}): {e}")
            continue
        cues.append(Cue(start_ms=start_ms, end_ms=end_ms,
                        text=text, language=language))
    cues.sort(key=lambda c: c.start_ms)
    return cues


def _cinecanvas_ms(value: str) -> int:
    v = value.strip()
    if re.fullmatch(r"\d+", v):
        return int(v) * 4  # ticks -> ms
    return parse_timecode(v)


def parse_cinecanvas(xml_text: str, language: str = "en",
                     warnings: list = None) -> list[Cue]:
    """Interop CineCanvas (DCSubtitle). Times are ticks (1 tick = 4 ms) or timecode.
    One malformed cue is skipped with a warning; it never kills the track."""
    _guard_xml(xml_text)
    root = ET.fromstring(xml_text)
    if _local(root.tag) != "DCSubtitle":
        raise ValueError(f"expected DCSubtitle, got {_local(root.tag)!r}")
    cues = []
    for sub in root.iter():
        if _local(sub.tag) != "Subtitle":
            continue
        tin, tout = sub.get("TimeIn"), sub.get("TimeOut")
        if not tin or not tout:
            continue
        text = _texts(sub)
        if not text:
            continue
        try:
            start_ms, end_ms = _cinecanvas_ms(tin), _cinecanvas_ms(tout)
        except ValueError as e:
            if warnings is not None:
                warnings.append(f"skipping malformed cue "
                                f"({tin!r}->{tout!r}): {e}")
            continue
        cues.append(Cue(start_ms=start_ms, end_ms=end_ms,
                        text=text, language=language))
    cues.sort(key=lambda c: c.start_ms)
    return cues


def parse_timed_text(xml_text: str, language: str = "en",
                     warnings: list = None) -> list[Cue]:
    """Auto-detect format by root element."""
    _guard_xml(xml_text)
    root = ET.fromstring(xml_text)
    name = _local(root.tag)
    if name == "SubtitleReel":
        return parse_4287(xml_text, language, warnings)
    if name == "DCSubtitle":
        return parse_cinecanvas(xml_text, language, warnings)
    raise ValueError(f"unrecognized timed-text root element: {name!r}")
