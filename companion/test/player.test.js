import test from 'node:test';
import assert from 'node:assert/strict';

import { CuePlayer } from '../src/player.js';

function stubClock() {
  return {
    t: 0,
    playing: true,
    now() { return this.t; },
    isPlaying() { return this.playing; },
  };
}

function harness() {
  const clock = stubClock();
  const shown = [];
  const cleared = [];
  const player = new CuePlayer({
    clock,
    onDisplay: (cue) => shown.push(cue),
    onClear: () => cleared.push(clock.t),
  });
  return { clock, player, shown, cleared };
}

const CUES = [
  { id: 'en-0', lang: 'en', startMs: 1000, endMs: 2000, text: 'one' },
  { id: 'en-1', lang: 'en', startMs: 5000, endMs: 6000, text: 'two' },
  { id: 'es-0', lang: 'es', startMs: 1000, endMs: 2000, text: 'uno' },
];

test('displays when due, clears at end', () => {
  const { clock, player, shown, cleared } = harness();
  player.setLanguage('en');
  CUES.forEach((c) => player.pushCue(c));
  clock.t = 500;
  player.tick();
  assert.equal(shown.length, 0);
  clock.t = 1200;
  player.tick();
  assert.equal(shown.length, 1);
  assert.equal(shown[0].text, 'one');
  clock.t = 1300;
  player.tick();
  assert.equal(shown.length, 1); // no duplicate display
  clock.t = 2000;
  player.tick();
  assert.equal(cleared.length, 2); // once from setLanguage, once at end
});

test('pause freezes the visible cue', () => {
  const { clock, player, shown, cleared } = harness();
  player.setLanguage('en');
  CUES.forEach((c) => player.pushCue(c));
  clock.t = 1200;
  player.tick();
  assert.equal(shown.length, 1);
  clock.playing = false; // transport paused; clock.now() frozen by the booth
  clock.t = 99999; // local time races on, media time does not (frozen below)
  const frozen = clock.now.bind(clock);
  clock.now = () => 1200;
  player.tick();
  assert.equal(shown.length, 1);
  assert.equal(cleared.length, 1); // only the setLanguage clear
  clock.now = frozen;
});

test('seek backwards shows the earlier cue again', () => {
  const { clock, player, shown } = harness();
  player.setLanguage('en');
  CUES.forEach((c) => player.pushCue(c));
  clock.t = 5500;
  player.tick();
  assert.equal(shown.at(-1).text, 'two');
  clock.t = 1200; // seek back
  player.tick();
  assert.equal(shown.at(-1).text, 'one');
});

test('seek forward skips past cues', () => {
  const { clock, player, shown } = harness();
  player.setLanguage('en');
  CUES.forEach((c) => player.pushCue(c));
  clock.t = 5500;
  player.tick();
  assert.deepEqual(shown.map((c) => c.id), ['en-1']);
});

test('language switch swaps the stream', () => {
  const { clock, player, shown, cleared } = harness();
  player.setLanguage('en');
  CUES.forEach((c) => player.pushCue(c));
  clock.t = 1200;
  player.tick();
  assert.equal(shown.at(-1).lang, 'en');
  player.setLanguage('es');
  player.tick();
  assert.equal(shown.at(-1).text, 'uno');
  assert.ok(cleared.length >= 2);
});

test('late cue displays immediately', () => {
  const { clock, player, shown } = harness();
  player.setLanguage('en');
  clock.t = 1500;
  player.tick();
  assert.equal(shown.length, 0);
  player.pushCue({ id: 'en-9', lang: 'en', startMs: 1000, endMs: 4000, text: 'late' });
  player.tick();
  assert.equal(shown.at(-1).text, 'late');
});

test('duplicate cues are ignored', () => {
  const { clock, player, shown } = harness();
  player.setLanguage('en');
  player.pushCue(CUES[0]);
  player.pushCue({ ...CUES[0] });
  clock.t = 1200;
  player.tick();
  assert.equal(shown.length, 1);
});
