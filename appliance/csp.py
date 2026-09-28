"""SMPTE 430-10 CSP client: the booth appliance's conversation with the DCS.

Flow (established from USL's public implementation notes):
  1. Appliance opens TCP to the DCS on port 4170 (it initiates).
  2. DCS -> Set RPL Location (playout_id, rpl_url). The appliance fetches the
     RPL over HTTP, then each language's timed-text, and replies with status
     ok / processing. USL's #1 interop note: this should arrive when the show
     is *loaded*, giving us the 2-22 s fetch window before frame one.
  3. DCS -> Set Output Mode Enabled when synchronous content plays.
  4. DCS -> Update Timeline regularly during playout. The DCS is the clock.
  5. DCS -> Terminate Lease: "erases all knowledge of previous information".

SPEC-GATED: the normative message table (exact UL keys, payload layouts,
430-10 sections 6-7, Annex A/B) is paywalled at SMPTE. Every placeholder is
marked SPEC below and must be filled from a licensed copy of ST 430-10:2010
before bench testing. Nothing here invents wire bytes.

Join-in-progress (USL section 7): the DCS may send Update Timeline *before*
Set RPL Location when we connect mid-show. We stash the position and apply it
once the RPL is fetched, skipping reels already past.
"""

import socket
import time
from dataclasses import dataclass, field, replace

from .klv import KLVReader, encode_klv
from .rpl import parse_rpl
from .timedtext import parse_timed_text

SPEC = "SPEC: fill from licensed SMPTE ST 430-10:2010"

# Direction and field names are established; UL keys and payload layouts are not.
MESSAGES = {
    "set_rpl_location": {"direction": "dcs->acs", "ul": SPEC,
                         "fields": ["playout_id", "rpl_url"]},
    "status_response": {"direction": "acs->dcs", "ul": SPEC,
                        "fields": ["playout_id", "status"]},  # ok|processing|bad_request
    "set_output_mode": {"direction": "dcs->acs", "ul": SPEC,
                        "fields": ["playout_id", "enabled"]},
    "update_timeline": {"direction": "dcs->acs", "ul": SPEC,
                        "fields": ["playout_id", "position_ms"]},
    "terminate_lease": {"direction": "dcs->acs", "ul": SPEC,
                        "fields": ["playout_id"]},
}

PORT = 4170
RECOMMENDED_LEASE_SECONDS = 60  # per USL; some servers request 5 s (fragile)


class CspClient:
    """CSP session for one cinema server. Drive via on_* handlers (tests,
    bench harness) or connect()/pump() for a live socket."""

    def __init__(self, fetch, scheduler, lease_seconds=RECOMMENDED_LEASE_SECONDS,
                 clock=None):
        # fetch(url) -> str: HTTP GET of RPL / timed-text. Injected for tests.
        self.fetch = fetch
        self.scheduler = scheduler
        self.lease_seconds = lease_seconds
        self.clock = clock or time.monotonic
        self.sent_statuses = []  # (playout_id, status) emitted; wiring reads this
        self.warnings = []
        self._sock = None
        self._reader = KLVReader()
        self._reset_session()

    # ------------------------------------------------------------------ state
    def _reset_session(self):
        self.playout_id = None
        self.rpl_url = None
        self.cues_by_lang = {}
        self.output_enabled = False
        self.position_ms = 0
        self.state = "idle"  # idle|fetching|ready|playing|empty
        self.lease_deadline = None
        self.pending_timeline = None
        self.scheduler.reset()

    def _touch_lease(self):
        if self.lease_seconds <= 5:
            self.warnings.append(
                f"lease of {self.lease_seconds}s requested; USL warns 5 s leases "
                "expire on any slight delay and wipe the session")
        self.lease_deadline = self.clock() + self.lease_seconds

    def lease_expired(self) -> bool:
        return self.lease_deadline is not None and self.clock() > self.lease_deadline

    def _respond(self, playout_id, status):
        self.sent_statuses.append((playout_id, status))

    def _check_playout(self, playout_id) -> bool:
        if playout_id != self.playout_id:
            self.warnings.append(
                f"playout-id mismatch (got {playout_id!r}, want {self.playout_id!r}); "
                "discarding per USL section 5")
            return False
        return True

    # ------------------------------------------------------- DCS -> ACS handlers
    def on_set_rpl_location(self, playout_id: str, rpl_url: str):
        # A new RPL location always starts a new session, even if the playout
        # ID was seen before (IDs are observed reused without Terminate Lease).
        # Preserve a stashed join-in-progress timeline across the reset.
        pending = self.pending_timeline
        self._reset_session()
        self.pending_timeline = pending
        self.playout_id = playout_id
        self.rpl_url = rpl_url
        self.state = "fetching"
        self._touch_lease()

        try:
            doc = parse_rpl(self.fetch(rpl_url))
        except Exception as e:
            self.warnings.append(f"RPL fetch/parse failed ({e}); no captions")
            self.state = "empty"
            self._respond(playout_id, "ok")
            return

        cues = {}
        for res in doc.resources:
            try:
                parsed = parse_timed_text(self.fetch(res.url), res.language)
            except Exception as e:
                self.warnings.append(f"timed-text fetch/parse failed for "
                                     f"{res.language} ({e}); language skipped")
                continue
            offset = res.entry_point_ms + doc.timeline_offset_ms
            shifted = [replace(c, start_ms=c.start_ms + offset,
                               end_ms=c.end_ms + offset) for c in parsed]
            cues.setdefault(res.language, []).extend(shifted)
        for lang in cues:
            cues[lang].sort(key=lambda c: c.start_ms)
        self.cues_by_lang = cues
        self.warnings.extend(doc.warnings)
        self.scheduler.load(cues, playout_id)

        # Join-in-progress: a timeline arrived before the RPL did.
        if self.pending_timeline is not None:
            pid, pos = self.pending_timeline
            self.pending_timeline = None
            self.on_update_timeline(pid, pos)

        self.state = "ready" if cues else "empty"
        self._respond(playout_id, "ok")

    def on_set_output_mode(self, playout_id: str, enabled: bool):
        if not self._check_playout(playout_id):
            return
        self.output_enabled = bool(enabled)
        self.scheduler.set_transport(playing=self.output_enabled,
                                     position_ms=self.position_ms,
                                     playout_id=self.playout_id)
        self.state = "playing" if self.output_enabled else "ready"
        self._touch_lease()

    def on_update_timeline(self, playout_id: str, position_ms: int):
        if self.playout_id is None:
            # USL section 7: timeline can precede the RPL on mid-show connect.
            self.pending_timeline = (playout_id, position_ms)
            return
        if not self._check_playout(playout_id):
            return
        self.position_ms = position_ms
        self.scheduler.set_transport(playing=self.output_enabled,
                                     position_ms=position_ms,
                                     playout_id=self.playout_id)
        self._touch_lease()

    def on_terminate_lease(self, playout_id: str | None = None):
        self._reset_session()

    # ------------------------------------------------------------- live socket
    def connect(self, host: str, port: int = PORT, timeout: float = 5.0):
        """Open the TCP session to the DCS. The ACS initiates (USL section 7)."""
        self._sock = socket.create_connection((host, port), timeout=timeout)
        self._sock.setblocking(False)

    def pump(self):
        """Read available bytes, decode KLV, dispatch. Returns message count.

        SPEC-GATED: dispatch needs the Annex A UL registry to map keys to
        message types; until then this raises NotImplementedError so nobody
        mistakes the skeleton for a working client.
        """
        raise NotImplementedError(SPEC + ": UL registry (Annex A) not yet loaded")
