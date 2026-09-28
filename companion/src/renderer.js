// LensRenderer: the seam where the Meta Wearables SDK will plug in.
//
// Contract: showCue(cue), clear(), setStatus(...), setLang(lang).
// WebRenderer implements it with DOM today (the "simulated lens").
// A future MetaDisplayRenderer implements the same four methods against
// the Wearables Device Access Toolkit's Display capability; everything
// above this file (stream, clock, player, app flow) stays untouched.

export class WebRenderer {
  constructor(root) {
    this.root = root;
    this.cueEl = root.querySelector('.cue-text');
    this.statusEl = root.querySelector('.status-line');
    this.langRow = root.querySelector('.lang-row');
  }

  showCue(cue) {
    this.cueEl.textContent = cue.text;
    this.cueEl.classList.add('visible');
  }

  clear() {
    this.cueEl.classList.remove('visible');
  }

  setLang(lang) {
    if (!this.langRow) return;
    this.langRow.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
  }

  setStatus({ state, title, source, lang } = {}) {
    if (!this.statusEl) return;
    const bits = [];
    if (title) bits.push(title);
    if (state === 'live') bits.push('● live');
    else if (state === 'connecting') bits.push('connecting…');
    else if (state === 'reconnecting') bits.push('reconnecting…');
    else if (state === 'closed') bits.push('disconnected');
    if (lang) bits.push(lang.toUpperCase());
    // Honest source badges: simulated and demo sources say so.
    if (source === 'simulated') bits.push('(simulated booth)');
    else if (source === 'demo') bits.push('(demo)');
    this.statusEl.textContent = bits.join(' · ');
    this.statusEl.classList.toggle('warn', state === 'reconnecting' || state === 'connecting');
  }
}
