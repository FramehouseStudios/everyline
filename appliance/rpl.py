"""SMPTE 430-11 RPL (Resource Presentation List) parsing.

Element/attribute names and the time model from ST 430-11:2010, section 6.3
and the schema annex:
  ResourcePresentationList (optional PlayoutID attribute, unsignedInt)
  +- ReelResources (required: ReelID uuid, EditRate rational "num den",
  |                 TimelineOffset unsignedLong, in edit units)
  +- ReelResource (required: Id uuid, ResourceType string, IntrinsicDuration
  |                in edit units; optional: Language, EntryPoint, Duration)
  +- ResourceFile (element text: the resource URI; may repeat, we take first)

Time model: TimelineOffset, EntryPoint, Duration and IntrinsicDuration are
all in EDIT UNITS, not milliseconds. ms = units * 1000 * den / num using the
reel's EditRate (6.3.2.3, 6.3.3.4-6.3.3.6). If Duration is absent, the
playable region is (IntrinsicDuration - EntryPoint) / EditRate seconds.

Parsing stays defensive: the field notes document dead URLs, empty
resources, and nonstandard language codes in the wild.
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


def _units_to_ms(units: int, num: int, den: int) -> int:
    if den == 0:
        raise ValueError("EditRate denominator is 0")
    return units * 1000 * den // num


def _parse_edit_rate(raw: str | None):
    """'24 1' -> (24, 1). Raises ValueError on garbage."""
    parts = (raw or "").split()
    if len(parts) != 2:
        raise ValueError(f"EditRate must be 'num den', got {raw!r}")
    num, den = int(parts[0]), int(parts[1])
    if num <= 0 or den <= 0:
        raise ValueError(f"EditRate out of range: {raw!r}")
    return num, den


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
    playout_id: int | None = None
    warnings: list[str] = field(default_factory=list)


def parse_rpl(xml_text: str) -> RplDocument:
    doc = RplDocument()
    # Billion-laughs guard: the RPL arrives over the booth LAN.
    if "<!ENTITY" in xml_text.upper():
        raise ValueError("RPL declares XML entities; refusing")
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f"RPL is not valid XML: {e}")

    # 6.3.1: optional PlayoutID correlates the RPL to the CSP playout.
    playout_raw = root.get("PlayoutID", root.get("playoutID", ""))
    if playout_raw.strip():
        try:
            doc.playout_id = int(playout_raw)
        except ValueError:
            doc.warnings.append(f"unparseable PlayoutID: {playout_raw!r}")

    reel_index = -1
    for el in root.iter():
        if _local(el.tag) != "ReelResources":
            continue
        reel_index += 1
        # 6.3.2: EditRate and TimelineOffset are attributes, in edit units.
        try:
            num, den = _parse_edit_rate(el.get("EditRate"))
        except ValueError:
            doc.warnings.append(
                f"ReelResources #{reel_index}: bad/missing EditRate "
                f"{el.get('EditRate')!r}; assuming 1 unit = 1 ms")
            num, den = 1000, 1
        try:
            offset_units = int(el.get("TimelineOffset", "0"))
        except ValueError:
            doc.warnings.append(
                f"ReelResources #{reel_index}: bad TimelineOffset; using 0")
            offset_units = 0
        reel_offset_ms = _units_to_ms(offset_units, num, den)
        if reel_index == 0:
            doc.timeline_offset_ms = reel_offset_ms
        elif reel_offset_ms != doc.timeline_offset_ms:
            # Multi-reel shows: each reel's offset is show-relative. Keep the
            # first reel's offset as the document offset and fold each reel's
            # own offset into its resources below.
            pass

        for res_el in el:
            if _local(res_el.tag) != "ReelResource":
                continue
            lang_raw = res_el.get("Language", res_el.get("language", ""))
            language = normalize_language(lang_raw)
            raw = lang_raw.strip()
            if raw and (raw.lower() in LANGUAGE_ALIASES
                        or normalize_language(raw) != raw):
                doc.warnings.append(
                    f"nonstandard language code {lang_raw!r} normalized to "
                    f"{language!r}")
            url = None
            for child in res_el:
                if _local(child.tag) == "ResourceFile" and child.text \
                        and child.text.strip():
                    url = child.text.strip()
                    break
            if not url:
                doc.warnings.append(
                    f"ReelResource (lang={language}) has no ResourceFile; skipped")
                continue
            try:
                entry_units = int(res_el.get("EntryPoint", "0") or "0")
            except ValueError:
                doc.warnings.append(
                    f"unparseable EntryPoint {res_el.get('EntryPoint')!r}; using 0")
                entry_units = 0
            dur_raw = res_el.get("Duration")
            intrinsic_raw = res_el.get("IntrinsicDuration")
            try:
                if dur_raw is not None:
                    # 6.3.3.5: playable region in edit units.
                    duration_ms = _units_to_ms(int(dur_raw), num, den)
                elif intrinsic_raw is not None:
                    # 6.3.3.5: default is (IntrinsicDuration - EntryPoint).
                    duration_ms = _units_to_ms(
                        int(intrinsic_raw) - entry_units, num, den)
                else:
                    duration_ms = None
                    doc.warnings.append(
                        f"ReelResource (lang={language}) has no Duration or "
                        f"IntrinsicDuration; uncapped")
            except ValueError:
                doc.warnings.append(
                    f"unparseable Duration/IntrinsicDuration for lang={language}; "
                    f"uncapped")
                duration_ms = None
            entry_ms = _units_to_ms(entry_units, num, den)
            # Each reel's TimelineOffset is show-relative; fold it in.
            doc.resources.append(ReelResource(
                language=language, url=url,
                entry_point_ms=entry_ms + reel_offset_ms,
                duration_ms=duration_ms,
                reel_index=reel_index,
            ))
    return doc
