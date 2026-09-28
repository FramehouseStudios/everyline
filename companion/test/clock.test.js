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
