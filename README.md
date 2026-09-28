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

## The honest version

The demo simulates the cinema server source and the glasses display.
The protocol between them is real, and it is what the production system
will speak. The production booth appliance (a real SMPTE 430-10 client,
dual-homed for booth LAN and patron WiFi) and the Meta Wearables companion
app are the next builds, gated on a pilot exhibitor.

Built by Framehouse Studios.

## License

MIT. See [LICENSE](LICENSE). If you build on this, we'd love to hear about it.
