// Manual provider: the tap-to-sync path.
//
// Load an SRT (per language), then drive transport by hand: press play on
// the TV, tap play here. Works with any source — Netflix, Blu-ray, a file —
// because the bridge doesn't care where the picture comes from. Drift over
// a long film is corrected with a re-tap on seek.

import { MediaClock } from '../clock.js';
import { parseSrt } from '../srt.js';

export class ManualMedia {
  constructor() {
    this.clock = new MediaClock();
    this.tracks = new Map(); // lang -> cues
    this.title = 'Manual sync';
  }

  load(lang, srtText, title) {
    const cues = parseSrt(srtText);
    if (!cues.length) throw new Error('no cues parsed from SRT');
    this.tracks.set(lang, cues);
    if (title) this.title = title;
    this.clock.seek(0);
    this.clock.pause();
    return cues.length;
  }

  languages() {
    return [...this.tracks.keys()];
  }

  cues(lang) {
    return this.tracks.get(lang) || [];
  }

  async state() {
    return this.clock.snapshot();
  }

  play() {
    this.clock.play();
  }

  pause() {
    this.clock.pause();
  }

  seek(ms) {
    this.clock.seek(ms);
  }
}
