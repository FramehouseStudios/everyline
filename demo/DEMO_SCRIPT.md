# everyline — the demo

You walk in with a laptop and a phone. Nothing else. That is the pitch.

## The one line

"Your patrons wear their own glasses. Captions appear in the lens, synced
to the projector. Nothing to hand out, nothing to collect, no closet."

## Setup (5 minutes, before they arrive)

Laptop is the projection booth. Phone is the patron's glasses.

```sh
cd demo
pip install websockets   # once
python3 booth.py
```

- Booth console: `http://<laptop-ip>:8080/`
- Patron lens view: open `http://<laptop-ip>:8080/` on the phone and tap
  **Lens view** — or just point the phone browser at the lens page.

No laptop? The companion app has a zero-setup demo: open the companion,
tap Demo, and the phone runs a virtual booth itself.

## The beats

**1. "This laptop is the projection booth. This phone is the patron's
glasses."**

Open the lens view on the phone. Open the booth view on the laptop.
Press play. Captions appear in the lens, ~750 ms before they're spoken,
synced to the booth clock. Point at the sync readout: single-digit
milliseconds on a LAN.

**2. Pause.**

Pause the booth. The words freeze mid-scene. This is the thing that
sells it: the captions are the film's own caption track, frame-locked to
the projector, not a transcript guessing from the room.

**3. Spanish.**

Switch the phone to ES mid-scene. The booth serves per-client language
from the DCP's own tracks. Same film, same sync, second language free.

**4. Seek.**

Jump the booth to 60 seconds. The phone re-syncs instantly. Joining
mid-film works: latecomers get captions, not a cold start.

## The close

"Today you keep a closet of loaner hardware. Batteries, hygiene wipes,
broken pairs, staff time. everyline retires the closet. The patron brings
the glasses they already wear. The theater runs one small box in the
booth that speaks the projector's own caption protocol."

Then stop. Let them ask about the box. That is the pilot conversation.

## What is simulated, said out loud

The laptop booth is a simulator: it plays a scripted caption track, not
a DCP. Say so before they ask. What is real: the cue protocol, the sync
model, the phone app, the booth appliance software skeleton, the QR
join flow. The production booth box reads the DCP caption track via the
cinema server's standard caption protocol (SMPTE 430-10/430-11) — the
wire bytes are the one piece still gated on the licensed spec and bench
time against a real server, and that is what the pilot proves.

## Troubleshooting

- Phone can't reach the booth: both on the same WiFi. The lens page
  shows the sync error; if it climbs, you're not on the LAN.
- `websockets` missing: `pip install websockets`.
- Port taken: booth.py takes the port as an argument.
