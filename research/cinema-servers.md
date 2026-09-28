# Booth Appliance ↔ Cinema Server Integration (SMPTE 430-10 / 430-11)

Technical research memo — 2026-09-28
Status: research only, no code. Every factual claim cites its source. Anything labeled **Inference** is my read, not a sourced fact. Anything labeled **Unverified** is a gap.

---

## 0. TL;DR

- The integration surface is real and standardized: a booth appliance acts as an **Auxiliary Content Server (ACS)** speaking **SMPTE 430-10 (CSP)** to the cinema server (**DCS**) over **TCP port 4170** (KLV-encoded messages), and reads **430-11 (RPL)** XML documents that point at the DCP's timed-text files, which it fetches over HTTP.
- **GDC** (SR-1000 brochure: "Support SMPTE430-10" under third-party closed-captioning integration) and **Christie** (CP4230 spec: "Support for SMPTE 430-10") explicitly document third-party CSP support. **Dolby** ships its own accessibility server that connects to "most digital cinema servers." Barco-specific confirmation was **not found**.
- Two proof points that this exact architecture works commercially: **WatchWord** (UK, streams the DCP's CC track direct over WiFi to glasses, nothing preloaded) and **Dolby Accessibility Solution** (March 2025: DAS-110 booth server + per-auditorium WiFi router + receivers; dual GbE, 6–12 W).
- The full text of both standards is **paywalled at SMPTE**; only front-matter samples are public. The single best public implementation guide is **USL's "Making Captions Better"** (Harold Hallikainen, 2012) — written from building a real ACS (their CCE-100/IRC-28C captioning products) and full of vendor interop quirks.
- **No open-source CSP client implementation was found.** The TCP/KLV protocol stack will have to be built from the standard. Open-source timed-text *parsers* exist (DCP-o-matic, clairmeta).

---

## 1. SMPTE 430-10 (CSP) and 430-11 (RPL)

### 1.1 What each specifies

**SMPTE ST 430-10:2010 — Auxiliary Content Synchronization Protocol** defines the wire protocol "for synchronizing auxiliary resources in an Auxiliary Resource Presentation List (RPL) to the playback timeline," intended for use between a Digital Cinema Server (DCS) and one or more Auxiliary Content Servers (ACS). Named examples: caption servers, special-effects servers, secondary display servers. ([430-10 sample, §5 Overview](https://www.normsplash.com/Samples/SMPTE/184478258/SMPTE-ST-430-10-2010-en.pdf))

**SMPTE ST 430-11:2010 — Auxiliary Resource Presentation List** defines the XML document schema: "a document for specifying the location of resources on a digital cinema server and the corresponding position at which they should be presented during the play out of a single composition or a show comprised of multiple compositions." ([430-11 sample, §1 Scope](https://www.normsplash.com/Samples/SMPTE/131295358/SMPTE-ST-430-11-2010-en.pdf))

In short: 430-10 is the *conversation* (who talks to whom, when), 430-11 is the *menu* (what auxiliary resources exist for this show, where to fetch them, where they sit on the timeline).

### 1.2 Connection model — port 4170 verified

- **Established:** CSP runs over **TCP port 4170**, with messages encoded as **KLV** (Key-Length-Value per SMPTE ST 336). The 430-10 normative references cite ST 336 (KLV data encoding) and IANA port assignments. ([430-10 sample, §3](https://www.normsplash.com/Samples/SMPTE/184478258/SMPTE-ST-430-10-2010-en.pdf))
- **Established:** USL's implementation notes state the DCS "should allow for more than one CSP connection on port 4170" since 430-10 permits multiple ACS devices, and recommend filtering CSP traffic in Wireshark with `tcp.port==4170`. ([USL, "Making Captions Better", §1](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- **Established:** The ACS initiates the TCP connection to the DCS (USL describes the ACS connecting while a show is already playing, and the DCS then reporting status to it). ([USL §7](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- **Inference:** The appliance therefore needs a routable TCP path to each auditorium's cinema server on port 4170 — typically the booth LAN. No internet connectivity is involved in this leg.

### 1.3 Message flow

The full message table (430-10 §§6–7, "Control Protocol," "General Purpose Messages," "Status Responses") is in the paywalled portion of the standard. What is established from public sources:

1. **Set RPL Location** — the DCS tells the ACS the URL of the RPL for the upcoming/current show. Carries a **playout ID** that "is to be unique" per §7.2.4.1; the ACS associates that ID with the RPL, the fetched timed-text files, and every caption it will display. ([USL §5](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
2. **ACS fetches and parses** — on receiving the RPL URL, the ACS fetches the RPL **over HTTP**, parses it, then fetches and parses the timed-text caption file **for each language to be displayed**. USL measured ~2 seconds to ready on typical content, ~22 seconds on pathological content (their Fox CC Sync Test). ([USL §1](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
3. **Status responses** — the ACS replies with status **OK** (ready) or **Processing** (still fetching/parsing); **BadRequest** exists as an error response. ([USL §§2,4](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
4. **Set Output Mode Enabled** — the DCS sets output mode when playing content with synchronous auxiliary content. Per §7.2.5, "The DCS shall set the output mode to enabled when playing out content that has synchronous auxiliary content." USL notes the Annex B sample transaction shows this *after* the ACS returns status OK, but argues output mode should always mirror actual run/stop state even if the ACS isn't ready yet. ([USL §4](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
5. **Update Timeline** — sent regularly during playout so the ACS can track playback position. ([USL §7](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
6. **Terminate Lease** — ends the session and "erases all knowledge of previous information" (including playout IDs, so IDs may be reused after). ([USL §5](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))

**Annex B** of 430-10 contains a full example transaction (informative) — paywalled, but its existence is confirmed in the sample's table of contents. ([430-10 sample, ToC](https://www.normsplash.com/Samples/SMPTE/184478258/SMPTE-ST-430-10-2010-en.pdf))

### 1.4 Timing / sync semantics

- **Established:** The RPL maps auxiliary resources to the playback timeline: each `ReelResources` element correlates to one CPL reel, each `ReelResource` to one reel asset; a `TimelineOffset` attribute gives show-relative offsets when one RPL spans multiple compositions. Resources are "intended to be prefetched before start of playout to allow for synchronous playout with the first frame of content." ([430-11 sample, §5](https://www.normsplash.com/Samples/SMPTE/131295358/SMPTE-ST-430-11-2010-en.pdf))
- **Established:** The ACS plays captions in RPL order per language stream, computing each caption's display time from the RPL's offset/entry-point data plus the timed-text file's start times. When a timeline update arrives, the ACS matches the update's playout ID against the pending caption's playout ID — on mismatch, the caption is discarded. ([USL §5](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- **Inference:** The DCS is the clock. The ACS does not run its own free-running timeline; it advances/positions captions off the DCS's Update Timeline messages. This is what makes pause/resume correct without extra logic on our side — see below.

### 1.5 Pause / resume behavior

- **Established:** Output mode must reflect the DCS's actual run/stop state at all times (§7.2.5, via USL). USL recommends sending a timeline update *before* playout starts, then output-enabled *when* playout starts, then regular timeline updates during playout. ([USL §§4,8](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- **Inference:** On pause, the DCS stops advancing (or stops sending) timeline updates and/or clears output-enabled; the ACS freezes caption emission. On resume, updates restart and captions continue. Our appliance should treat "no advancing timeline + output disabled" as paused and hold the last state rather than extrapolating.
- **Established quirk:** If the ACS connects mid-show, the DCS should immediately report current status: USL recommends the sequence **Update Timeline → Set Output Mode Enabled → Set RPL Location** (timeline first, so the ACS can skip fetching timed-text files for reels already past). ([USL §7](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf)) Our appliance must handle this join-in-progress path, since it may boot or reconnect at any time.

### 1.6 Leases

- **Established:** CSP has a lease mechanism with a negotiated lease time. USL recommends ~60 seconds and warns that some servers request 5-second leases, which can expire on any slight delay and wipe the ACS's content. ([USL §9](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- **Inference:** Our client must renew/request sensibly long leases and treat lease expiry as a full state reset.

### 1.7 When to send the RPL URL (matters for "perfect sync")

- **Established:** USL's #1 interop recommendation: the DCS should send the RPL URL **as soon as the show is loaded, not when play is pressed** (and for scheduled playout, when the next show is loaded). Rationale: the ACS needs the fetch+parse window (2–22 s measured) to have captions ready for the first frame. USL further suggests the DCS optionally hold playout 30–60 s if the ACS reports Processing when play is pressed — but not wait at all if no ACS is connected. ([USL §§1–3](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- **Implication for us:** Whether captions are ready for frame one depends partly on DCS-vendor behavior we don't control. Our appliance should connect persistently (not per-show) and prefetch aggressively the moment Set RPL Location arrives.

---
## 2. Cinema server vendor support for third-party CSP clients

| Vendor | Evidence of third-party CSP (430-10) support | Notes / quirks |
|---|---|---|
| **GDC** | **Confirmed.** SR-1000 brochure lists under "Third-party Integration Options": "Closed Captioning Device — Support SMPTE430-10". Also lists "Projector Cinecanvas support" and subtitle overlay. ([GDC SR-1000 brochure](https://mrln.pro/upload/grain.tables/b35/1.-SR_1000-brochure.pdf)) | GDC is a top-tier vendor for US regional chains (e.g., GQT Movies' 49-unit SR-1000 deal). ([Boxoffice Pro](https://www.boxofficepro.com/gqt-movies-partners-with-gdc-and-ces-plus-to-upgrade-content-playback-and-sound/)) No public detail on their CSP configuration UI or lease behavior — unverified. |
| **Christie** | **Confirmed.** CP4230 spec sheet: "Closed captioning devices: Support for SMPTE 430-10". ([Christie CP4230 specs](https://www.realfilms.in/cinema-projectors.html)) | Spec-sheet line only; no public integration manual found. |
| **Dolby / Doremi** | **Confirmed in practice.** Dolby's own Accessibility Solution server "connects to your digital cinema server" and is "compatible with most digital cinema servers," streaming CC from the DCP — i.e., Dolby itself is a CSP client vendor. ([Dolby Accessibility Solution, Mar 2025](https://professional.dolby.com/siteassets/professional-images/dolby_accessibility_solution_product_sheet-march_2025.pdf)) | Dolby is both a server vendor and now a direct competitor in this exact architecture (see §4). No public statement found on third-party ACS access to Dolby servers specifically — unverified, but their own product proves the interface exists on their servers. |
| **Barco / Cinionic** | **Unverified.** No public source found confirming SMPTE 430-10 third-party client support on Alchemy/ICMP media servers. | WatchWord and Dolby both claim "compatible with most digital cinema servers," which presumably includes Barco, but neither names vendors. Needs direct verification with Barco/Cinionic. |
| **QSC / Qube / NEC** | **Unverified.** No public sources found. | Lower installed-base share; deprioritize for v1. |

**General interop reality (from USL's field notes — applies across vendors):**
- Some servers send RPL URLs pointing at nonexistent files when content has no captions; ACS must not spin retrying forever. Send nothing, or an empty RPL, is the recommended DCS behavior. ([USL §430-11 notes](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- Empty `ReelResource` elements (missing required `ResourceFile`) occur in the wild; language attributes are sometimes nonstandard (`"English"` instead of `"en"` — the standard wants RFC 3066/ISO 639 codes). Parse defensively. ([USL](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- Playout IDs have been observed reused without an intervening Terminate Lease — the ACS must key captions strictly to (playout ID + timeline) and discard on mismatch. ([USL §5](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- Looping shows: DCS may not unroll loops; a backwards timeline step under the same playout ID can force refetch. ([USL §6](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))

**Certification:** No public "CSP certification program" was found. Interop in practice = testing against real servers (USL tested against their own CCE-100/IRC-28C and observed DCS behaviors in the field). Expect per-vendor bench testing to be the actual certification path.

---

## 3. Timed-text formats: SMPTE ST 428-7 vs Interop

The appliance must parse **both** — WatchWord and Dolby both advertise "SMPTE and Interop DCPs."

**SMPTE ST 428-7 (modern):**
- XML-based subtitle/caption format; current edition 428-7:2014 with namespace `http://www.smptera.org/schemas/428-7/2014/DCST` (the 2010 namespace `.../428-7/2010/DCST` must still be supported by decoders). Root element per reel: `SubtitleReel`. ([ST 428-7:2014 sample](https://www.normsplash.com/Samples/SMPTE/171485177/SMPTE-ST-428-7-2014-en.pdf))
- In SMPTE DCPs the timed-text XML is wrapped in MXF; fonts travel as separate assets. Timecodes are frame-based with explicit edit rates.

**Interop (legacy, "CineCanvas"):**
- The older DCI interim format: a `DCSubtitle` XML document (TI CineCanvas), **not MXF-wrapped** — XML and font sit loose in a package subfolder. Timecodes are **tick-based (1 tick = 4 ms)**, not frame-based; font referenced by filename (e.g. `Arial.ttf`) rather than UUID. ([Subtitle Edit guide](https://www.knuterikevensen.com/2021/10/17/converting-srt-to-smpte-xml-in-subtitle-edit/), [CineCanvas-XML](https://github.com/IgorRidanovic/CineCanvas-XML/blob/master/README.md))
- Understood by essentially every server ever deployed; still common in the field.

**How the client obtains them:** The RPL's `ResourceFile` elements give URLs (served by the DCS over HTTP) for each timed-text asset. The ACS fetches one file **per language** it intends to display. The RPL's language attribute identifies the track; expect nonstandard values in the wild (see §2).

**Multi-language:** DCPs routinely carry several timed-text tracks. The RPL exposes each as a separate resource; Dolby's product supports user selection from "up to 6 CC languages depending on the languages contained in the DCP." ([Dolby](https://professional.dolby.com/siteassets/professional-images/dolby_accessibility_solution_product_sheet-march_2025.pdf)) Our appliance should fetch/parse all languages present (files are small) and let the phone app select.

---

## 4. Existing implementations

### Commercial (same architecture as ours)
- **WatchWord (Built For Good, UK):** "The server connects to your digital cinema server(s) and WiFi infrastructure… When a DCP with a CC track is played, the WatchWord server connects to the projection system and streams the CC track direct over WiFi… No captions are preloaded onto the glasses or retained; captions are sourced direct from the playing DCP." Theater pays an annual license; compatible with most servers; SMPTE + Interop. ([WatchWord product sheet](http://mail.yourlocalcinema.com/watchwordglasses.pdf)) — the existence proof for Plan A.
- **Dolby Accessibility Solution (DAS-110 server + DAS-210 receiver + DAS-300 WiFi router), March 2025:** server connects to the cinema server, streams HI/VI-N/CC from the DCP over a dedicated per-auditorium WiFi router, "avoiding synchronization issues associated with cloud-based solutions." This is the closest thing to our appliance built by an incumbent — and a direct competitor. ([Dolby product sheet](https://professional.dolby.com/siteassets/professional-images/dolby_accessibility_solution_product_sheet-march_2025.pdf))
- **USL (uslinc.com):** built the CCE-100/IRC-28C captioning products on 430-10/430-11; their engineering notes are the best public implementation guide. ([USL notes](https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf))
- **Sony Entertainment Access Glasses** (Regal, ~2012): earlier glasses approach, but theater-owned $1,750 loaner hardware — the model we're replacing, not a protocol reference.

### Open source
- **No open-source CSP (430-10) client implementation was found** via web/GitHub search (2026-09-28). The TCP/KLV protocol stack will need to be implemented from the standard. This is a real but bounded task: the message set is small (a handful of request/response pairs).
- **Timed-text parsing — open source exists:**
  - **DCP-o-matic** (dcpomatic.com) — open-source DCP mastering/player; handles SMPTE and Interop timed text. Its subtitle parsing code is the best open reference for 428-7 + CineCanvas XML. ([via amazing-digital-cinema list](https://github.com/avtools-io/amazing-digital-cinema/blob/HEAD/README.md))
  - **clairmeta** ([github.com/clairmeta/clairmeta](https://github.com/clairmeta/clairmeta/blob/HEAD/README.rst)) — Python DCP probe/checker with "deep inspection of Interop and SMPTE subtitles." Useful as a parsing reference and test harness.
  - **CineCanvas-XML** ([github.com/IgorRidanovic/CineCanvas-XML](https://github.com/IgorRidanovic/CineCanvas-XML/blob/master/README.md)) — small Python generator for Interop subtitle XML; documents the tick-based timecode scheme.

---

## 5. Appliance design: booth placement, networking, latency

### Physical / network placement
- **Reference design (Dolby DAS-110):** 8.1" × 8.1" × 2.2", 2.7 lb, **2× Gb Ethernet** — one port for control (to the cinema server), one for the WiFi network — plus web-based UI, 6–12 W average. ([Dolby](https://professional.dolby.com/siteassets/professional-images/dolby_accessibility_solution_product_sheet-march_2025.pdf)) Our appliance should mirror this: a small fanless x86/ARM box, dual NIC.
- **Why dual-homed:** booth LANs are typically isolated/secure networks. The appliance needs one leg into the booth LAN (CSP on TCP/4170 to the DCS + HTTP fetch of RPL/timed-text) and a separate leg to the patron-facing WiFi. Bridging the two is a security decision the exhibitor's IT must bless — expect this to be a deployment conversation, not just a cable.
- **Inference:** One appliance can likely serve multiple auditoriums (WatchWord's server "connects to your digital cinema server(s)," plural), holding one CSP session per DCS. Per-auditorium WiFi coverage is the scaling constraint — Dolby ships one router per auditorium ("for especially large auditoriums, more than one").

### Reaching patrons' phones
- **Established:** Both WatchWord ("streams the CC track direct over WiFi") and Dolby (dedicated per-auditorium WiFi router, dual-band 2.4/5 GHz) use a **dedicated auditorium WiFi network**, not the theater's guest WiFi. ([WatchWord](http://mail.yourlocalcinema.com/watchwordglasses.pdf), [Dolby](https://professional.dolby.com/siteassets/professional-images/dolby_accessibility_solution_product_sheet-march_2025.pdf))
- **Inference / design decision (not standardized):** how cues get from appliance to phone is our choice. Options:
  - **Per-client stream (WebSocket/SSE):** simple, handles per-user language selection and join-in-progress (send current caption + recent history on connect). Cost: one stream per patron; trivial at theater scale (<300 clients).
  - **Multicast (UDP):** one stream for the room, all languages interleaved. More efficient but harder through phone WiFi stacks (multicast is often filtered on mobile) and complicates per-language selection.
  - **Recommendation:** per-client WebSocket/SSE with language as a subscribe parameter; stateless enough to survive reconnects. Discovery via QR code at the seat ( encodes auditorium endpoint) or mDNS on the auditorium WiFi.
- **Unverified:** whether exhibitors will allow a second WiFi network per auditorium or insist on VLANs over existing infrastructure — deployment detail to confirm in pilot talks.

### Latency budget (inference, engineering estimates)
Caption cues are known *before* their display time (prefetched timed-text), so the appliance can emit each cue slightly early and the phone can schedule display against a shared clock. Budget sketch:
| Hop | Estimate |
|---|---|
| DCS timeline granularity → appliance | ~0–100 ms (timeline update cadence; vendor-dependent) |
| Appliance → phone over auditorium WiFi | ~10–50 ms |
| Phone app → Meta glasses via Wearables SDK | **unverified** — needs measurement; likely tens of ms over BLE |
| **Total** | plausibly **< 200 ms** end to end |

Because cues are pre-scheduled (not reactive), small network jitter is absorbable: emit cues ~250–500 ms early with presentation timestamps and let the phone hold-and-fire. Clock sync between appliance and phone: NTP over the local WiFi, or relative timestamps from stream connect. **The DCS↔appliance leg is the only hard-real-time sync; everything downstream is scheduled playout.**

---

## 6. Open unknowns — what a builder still needs

1. **The full 430-10 message set.** Public samples cover only front matter (ToC confirms §§6–7, Annex A UL keys, Annex B example transaction exist but are paywalled). **Buy ST 430-10:2010 and ST 430-11:2010 from SMPTE** before writing the protocol stack. (Check for newer editions first — only the 2010 editions were verified here.)
2. **Barco/Cinionic CSP support.** Unconfirmed. Also unconfirmed: per-vendor CSP enablement UI, auth requirements, and lease-time behavior on GDC/Christie/Dolby servers beyond USL's 2012 notes.
3. **HTTP serving of RPL/timed-text by the DCS.** USL establishes the ACS fetches these over HTTP from DCS-provided URLs, but auth, TLS, and URL schemes are undocumented publicly. Likely plain HTTP on the booth LAN — verify on real hardware.
4. **DCI security/compliance posture.** Does attaching a third-party ACS require anything of the auditorium's DCI compliance (e.g., is the caption track considered "essence" with forensic-marking implications)? Captions are plaintext metadata, not encrypted essence — **inference:** no SPB/security-block involvement — but confirm with a vendor.
5. **No open-source reference client.** Budget to write and harden the KLV/TCP stack from scratch, using Wireshark captures against a real server as ground truth (USL's suggested workflow).
6. **Exhibitor IT policy.** Dual-homed box + per-auditorium WiFi is a network-security conversation with each chain. Dolby's product sheet is useful precedent to put in front of them.
7. **Patent/licensing.** SMPTE's 2010 foreword states no essential patent claims had been notified at publication. ([430-10 sample, Foreword](https://www.normsplash.com/Samples/SMPTE/184478258/SMPTE-ST-430-10-2010-en.pdf)) Not legal advice; recheck before commercializing.

---

## Sources

- SMPTE ST 430-10:2010 sample (paywalled full text) — https://www.normsplash.com/Samples/SMPTE/184478258/SMPTE-ST-430-10-2010-en.pdf
- SMPTE ST 430-11:2010 sample (paywalled full text) — https://www.normsplash.com/Samples/SMPTE/131295358/SMPTE-ST-430-11-2010-en.pdf
- SMPTE ST 428-7:2014 sample (paywalled full text) — https://www.normsplash.com/Samples/SMPTE/171485177/SMPTE-ST-428-7-2014-en.pdf
- USL, "Making Captions Better" (Harold Hallikainen, rev. 2012-01-26) — https://hallikainen.org/usl/ftp.uslinc.com/Products/MultiProduct/Documents/MakingCaptionsBetter120126.pdf
- GDC SR-1000 brochure — https://mrln.pro/upload/grain.tables/b35/1.-SR_1000-brochure.pdf
- Christie CP4230 spec (via dealer page) — https://www.realfilms.in/cinema-projectors.html
- Dolby Accessibility Solution product sheet (Mar 2025) — https://professional.dolby.com/siteassets/professional-images/dolby_accessibility_solution_product_sheet-march_2025.pdf
- WatchWord product sheet — http://mail.yourlocalcinema.com/watchwordglasses.pdf
- Interop/CineCanvas subtitle format notes — https://www.knuterikevensen.com/2021/10/17/converting-srt-to-smpte-xml-in-subtitle-edit/
- CineCanvas-XML (open source) — https://github.com/IgorRidanovic/CineCanvas-XML/blob/master/README.md
- DCP-o-matic (open source) — https://dcpomatic.com/ (listed at https://github.com/avtools-io/amazing-digital-cinema/blob/HEAD/README.md)
- clairmeta (open source) — https://github.com/clairmeta/clairmeta/blob/HEAD/README.rst
