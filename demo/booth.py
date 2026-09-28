#!/usr/bin/env python3
"""Booth appliance simulator for the glasses captions demo.

Simulates the production appliance: instead of reading the DCP caption track
via SMPTE 430-10/430-11 from a real cinema server, it plays local caption
files. The wire protocol is identical to the production design
(see protocol.md) so everything built against this demo carries over.

Run:  python3 booth.py
Then open http://<this-machine>:8080/ on the "glasses" phone.

Ports: 8080 = demo web client, 8765 = cue stream WebSocket.
"""

import asyncio
import json
import os
import re
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
WS_PORT = 8765
HTTP_PORT = 8080
LOOKAHEAD_MS = 750      # how far ahead of startMs cues are pushed
TICK_S = 0.1


def parse_srt(path):
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    cues = []
    for block in re.split(r"\n\s*\n", raw.strip()):
        lines = block.strip().splitlines()
        if len(lines) < 3:
            continue
        m = re.match(
            r"(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)", lines[1])
        if not m:
            continue
        g = list(map(int, m.groups()))
        start = ((g[0] * 60 + g[1]) * 60 + g[2]) * 1000 + g[3]
        end = ((g[4] * 60 + g[5]) * 60 + g[6]) * 1000 + g[7]
        cues.append({"startMs": start, "endMs": end,
                     "text": "\n".join(lines[2:])})
    return sorted(cues, key=lambda c: c["startMs"])


TRACKS = {}
for lang in ("en", "es"):
    path = os.path.join(HERE, f"captions.{lang}.srt")
    cues = parse_srt(path)
    for i, c in enumerate(cues):
        c["id"] = f"{lang}-{i}"
        c["lang"] = lang
    TRACKS[lang] = cues
    print(f"loaded {len(cues)} cues [{lang}] from {os.path.basename(path)}")

DURATION_MS = max(c["endMs"] for cues in TRACKS.values() for c in cues)


