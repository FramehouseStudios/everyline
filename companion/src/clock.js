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

  // True when playing but no transport has arrived for a while: the
  // socket is probably half-open (phone roaming between auditorium APs,
  // walking a dead zone — routine in theaters). The clock is frozen (see
  // now()) and the UI should say reconnecting, not "● live".
  isStale() {
    return this.isPlaying() &&
      (this._nowFn() - this._receivedAt) > BoothClock.STALE_AFTER_MS;
  }

  now() {
    if (!this.isPlaying()) return this._positionMs;
    const elapsed = this._nowFn() - this._receivedAt;
    // A half-open socket fires no onclose, so transports silently stop.
    // Without the cap the phone marches on at 1x forever and shows
    // captions minutes ahead of the picture while the badge says live.
    return this._positionMs + Math.min(elapsed, BoothClock.STALE_AFTER_MS);
  }

  get positionMs() {
    return this._positionMs;
  }
}

BoothClock.STALE_AFTER_MS = 10000;
