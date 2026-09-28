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

## What's SPEC-gated (honest list)

1. **430-10 wire bytes.** The exact UL keys and payload layouts (§§6–7,
   Annex A/B) are paywalled. `csp.py` marks every placeholder `SPEC` and
   `pump()` refuses to run until the Annex A registry is loaded, so the
   skeleton can never be mistaken for a working client.
2. **RPL unit assumptions.** Bare integers in EntryPoint/Duration/TimelineOffset
   are treated as milliseconds; conform against licensed 430-11.
3. **Timed-text shapes.** Parsers cover the documented element shapes; the
   conformance pass happens against real DCP assets on bench hardware.

## Fixtures

`fixtures/` holds small synthetic documents (an RPL, a 428-7 file, a
CineCanvas file) so the parsers and session flow are testable today. They are
clearly synthetic and are not from any real DCP.
