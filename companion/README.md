# everyline companion

The patron app: join a showing, connect to the booth's cue stream, and read
the film. A PWA today; the Meta Wearables Display renderer plugs into the
same seam tomorrow.

## Run

Serve this directory over HTTP (it must reach the backend and the booth's
WebSocket, so use the machine's LAN address, not localhost, for phone testing):

```sh
python3 -m http.server 8000
```

Open `http://<your-lan-ip>:8000`, enter the backend URL, a theater ID, and the
operator token — or scan the seat QR, which needs no token.

Deep link (what the seat QR encodes):

```
?source=theater&backend=https://…&theater=<theaterId>&auditorium=<auditoriumId>
```

It hits the public now-playing endpoint, so the QR never carries a
credential. A `token=` param still works and gets the operator path.

## Architecture

```
BoothStream  --Cue Stream Protocol v0-->  BoothClock  -->  CuePlayer  -->  LensRenderer
 (WebSocket)      (welcome/cue/transport)   (booth is     (what's        (pixels)
                                             the clock)    visible)
```

- `src/stream.js` — WebSocket lifecycle, hello/subscribe, reconnect backoff.
  WebSocket implementation is injected (native in browser, `ws` in tests).
- `src/clock.js` — media position from `transport` messages. No extrapolation.
- `src/player.js` — derives the visible cue from the clock each tick, so
  seeks, loops, and pause/resume need no special cases.
- `src/renderer.js` — **the Meta seam.** `LensRenderer` is four methods:
  `showCue`, `clear`, `setStatus`, `setLang`. `WebRenderer` implements them
  with DOM; `ios/MetaDisplayRenderer.swift` implements them against the
  Wearables DAT Display capability (MWDATDisplay, SDK 0.7.0; uncompiled —
  needs Xcode). Nothing above this file changes.
- `src/app.js` — screens and wiring only.

## On real glasses: two paths

1. **Native (Swift).** `ios/MetaDisplayRenderer.swift` drives the Display
   capability directly: connect → `addDisplay()` → wait `.started` →
   `send(FlexBox { Text(cue) })` on cue boundaries. Needs the DAT SDK via
   SPM, a Wearables Developer Center project for production, and Xcode to
   compile. Distribution to glasses users is invite-gated by Meta.
2. **Web app (no native code).** This PWA can render *on the glasses*
   directly as a Meta web app:
   `fb-viewapp://web_app_deep_link?appName=everyline&appUrl=<encoded-companion-url>`
   — 600×600 display, QR install from the paired phone, glasses firmware
   v125+ and Meta AI app v272+ required. Caveat: the web app runs on the
   glasses, so the cue-stream WebSocket must be reachable from the glasses
   over the same LAN WiFi. Fine in a theater; trickier at home behind NAT.

See `research/meta-display-sdk.md` for the full API surface.

## Test

```sh
npm install
npm test
```

`stream.test.js` runs a scripted fake booth speaking protocol v0 and drives
the real `BoothStream` against it, including a reconnect cycle.
