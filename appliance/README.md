# everyline booth appliance

The software that lives on the booth box: it speaks SMPTE 430-10/430-11 to the
cinema server, turns the DCP's caption track into scheduled cues, and emits
them per the [Cue Stream Protocol](../demo/protocol.md).

Pure Python, standard library only. Run the tests with:

```sh
python3 -m unittest discover -s tests -v
```

## What's real

- `klv.py` — KLV framing per ST 336 (generic encoding rules). Complete and tested.
- `scheduler.py` — cue scheduling with lookahead, pause/seek/loop handling,
  playout-ID mismatch discard, join-in-progress lookup. Complete and tested.
  This is the production version of the logic prototyped in `demo/booth.py`.
- `rpl.py` — 430-11 RPL parsing with defensive handling of field quirks
  (nonstandard language codes, empty resources, dead URLs).
- `timedtext.py` — SMPTE ST 428-7 (2010 + 2014 namespaces) and Interop
  CineCanvas parsers, both reducing to `Cue(start_ms, end_ms, text)`.
- `csp.py` — the CSP session: connection model, the full message flow from
  USL's public implementation notes, lease handling, join-in-progress.

## What changed: the wire is real now

2026-09-28: the normative texts of ST 430-10:2010 and ST 430-11:2010 are
publicly hosted by SMPTE (see `research/`). `csp.py` now speaks the real
protocol: TCP 4170, KLV framing with fixed 4-byte BER lengths, the Annex A
UL registry, per-message payload layouts, status codes, Request ID echo,
lease semantics, the join-in-progress path, and log event access. `rpl.py`
parses the real 430-11 schema with edit-unit time conversion. 55/55 tests
green, including full sessions driven over the wire through a fake socket.

The standard PDFs are © SMPTE, All Rights Reserved — they are research
material only, gitignored, never committed. The code is our own clean-room
implementation of the wire facts.

## What's still bench-gated (honest list)

1. **DCS quirks in the wild.** The protocol is standard; individual servers
   are not. Open questions only a real cinema server answers: which timeline
   extensions (keys 0–5) get used and when, how often DCSs actually send
   Update Timeline, real-world lease durations, and servers that never send
   Set Output Mode.
2. **Timed-text shapes.** Parsers cover the documented element shapes; the
   conformance pass happens against real DCP assets on bench hardware.

## Fixtures

`fixtures/` holds small synthetic documents (an RPL, a 428-7 file, a
CineCanvas file) so the parsers and session flow are testable today. They are
clearly synthetic and are not from any real DCP.
