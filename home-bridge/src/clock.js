// MediaClock: server-side transport state for the home bridge.
// play/pause/seek mutate it; position() derives the media time.
// The cue server broadcasts this; the phone never extrapolates.

export class MediaClock {
  constructor(nowFn = () => Date.now()) {
    this._now = nowFn;
    this._status = 'paused';
    this._pos = 0;
    this._t0 = 0;
  }

  play() {
    if (this._status !== 'playing') {
      this._status = 'playing';
      this._t0 = this._now();
    }
  }

  pause() {
    if (this._status === 'playing') {
      this._pos = this.position();
      this._status = 'paused';
    }
  }

  seek(ms) {
    this._pos = Math.max(0, Math.floor(ms));
    this._t0 = this._now();
  }

  position() {
    if (this._status !== 'playing') return this._pos;
    return this._pos + (this._now() - this._t0);
  }

  status() {
    return this._status;
  }

  snapshot() {
    return { status: this.status(), positionMs: Math.floor(this.position()) };
  }
}
