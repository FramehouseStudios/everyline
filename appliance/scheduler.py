"""Cue scheduling: timed-text cues -> Cue Stream Protocol v0 messages.

The DCS is the clock. The appliance tracks the media position from Update
Timeline messages and emits each cue `lookahead_ms` before its start so the
phone can hold-and-fire. Between timeline updates we do NOT extrapolate;
a stale position simply delays the next cue by the update cadence, which is
the honest behavior (USL: output mode must mirror actual run/stop state).

This is the production version of the scheduling logic prototyped in
demo/booth.py.
"""

import time

PROTOCOL_VERSION = 0


class CueScheduler:
    def __init__(self, lookahead_ms: int = 750, clock=None):
        self.lookahead_ms = lookahead_ms
        self.clock = clock or (lambda: int(time.time() * 1000))
        self.reset()

    def reset(self):
        self.cues_by_lang = {}
        self.playout_id = None
        self.playing = False
        self.position_ms = 0
        self.emitted = set()   # cue ids already sent this session
        self._starts = {}      # cue id -> start_ms
        self._ends = {}        # cue id -> end_ms

    def load(self, cues_by_lang: dict, playout_id: str) -> None:
        """Install a fresh cue set for a playout. Drops all session state."""
        self.reset()
        self.cues_by_lang = {lang: sorted(cues, key=lambda c: c.start_ms)
                             for lang, cues in cues_by_lang.items()}
        self.playout_id = playout_id
        for lang, cues in self.cues_by_lang.items():
            for i, c in enumerate(cues):
                cid = f"{lang}-{i}"
                self._starts[cid] = c.start_ms
                self._ends[cid] = c.end_ms

    def set_transport(self, *, playing: bool, position_ms: int, playout_id: str) -> None:
        if playout_id != self.playout_id:
            # Per USL: on playout-ID mismatch the pending captions are discarded.
            self.reset()
            return
        if position_ms < self.position_ms:
            # Seek backwards (or loop restart): anything not fully in the past
            # becomes eligible again, so a straddling cue re-emits immediately.
            self.emitted = {cid for cid in self.emitted
                            if self._ends.get(cid, 0) <= position_ms}
        self.playing = playing
        self.position_ms = position_ms

    def poll(self) -> list[dict]:
        """Cue messages due now, per protocol v0. Idempotent: no duplicates."""
        if not self.playing or self.playout_id is None:
            return []
        now = self.position_ms
        issued = int(self.clock())
        out = []
        for lang, cues in self.cues_by_lang.items():
            for i, c in enumerate(cues):
                cid = f"{lang}-{i}"
                if cid in self.emitted:
                    continue
                if c.start_ms - self.lookahead_ms <= now < c.end_ms:
                    out.append({
                        "type": "cue", "id": cid, "lang": lang,
                        "startMs": c.start_ms, "endMs": c.end_ms,
                        "text": c.text, "issuedAtMs": issued,
                    })
                    self.emitted.add(cid)
                elif c.start_ms - self.lookahead_ms > now:
                    break  # cues are sorted; nothing later is due
        return out

    def current_at(self, position_ms: int, language: str):
        """The cue visible at a position, for join-in-progress subscribers."""
        for i, c in enumerate(self.cues_by_lang.get(language, [])):
            if c.start_ms <= position_ms < c.end_ms:
                return {
                    "type": "cue", "id": f"{language}-{i}", "lang": language,
                    "startMs": c.start_ms, "endMs": c.end_ms,
                    "text": c.text, "issuedAtMs": int(self.clock()),
                }
            if c.start_ms > position_ms:
                break
        return None

    def languages(self) -> list[str]:
        return sorted(self.cues_by_lang.keys())
