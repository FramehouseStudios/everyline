// CuePlayer: cues in, display/clear actions out.
//
// Each tick recomputes which cue (if any) is visible at the booth clock's
// position. That makes it immune to seeks, loops, and pause/resume: the
// position jumps, the visible cue is simply re-derived. No extrapolation,
// no timers per cue. Pure logic, no DOM, fully tested.

export class CuePlayer {
  constructor({ clock, onDisplay, onClear }) {
    this.clock = clock;
    this.onDisplay = onDisplay;
    this.onClear = onClear;
    this.reset();
  }

  reset() {
    this.cues = [];
    this.currentId = null;
    this.lang = null;
  }

  setLanguage(lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    // New language takes over on the next tick; clear now so the old
    // language's cue never lingers.
    this.currentId = null;
    this.onClear();
  }

  pushCue(cue) {
    if (!cue || typeof cue.startMs !== 'number') return;
    if (this.cues.some((c) => c.id === cue.id)) return; // idempotent
    this.cues.push(cue);
    this.cues.sort((a, b) => a.startMs - b.startMs);
    // A film holds ~1-2k cues; prune the long past so a long session
    // never grows without bound.
    if (this.cues.length > 5000) {
      const horizon = this.clock.now() - 60000;
      this.cues = this.cues.filter((c) => c.endMs > horizon);
    }
  }

  tick() {
    const t = this.clock.now();
    const pool = this.lang ? this.cues.filter((c) => c.lang === this.lang) : this.cues;
    // Latest-starting cue that covers t. Cues are sorted, so the first cue
    // starting after t ends the search.
    let visible = null;
    for (const c of pool) {
      if (c.startMs > t) break;
      if (c.endMs > t) visible = c;
    }
    const vid = visible ? visible.id : null;
    if (vid !== this.currentId) {
      this.currentId = vid;
      if (visible) this.onDisplay(visible);
      else this.onClear();
    }
  }
}
