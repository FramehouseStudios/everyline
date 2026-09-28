import test from 'node:test';
import assert from 'node:assert/strict';

import { BoothClock } from '../src/clock.js';

test('paused clock freezes at the last position', () => {
  let t = 1000;
  const clock = new BoothClock(() => t);
  clock.onTransport({ status: 'playing', positionMs: 5000 }, 1000);
  t = 1500;
  assert.equal(clock.now(), 5500);
  assert.equal(clock.isPlaying(), true);
  clock.onTransport({ status: 'paused', positionMs: 5600 }, 1600);
  t = 9000;
  assert.equal(clock.now(), 5600);
  assert.equal(clock.isPlaying(), false);
});

test('resume continues from the new position', () => {
  let t = 0;
  const clock = new BoothClock(() => t);
  clock.onTransport({ status: 'playing', positionMs: 10000 }, 0);
  t = 2000;
  clock.onTransport({ status: 'playing', positionMs: 12000 }, 2000);
  t = 2500;
  assert.equal(clock.now(), 12500);
});

test('unknown status is treated as paused', () => {
  const clock = new BoothClock(() => 9999);
  clock.onTransport({ status: 'buffering', positionMs: 42 }, 0);
  assert.equal(clock.isPlaying(), false);
  assert.equal(clock.now(), 42);
});

test('clock freezes after 10s without a transport (half-open socket)', () => {
  let t = 0;
  const clock = new BoothClock(() => t);
  clock.onTransport({ status: 'playing', positionMs: 5000 }, 0);
  t = 5000;
  assert.equal(clock.now(), 10000);
  assert.equal(clock.isStale(), false);
  // 100s of transport silence: the old code read 105000ms here.
  t = 100000;
  assert.equal(clock.now(), 15000, 'extrapolation is capped at +10s');
  assert.equal(clock.isStale(), true);
});

test('a fresh transport clears staleness and resumes the clock', () => {
  let t = 0;
  const clock = new BoothClock(() => t);
  clock.onTransport({ status: 'playing', positionMs: 5000 }, 0);
  t = 60000;
  assert.equal(clock.isStale(), true);
  clock.onTransport({ status: 'playing', positionMs: 65000 }, 60000);
  assert.equal(clock.isStale(), false);
  t = 61000;
  assert.equal(clock.now(), 66000);
});

test('paused clock is never stale', () => {
  let t = 0;
  const clock = new BoothClock(() => t);
  clock.onTransport({ status: 'paused', positionMs: 5000 }, 0);
  t = 999999;
  assert.equal(clock.isStale(), false);
  assert.equal(clock.now(), 5000);
});
