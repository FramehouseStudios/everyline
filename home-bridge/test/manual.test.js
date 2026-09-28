import test from 'node:test';
import assert from 'node:assert/strict';

import { ManualMedia } from '../src/providers/manual.js';

const SRT = `1
00:00:01,000 --> 00:00:02,000
one

2
00:00:05,000 --> 00:00:06,000
two
`;

function controlledClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('manual provider: load, transport, state', async () => {
  const m = new ManualMedia();
  // swap in a controllable clock
  const ctl = controlledClock();
  m.clock = new (await import('../src/clock.js')).MediaClock(ctl.now);

  const n = m.load('en', SRT, 'Test Film');
  assert.equal(n, 2);
  assert.equal(m.title, 'Test Film');
  assert.deepEqual(m.languages(), ['en']);

  let s = await m.state();
  assert.deepEqual(s, { status: 'paused', positionMs: 0 });

  m.play();
  ctl.advance(1500);
  s = await m.state();
  assert.equal(s.status, 'playing');
  assert.equal(s.positionMs, 1500);

  m.pause();
  ctl.advance(5000);
  s = await m.state();
  assert.deepEqual(s, { status: 'paused', positionMs: 1500 });

  m.seek(5000);
  m.play();
  ctl.advance(300);
  s = await m.state();
  assert.equal(s.positionMs, 5300);
});

test('manual provider rejects empty SRT', () => {
  const m = new ManualMedia();
  assert.throws(() => m.load('en', 'nothing here'), /no cues parsed/);
});
