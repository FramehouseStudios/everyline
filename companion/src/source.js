// CueSource: where captions come from.
//
// Contract (mirrors what the app needs from a booth):
//   connect(url?)      -> emits welcome via handlers, then cue/transport
//   subscribe(lang)    -> switch language; re-emits lookahead for the new one
//   close()
//   handlers: { onWelcome, onCue, onTransport, onStatus, onLanguage }
//
// BoothStream (stream.js) implements it over WebSocket for theaters and
// home bridges. DemoSource implements it locally with a virtual clock and
// bundled SRTs, so the phone alone can demo the product with no booth,
// no backend, no network at all.

const LOOKAHEAD_MS = 750;

export class DemoSource {
  constructor({ handlers = {}, tracks = {}, now = () => Date.now(), tickMs = 250 }) {
    this.h = handlers;
    this.tracks = tracks; // { en: [cues], es: [cues] }
    this._now = now;
    this._tickMs = tickMs;
    this.lang = 'en';
    this.pos = 0;
    this.playing = false;
    this.sent = new Set();
    this._timer = null;
    this._last = 0;
  }

  connect() {
    this._emit('onStatus', 'connecting');
    this._emit('onWelcome', {
      type: 'welcome',
      protocol: 0,
      showing: { title: 'The Long Room', auditorium: 'Demo' },
      serverNowMs: Date.now(),
      languages: Object.keys(this.tracks),
      source: 'demo',
    });
    this._emit('onStatus', 'live');
    this._last = this._now();
    this._timer = setInterval(() => this._pump(), this._tickMs);
  }

  subscribe(lang) {
    if (!this.tracks[lang]) return;
    this.lang = lang;
    this.sent.clear();
    this._emit('onLanguage', lang);
  }

  play() {
    this.playing = true;
    this._last = this._now();
  }

  pause() {
    this.playing = false;
  }

  seek(ms) {
    this.pos = Math.max(0, ms);
    this.sent.clear();
    this._last = this._now();
  }

  close() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._emit('onStatus', 'closed');
  }

  _pump() {
    const now = this._now();
    if (this.playing) this.pos += now - this._last;
    this._last = now;
    this._emit('onTransport', {
      type: 'transport',
      status: this.playing ? 'playing' : 'paused',
      positionMs: Math.floor(this.pos),
      serverNowMs: Date.now(),
      clients: 1,
    });
    const cues = this.tracks[this.lang] || [];
    for (const c of cues) {
      if (c.startMs > this.pos + LOOKAHEAD_MS) break;
      if (c.endMs <= this.pos) continue; // over; never visible again
      if (this.sent.has(c.id)) continue;
      this.sent.add(c.id);
      this._emit('onCue', {
        type: 'cue',
        id: `${this.lang}-${c.id}`,
        lang: this.lang,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
        issuedAtMs: Date.now(),
      });
    }
  }

  _emit(name, arg) {
    if (this.h[name]) this.h[name](arg);
  }
}
