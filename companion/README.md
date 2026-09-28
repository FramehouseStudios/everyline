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
operator token (v1 still gates discovery on the operator token; a public
now-playing variant ships before pilot).

Deep link (what the seat QR encodes):

```
?backend=https://…&token=…&theater=<theaterId>&auditorium=<auditoriumId>
```

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
  with DOM; `MetaDisplayRenderer` will implement them against the Wearables
  Device Access Toolkit. Nothing above this file changes.
- `src/app.js` — screens and wiring only.

## Test

```sh
npm install
npm test
```

`stream.test.js` runs a scripted fake booth speaking protocol v0 and drives
the real `BoothStream` against it, including a reconnect cycle.
