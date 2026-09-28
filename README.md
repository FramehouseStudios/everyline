# everyline

Every line of the film, in your lens.

everyline puts real-time movie captions on the patron's own Meta glasses.
Walk into any equipped theater, keep your glasses on, and read the film
live as it plays. No loaner hardware from the theater. No cupholder screens.
No separate showings.

## How it works

A small appliance in the projection booth connects to the digital cinema
server as an auxiliary content client (SMPTE 430-10 / 430-11, the industry's
own caption protocol), reads the caption track from the playing DCP, and
streams cues over the auditorium WiFi. The patron's phone receives the stream
and renders each line on their Meta glasses on exactly the right frame.

The theater keeps its projector. The patron keeps their dignity.

## What's here

- `demo/` — a working end-to-end simulation. A booth appliance simulator
  speaking the production cue protocol, a patron "lens view" web client,
  and a 90-second captioned scene in English and Spanish.
  Run `python3 demo/booth.py`, open the served page on your phone, press play.
- `demo/protocol.md` — the wire contract between booth and phone.
  This is the production contract.
- `DISCOVERY.md` — the project brief: the plan, the three gates to a pilot,
  open questions.
- `research/cinema-servers.md` — the cinema server integration surface:
  protocol flow, vendor support, caption formats, appliance design.
- `backend/` — the control plane: theaters, auditoriums, booth appliances,
  shows, and patron discovery. The cue stream stays on the LAN; the backend
  never touches caption content. `npm install && npm test`.
- `appliance/` — the booth box software: SMPTE 430-10/430-11 client skeleton,
  KLV framing, RPL and timed-text parsers, cue scheduler emitting the Cue
  Stream Protocol. Pure Python, 37 tests. Wire bytes marked SPEC are
  paywalled and get filled from the licensed standard before bench testing.
- `companion/` — the patron phone app (PWA): join via discovery, subscribe
  to the booth's cue stream, and render captions. The booth is the clock;
  the renderer is the seam where the Meta Wearables Display SDK plugs in.
  `npm install && npm test` (15 tests), verified end-to-end against the
  demo booth. Three modes: Theater, Home, and a self-contained Demo that
  runs with no booth, no backend, no network.
- `home-bridge/` — the booth, for the living room. Serves captions over the
  same Cue Stream Protocol v0 from two providers: manual tap-to-sync SRT
  (works with any source: Netflix, Blu-ray, a file) and Plex true sync
  (position + subtitles from Plex's session API). The companion talks to it
  with zero new code. `npm install && npm test` (7 tests); `npm start`
  serves on :8787 with the cue stream at `/cue`.

## The honest version

The demo simulates the cinema server source and the glasses display.
The protocol between them is real, and it is what the production system
will speak. The production booth appliance (a real SMPTE 430-10 client,
dual-homed for booth LAN and patron WiFi) and the Meta Wearables companion
app are the next builds, gated on a pilot exhibitor.

Built by Framehouse Studios.

## License

MIT. See [LICENSE](LICENSE). If you build on this, we'd love to hear about it.
