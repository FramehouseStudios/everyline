# everyline home bridge

The booth, for the living room. A small service on the home network that
serves captions over Cue Stream Protocol v0 — the exact wire contract the
theater booth speaks (see `demo/protocol.md`). The companion app talks to
it with zero new code: a bridge is just another cue source.

## Run

```sh
npm install
npm start   # http://0.0.0.0:8787, cue stream at ws://0.0.0.0:8787/cue
npm test    # 7 tests, incl. mock-Plex and protocol tests
```

In the companion app, choose Home and connect to `ws://<bridge-ip>:8787/cue`.

## Providers

**Manual (tap-to-sync).** Works with anything — Netflix, Disney+, Blu-ray,
a file — because the bridge doesn't care where the picture comes from.
Load an SRT, press play on the TV, tap play here:

```sh
curl -X POST localhost:8787/v1/load \
  -H 'Content-Type: application/json' \
  -d '{"lang":"en","srt":"1\n00:00:01,000 --> 00:00:02,000\nHello\n","title":"My Film"}'
curl -X POST localhost:8787/v1/transport \
  -H 'Content-Type: application/json' -d '{"action":"play"}'
# pause, or {"action":"seek","positionMs":60000} to re-sync
```

**Plex (true sync).** Reads playback position from Plex's session API and
pulls the subtitle stream for the active session. Text-based subtitles
(SRT/VTT-shaped) only in v1.

```sh
# list what's playing (needs your server URL + token)
curl 'localhost:8787/v1/providers/plex/sessions?url=http://192.168.1.10:32400&token=TOKEN'
# bind the bridge to a session
curl -X POST localhost:8787/v1/providers/plex/attach \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://192.168.1.10:32400","token":"TOKEN","sessionKey":"/library/metadata/42"}'
```

Jellyfin and Emby are next; the provider interface is `languages()`,
`cues(lang)`, `state() -> {status, positionMs}`.

## Honest limits

- The Plex provider is built against Plex's documented API shapes and tested
  against a mock server. Verify against a real Plex server before piloting.
- Manual mode drifts over a long film if the TV and the bridge clocks
  diverge; re-tap seek to correct.
- No auth on the bridge in v1 — it's a LAN appliance, like the booth.