class Booth:
    def __init__(self):
        self.status = "paused"
        self.position_ms = 0.0
        self._anchor_mono = None
        self._anchor_pos = 0.0
        self.clients = {}  # websocket -> {"lang": str, "sent": set()}
        self._last_heartbeat = 0.0

    def media_now(self):
        if self.status == "playing":
            return self._anchor_pos + (time.monotonic() - self._anchor_mono) * 1000
        return self.position_ms

    def _pin(self):
        self.position_ms = self.media_now()
        self._anchor_mono = time.monotonic()
        self._anchor_pos = self.position_ms

    def play(self):
        self._pin()
        self.status = "playing"

    def pause(self):
        self._pin()
        self.status = "paused"

    def seek(self, ms):
        ms = max(0.0, min(float(ms), DURATION_MS))
        self.position_ms = ms
        self._anchor_mono = time.monotonic()
        self._anchor_pos = ms
        for state in self.clients.values():
            state["sent"].clear()

    def transport_msg(self):
        return {"type": "transport", "status": self.status,
                "positionMs": round(self.media_now(), 1),
                "serverNowMs": int(time.time() * 1000),
                "clients": len(self.clients)}

    async def broadcast(self, msg):
        if not self.clients:
            return
        data = json.dumps(msg)

        async def _one(ws):
            try:
                await ws.send(data)
            except Exception:
                return ws
            return None

        # Fan out concurrently: one slow phone must not head-of-line
        # block the heartbeat for every other patron.
        dead = [ws for ws in
                await asyncio.gather(*(_one(ws) for ws in self.clients))
                if ws is not None]
        for ws in dead:
            self.clients.pop(ws, None)

    async def _push_cue(self, ws, state, cue):
        """Send one cue. Returns the ws if it died, else None.

        The cue is marked sent only AFTER a successful send: marking it
        first (and swallowing the failure) permanently loses that caption
        for the patron on flaky WiFi.
        """
        try:
            await ws.send(json.dumps({
                "type": "cue", "id": cue["id"],
                "lang": cue["lang"],
                "startMs": cue["startMs"],
                "endMs": cue["endMs"],
                "text": cue["text"],
                "issuedAtMs": int(time.time() * 1000),
            }))
        except Exception:
            return ws
        state["sent"].add(cue["id"])
        return None

    async def tick(self):
        """Push cues ahead of the playhead; heartbeat transport."""
        while True:
            await asyncio.sleep(TICK_S)
            pos = self.media_now()
            if self.status == "playing":
                if pos >= DURATION_MS:
                    self.pause()
                    self.position_ms = DURATION_MS
                    await self.broadcast(self.transport_msg())
                    continue
                jobs = []
                for ws, state in list(self.clients.items()):
                    lang = state.get("lang", "en")
                    for cue in TRACKS.get(lang, []):
                        if cue["id"] in state["sent"]:
                            continue
                        if cue["startMs"] <= pos + LOOKAHEAD_MS and cue["endMs"] > pos:
                            jobs.append(self._push_cue(ws, state, cue))
                # Concurrent fan-out: sequential `await ws.send` let a
                # single half-open phone stall captions theater-wide.
                # _push_cue catches everything, so results are ws-or-None.
                dead = {ws for ws in await asyncio.gather(*jobs)
                        if ws is not None}
                for ws in dead:
                    self.clients.pop(ws, None)
                if time.monotonic() - self._last_heartbeat >= 1.0:
                    self._last_heartbeat = time.monotonic()
                    await self.broadcast(self.transport_msg())

    async def handler(self, ws):
        # The client speaks first: hello carries its protocol version.
        # A future client speaking protocol 1 must be rejected loudly,
        # not silently served v0 it cannot parse. The client is only
        # registered for cue pushes after a valid hello.
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            hello = json.loads(raw)
        except Exception:
            hello = None
        if not hello or hello.get("type") != "hello":
            return
        if hello.get("protocol", 0) != 0:
            try:
                await ws.send(json.dumps({
                    "type": "error",
                    "error": f"unsupported protocol {hello.get('protocol')}; this booth speaks 0",
                }))
            except Exception:
                pass
            return
        self.clients[ws] = {"lang": "en", "sent": set()}
        print(f"client connected ({len(self.clients)} total)")
        try:
            await ws.send(json.dumps({
                "type": "welcome", "protocol": 0,
                "showing": {"title": "The Long Room (demo)",
                            "auditorium": "Booth simulator"},
                "serverNowMs": int(time.time() * 1000),
                "languages": sorted(TRACKS.keys()),
                "source": "simulated",
            }))
            await ws.send(json.dumps(self.transport_msg()))
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if msg.get("type") == "subscribe":
                    lang = msg.get("lang", "en")
                    if lang in TRACKS:
                        self.clients[ws]["lang"] = lang
                        self.clients[ws]["sent"].clear()
                        print(f"client subscribed [{lang}]")
                elif msg.get("type") == "command":
                    cmd = msg.get("command")
                    if cmd == "play":
                        self.play()
                    elif cmd == "pause":
                        self.pause()
                    elif cmd == "seek":
                        self.seek(msg.get("positionMs", 0))
                    else:
                        continue
                    await self.broadcast(self.transport_msg())
        finally:
            self.clients.pop(ws, None)
            print(f"client disconnected ({len(self.clients)} total)")

    async def run(self):
        async with websockets.serve(self.handler, "0.0.0.0", WS_PORT):
            print(f"cue stream on ws://0.0.0.0:{WS_PORT}")
            await self.tick()


def serve_http():
    handler = partial(SimpleHTTPRequestHandler, directory=HERE)
    srv = ThreadingHTTPServer(("0.0.0.0", HTTP_PORT), handler)
    print(f"demo client on http://0.0.0.0:{HTTP_PORT}/")
    srv.serve_forever()


if __name__ == "__main__":
    threading.Thread(target=serve_http, daemon=True).start()
    asyncio.run(Booth().run())
