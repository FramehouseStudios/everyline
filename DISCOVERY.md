# Glasses Captions — Discovery Brief

Product: real-time movie captions on the patron's own Meta glasses. No theater loaner hardware.
Status: active discovery. No code until io.them V1 TestFlight ships (2026-10-04).

## Decision (2026-09-28)
Plan A: partner with the theater. A small booth appliance reads the DCP caption track
through the cinema server's standard caption protocol (SMPTE 430-10 CSP / 430-11 RPL)
and streams cues over auditorium WiFi to the patron's phone, which renders them on
Meta display glasses via the Wearables Device Access Toolkit.
Plan B (room-audio transcription) stays as the fallback mode for unequipped theaters.

## Why now
- Meta opened Ray-Ban Display to third-party developers in May 2026. Platform nearly
  empty, publishing invite-only.
- US incumbents are compliance hardware everyone resents: Sony Access Glasses at Regal
  (2012, ~6,000 screens, $1,750/pair), cupholder displays elsewhere.
- The Nov 2016 DOJ ADA rule forces theater budgets for captioning and is
  technology-neutral: substitutes "as effective as" closed captioning are permitted,
  but minimum device counts were written around theater-owned hardware. Enter as a
  layer on top, not a rip-and-replace.
- WatchWord (UK, Built For Good) proved the booth-appliance model commercially.

## The three gates (all must become true)
1. One exhibitor willing to pilot.
2. A working booth appliance speaking the cinema server caption protocol.
3. A real conversation with Meta's wearables team (publishing is gated).

## Discovery tracks
1. Cinema server integration surface (started 2026-09-28): SMPTE 430-10/430-11,
   vendor quirks (Dolby, GDC, Christie, Barco), timed-text formats (SMPTE ST 428-7
   vs Interop), booth network/hardware needs. Output: research/cinema-servers.md
2. Competitive + IP scan: WatchWord footprint and US-expansion signals, GalaPro,
   patent landscape for caption streaming to glasses.
3. Meta platform limits: Display capability (text rendering, latency, push model),
   developer program entry, publishing process.
4. Exhibitor path (Joshua-owned): warm intros to chains or regional exhibitors.

## Open questions
- Does the booth appliance need per-vendor certification? What does it cost?
- Minimum viable pilot: single auditorium? single regional chain?
- Business model: per-auditorium annual license (WatchWord model) vs alternatives.
- Platform risk: Meta shipping this as a first-party accessibility feature.

## Build log
- 2026-09-28: booth-to-lens demo working (simulated booth, cue protocol v0, EN/ES tracks, lens-view client). Verified: cue lead time, pause freeze, seek, language switch.
- 2026-09-28: backend control plane built (Node/Express/SQLite): theaters, auditoriums, appliance registration + heartbeat, shows, patron discovery. 9/9 tests green. Caption content never touches the backend; cue stream stays on LAN.
- Next: production booth appliance (real SMPTE 430-10 client; needs paywalled spec docs + bench time on a real cinema server), Meta Wearables companion app.
- 2026-09-28: booth appliance core built (Python, stdlib only): KLV framing per ST 336, CSP session skeleton (message flow from USL notes; wire bytes SPEC-gated on licensed 430-10), RPL parser with field-quirk defenses, ST 428-7 + CineCanvas timed-text parsers, cue scheduler emitting protocol v0. 37/37 tests green.
- 2026-09-28: companion phone app built (PWA, `companion/`): join via discovery, WebSocket cue stream, booth-clock-synced rendering, language switch, reconnect backoff, PWA manifest. Key seam: `LensRenderer` is a 4-method interface; the Meta Wearables Display SDK plugs in there without touching stream/clock/player. 13/13 tests green (incl. scripted-booth stream test with reconnect cycle). Verified end-to-end against the live demo booth: EN cues on schedule, pause freezes, seek + ES switch.
- 2026-09-28: at-home watching added. `home-bridge/` (Node/Express, 7/7 tests green): speaks Cue Stream Protocol v0 with two providers — manual tap-to-sync SRT (works with any source) and Plex true sync (sessions API for position, subtitle stream download; tested against a mock Plex, needs a real server to verify live). Companion grew Theater/Home/Demo modes, a `CueSource` interface (`BoothStream` for booth+bridge, `DemoSource` virtual booth on the phone), caption size control, reduced-motion support, honest source badges. 15/15 companion tests green. Bridge verified end-to-end: REST load + play drove the real companion stream stack. One protocol, three sources; the phone can't tell them apart.
- 2026-09-28: seat QR flow built. Backend gained public endpoints (no operator token in the QR): `GET /v1/public/now-playing` and a printable seat-side page `GET /v1/public/auditoriums/:id/join` with a QR encoding the companion deep link `?source=theater&backend=&theater=&auditorium=`. Companion joins tokenless via the public endpoint; a tokened link still gets the operator path. `src/join.js` holds the parse/build helpers (3 tests). App icon drawn (black rounded square, amber caption lines): icon-192/512/1024 + apple-touch-icon, wired into the manifest. Backend 12/12, companion 18/18 tests green. Full theater loop now closes: backend → QR → scan → live captions.
