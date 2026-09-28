# Cue Stream Protocol v0

The wire contract between the booth appliance and the patron's phone.
This is the production contract. The demo booth implements it with a
simulated caption source; the production appliance will implement it
with a real SMPTE 430-10/430-11 feed from the cinema server.

Transport: WebSocket, JSON messages. Times in milliseconds.

## Booth -> phone

`welcome`
  Sent on connect.
  { "type": "welcome", "protocol": 0,
    "showing": { "title": "...", "auditorium": "..." },
    "serverNowMs": 1727..., "languages": ["en", "es"],
    "source": "simulated" | "dcp" }

`cue`
  Sent ~750ms before the cue's start time so the phone can schedule it.
  { "type": "cue", "id": "en-12", "lang": "en",
    "startMs": 41000, "endMs": 43500,
    "text": "Did you hear that? The room laughed.",
    "issuedAtMs": 1727... }

`transport`
  Sent on every play/pause/seek transition and as a 1Hz heartbeat
  while playing. The phone treats the booth as the clock.
  { "type": "transport", "status": "playing" | "paused",
    "positionMs": 41250, "serverNowMs": 1727..., "clients": 2 }

## Phone -> booth

`hello`
  { "type": "hello", "client": "glasses-view", "protocol": 0 }

`subscribe`
  { "type": "subscribe", "lang": "en" }
  Re-subscribing to another language flushes pending cues for the old one.

`command` (demo only; production follows the cinema server, never the phone)
  { "type": "command", "command": "play" | "pause" | "seek", "positionMs": 0 }

## Rendering rule (phone side)

Display a cue when the booth's media clock reaches startMs, clear at endMs.
If a cue arrives after its startMs but before its endMs, display immediately.
Target sync error on a LAN: under 150ms.

## Clock

The phone estimates the booth's media clock from `transport` messages:
mediaNow = positionMs + (Date.now() - receivedAt) while status is "playing".
Cues are scheduled against that clock. Production will refine with
NTP-style filtering; the demo uses the latest transport message.
