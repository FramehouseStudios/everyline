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
- 2026-09-28: real cinema-server wire implemented. The normative ST 430-10:2010 / ST 430-11:2010 texts turned out to be publicly hosted by SMPTE (formerly paywalled; PDFs are (c) SMPTE, research-only, gitignored). `appliance/csp.py` is now a real CSP client: Annex A UL registry, KLV fixed-4-byte BER lengths, all message layouts, status codes, Request ID echo, DCS-assigned leases, join-in-progress, Bad Request responses, event log, relative-URL resolution, live `pump()`. `appliance/rpl.py` parses the real 430-11 schema with edit-unit time conversion. No open-source 430-10 ACS client exists anywhere (verified); no Wireshark dissector surfaced. 55/55 appliance tests green incl. full sessions over a fake socket. Still bench-gated: DCS quirks (timeline extensions, Update Timeline cadence, real lease durations).
- 2026-09-28: Plex provider hardened against verified API shapes (researched against python-plexapi; Plex publishes no official API docs): auth moved to the canonical `X-Plex-Token` header (never in the URL), mock tightened to real response shapes (`sessionKey`, `Player`, `Session`, `User`, embedded keyless streams skipped), docs now say external/sidecar text subtitles only. 7/7 home-bridge tests green.
- 2026-09-28: Meta Display renderer written. `companion/ios/MetaDisplayRenderer.swift` implements the same 4-method LensRenderer contract against the real Wearables DAT Display capability (MWDATDisplay 0.7.0: `addDisplay()`, `send(FlexBox { Text })`, `DisplayState.started`, `clearDisplay()`); uncompiled — needs Xcode. Documented the second path too: the PWA can render on the glasses directly as a Meta web app via `fb-viewapp://` deep link (600x600, firmware v125+, same-LAN WebSocket caveat). Companion 18/18, backend 12/12 green.
- 2026-09-28: simulated cinema server built and the appliance tested against it. `appliance/sim_dcs.py` is a fake DCS speaking real ST 430-10 over TCP (Announce first, scripted session, verifies every ACS response: Request ID echo, status codes) plus an HTTP file server for the RPL and timed-text. `appliance/tests/test_sim_dcs.py` runs the real `CspClient.connect()`/`pump()` over loopback: full session (8 wire exchanges, all status 0, captions flow), terminate reset, playout-ID mismatch, bad request, RPL playout mismatch. 60/60 appliance tests green, loopback stable across 5 repeat runs. `appliance/run_sim_session.py` prints a watchable session transcript. Also fixed: demo booth needed `websockets` installed on a fresh VM; verified the demo booth simulator streams cues on schedule again via WebSocket smoke test.
- 2026-09-28: Xcode work started from Linux. No Xcode here and the paired Mac has no shell runner, so the deliverable is everything short of the compile: every symbol in `companion/ios/` was verified against Meta's vendored DAT SDK sources (display-access + mockdevice-testing skills, DisplayAccess sample). That caught two real bugs in the renderer: `capability.start()` was called AFTER waiting for `.started` (the display only reports `.started` after `start()`, so it would have hung), and the state-listener token was typed `Any?` instead of `AnyListenerToken`. Also added `session.errorStream()` observation. New: `MockDisplayPreview.swift` boots MockDeviceKit and pairs a simulated `.metaRayBanDisplay` so the renderer runs in the iOS Simulator with no glasses (`createPreviewView()` shows what the glasses would show). `ios/` is now a Swift package (`Package.swift`, DAT SDK 1.0.0 via SPM, iOS 17+); open it in Xcode to build. `ios/README.md` documents the exact build steps, the simulator test, and the host app's responsibilities (Wearables.configure, Info.plist, URL scheme). First Xcode build is still the source of truth.
