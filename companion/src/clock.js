// BoothClock: the booth is the clock.
//
// The phone estimates the booth's media position from `transport` messages:
// while playing, mediaNow = positionMs + (localNow - receivedAt); while
// paused, the position freezes. Pure logic, no DOM, fully tested.

export class BoothClock {
  constructor(nowFn = () => Date.now()) {
    this._nowFn = nowFn;
    this._status = 'paused';
    this._positionMs = 0;
    this._receivedAt = 0;
  }

  // msg: { status: 'playing'|'paused', positionMs }
  // receivedAtMs: local receipt time, captured at the message event.
  onTransport({ status, positionMs }, receivedAtMs = this._nowFn()) {
    this._status = status === 'playing' ? 'playing' : 'paused';
    this._positionMs = positionMs;
    this._receivedAt = receivedAtMs;
  }

  isPlaying() {
    return this._status === 'playing';
  }

  now() {
    if (!this.isPlaying()) return this._positionMs;
    return this._positionMs + (this._nowFn() - this._receivedAt);
  }

  get positionMs() {
    return this._positionMs;
  }
}
