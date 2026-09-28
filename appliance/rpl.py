"""SMPTE 430-11 RPL (Auxiliary Resource Presentation List) parsing.

Best-effort from the public 430-11 sample (ReelResources / ReelResource /
TimelineOffset structure). Element and attribute names will be conformed
against the licensed standard before bench testing. Parsing is defensive
throughout: the field notes (USL) document dead URLs, empty resources, and
nonstandard language codes in the wild.
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

# The standard wants RFC 3066 / ISO 639 codes; the wild sends display names.
LANGUAGE_ALIASES = {
    "english": "en", "spanish": "es", "french": "fr", "german": "de",
    "italian": "it", "portuguese": "pt", "dutch": "nl", "japanese": "ja",
    "chinese": "zh", "korean": "ko", "arabic": "ar", "hindi": "hi",
}


def normalize_language(code) -> str:
    if not code:
        return "und"
    c = str(code).strip()
    if len(c) == 2:
        return c.lower()
    aliased = LANGUAGE_ALIASES.get(c.lower())
    if aliased:
        return aliased
    # "en-US" -> "en"; anything else passes through lowercased, flagged by caller
    return c.split("-")[0].split("_")[0].lower() or "und"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _ms(value) -> int:
    """SPEC-ASSUMPTION: bare integers in the RPL are milliseconds.

    The public sample does not pin the unit; conform against the licensed
    430-11 before bench testing. Timecode strings are also accepted.
    """
    v = str(value).strip()
    if ":" in v:
        from .timedtext import parse_timecode  # local import, same package
        return parse_timecode(v)
    return int(float(v))


@dataclass
class ReelResource:
    language: str
    url: str | None
    entry_point_ms: int = 0
    duration_ms: int | None = None
    reel_index: int = 0


@dataclass
class RplDocument:
    resources: list[ReelResource] = field(default_factory=list)
    timeline_offset_ms: int = 0
    warnings: list[str] = field(default_factory=list)


def parse_rpl(xml_text: str) -> RplDocument:
    doc = RplDocument()
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f"RPL is not valid XML: {e}")

    for el in root.iter():
        if _local(el.tag) == "TimelineOffset" and el.text and el.text.strip():
            try:
                doc.timeline_offset_ms = _ms(el.text)
            except ValueError:
                doc.warnings.append(f"unparseable TimelineOffset: {el.text!r}")

    reel_index = -1
    for el in root.iter():
        name = _local(el.tag)
        if name == "ReelResources":
            reel_index += 1
        elif name == "ReelResource":
            lang_raw = el.get("Language", el.get("language", ""))
            language = normalize_language(lang_raw)
            raw = lang_raw.strip()
            if raw and (raw.lower() in LANGUAGE_ALIASES or normalize_language(raw) != raw):
                doc.warnings.append(
                    f"nonstandard language code {lang_raw!r} normalized to {language!r}")
            url = None
            for child in el:
                if _local(child.tag) == "ResourceFile" and child.text and child.text.strip():
                    url = child.text.strip()
                    break
            if not url:
                doc.warnings.append(
                    f"ReelResource (lang={language}) has no ResourceFile; skipped")
                continue
            entry, duration = 0, None
            for child in el:
                cname = _local(child.tag)
                if cname == "EntryPoint" and child.text:
                    try:
                        entry = _ms(child.text)
                    except ValueError:
                        doc.warnings.append(f"unparseable EntryPoint: {child.text!r}")
                elif cname == "Duration" and child.text:
                    try:
                        duration = _ms(child.text)
                    except ValueError:
                        doc.warnings.append(f"unparseable Duration: {child.text!r}")
            doc.resources.append(ReelResource(
                language=language, url=url,
                entry_point_ms=entry, duration_ms=duration,
                reel_index=max(reel_index, 0),
            ))
    return doc
