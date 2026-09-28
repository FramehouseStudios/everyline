# Plex Media Server API — verified shapes for the home-bridge Plex provider

Researched 2026-09-28 against `python-plexapi` (pkkid/python-plexapi,
shallow clone at `research/vendor/python-plexapi`, BSD-3-Clause) plus
independent community sources. Plex publishes **no official public API
documentation**; python-plexapi is the most authoritative client reference.
Community OpenAPI catalog:
https://github.com/glinnik21/plx-native/blob/HEAD/docs/plex-api-catalog.md

## 1. GET /status/sessions

- Path: `/status/sessions`, no required params.
  Ref: `plexapi/server.py:803-805` (`PlexServer.sessions()`).
- Returns `MediaContainer` with full media metadata per active session
  (MovieSession/EpisodeSession/ClipSession — `plexapi/video.py:1335-1358`).
- python-plexapi reads XML; the server also honors `Accept:
  application/json`, returning the same tree as JSON
  (`{"MediaContainer": {"Metadata": [...]}}`).

Field locations (all on the session's `Metadata` element):

| Field | Location | Ref |
|---|---|---|
| position, ms | `viewOffset` attribute on the Metadata element | `video.py:409` (Movie), `video.py:1291` (Episode), `audio.py:563` (Track) |
| play state | child `Player` element, `state` attribute (`playing`/`paused`/`buffering`) | `base.py:1058-1060` (PlexSession mixin reads the `Player` etag) |
| session id | `sessionKey` attribute on the Metadata element | `base.py:1047` |
| user | child `User` element (`id`, `title`) | `base.py:1050-1051` |
| duration, ms | `duration` attribute on the Metadata element | `video.py` `_loadData` |
| deep metadata URL | `key` attribute, `/library/metadata/<ratingKey>` | — |

## 2. Subtitle streams

Structure: `Metadata > Media > Part > Stream`
(`plexapi/media.py:87` parts, `media.py:182-184` subtitleStreams).

Stream attributes (`media.py:258-273` `_loadData`):
- `streamType`: 1=video, 2=audio, 3=subtitle (docstring `media.py:236-237`)
- `languageCode`: ISO 639-2/T three-letter code (`eng`, `spa`, `fre`,
  `deu`, `ita`, `por`, `nld`, `jpn`, `kor`, `zho`) — this is the field to
  map to ISO 639-1 for the phone UI
- `languageTag`: two-letter code (`en`, `fr`) — not always present
- `key`: `/library/streams/<id>` — **only present on external (sidecar)
  subtitle streams**; embedded (muxed) streams have no `key`
- `selected`: whether this stream is currently selected
- `codec`: `srt`, `ass`, `vtt`, `pgs`, …

## 3. Subtitle download

`GET <stream.key>` = `GET /library/streams/<id>` (optionally
`/library/streams/<id>.<ext>`) returns the subtitle file content for
external streams. Auth: `X-Plex-Token` header (canonical —
`server.py:155-160`) or `?X-Plex-Token=` query param (accepted, but leaks
into logs). python-plexapi never GETs stream content itself, but treats
`key` as the stream's direct resource URL (e.g. `removeSubtitles` calls
DELETE on it — `video.py:181`).

Hard limits, confirmed by independent sources (scaleplex QA docs,
cliparr#31, asbplayer research):
- **Embedded subtitles are not downloadable via the API at all** — no
  `key` is ever issued for them. Only sidecar/external files.
- Plex serves subtitle content with **no charset**; decode explicitly as
  UTF-8 (falling back to ISO-8859-1 corrupts non-ASCII).
- Search-result subtitles 404 on `/library/streams/<id>` until downloaded
  (async `PUT {item.key}/subtitles` + poll) — irrelevant for our read path.

## 4. Sample (trimmed) /status/sessions response, JSON

```json
{
  "MediaContainer": {
    "Metadata": [
      {
        "key": "/library/metadata/12345",
        "sessionKey": "7",
        "title": "The Long Room",
        "type": "movie",
        "duration": 5400000,
        "viewOffset": 654000,
        "Player": { "state": "playing", "title": "Plex for iOS" },
        "Session": { "id": "abc123", "bandwidth": 8000, "location": "lan" },
        "User": { "id": "1", "title": "josh" },
        "Media": [
          { "Part": [
            { "id": 1, "key": "/library/parts/1/file.mkv",
              "Stream": [
                { "id": 201, "streamType": 3, "codec": "srt",
                  "language": "English", "languageCode": "eng",
                  "languageTag": "en", "selected": true,
                  "key": "/library/streams/201" },
                { "id": 202, "streamType": 3, "codec": "srt",
                  "language": "Spanish", "languageCode": "spa",
                  "key": "/library/streams/202" }
              ] }
          ] }
        ]
      }
    ]
  }
}
```

## 5. Discrepancies vs our provider (`home-bridge/src/providers/plex.js`)

1. **Token in URL, not header.** Works (Plex accepts both), but the
   canonical form is the `X-Plex-Token` header and URL-embedded tokens can
   leak into server/proxy logs. Recommend switching `_get` to the header.
2. **Embedded subtitles** — our provider already filters to streams with
   a `key` and errors cleanly when none exist. Correct; the docs should
   say "external/sidecar text subtitles only" because embedded are
   structurally undownloadable.
3. **"SRT/VTT" claim** — `parseSrt` tolerates VTT timestamps (`[,.]`
   separator) and skips the `WEBVTT` header block, so the claim roughly
   holds.
4. **Buffering** — Plex reports `state: "buffering"`; we map anything not
   `playing` to paused. Acceptable for v1.
5. **`attach()` naming** — re-fetches the metadata `key`
   (`/library/metadata/<rk>`), which is the right URL; it's just named
   `sessionKey` in the code.
6. **JSON support** — real Plex honors `Accept: application/json`;
   python-plexapi only proves XML, but JSON support is long-standing and
   our mock matches the real shape.

## 6. Fake Plex servers for automated testing

- `glinnik21/plx-native`, `tests/mock_pms.py` — synthetic PMS in Python;
  answers exactly the endpoints its models read, deterministic from a
  seed. Most directly reusable pattern.
- `edinuser/name-o-tron-9000`, `tests/mock-plex/` — Node mock serving
  `127.0.0.1:32400` with reset/start/stop lifecycle scripts.
- Our home-bridge already has its own mock in `test/`; tighten it to the
  confirmed shapes above (add `sessionKey`, `Player.state`, `Session`,
  streams without `key` for embedded) rather than adopting a new one.

License of python-plexapi: BSD-3-Clause (`pyproject.toml`, LICENSE.txt).
