import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { DemoSource } from '../src/source.js';
import { parseSrt } from '../src/srt.js';

const dir = dirname(fileURLToPath(import.meta.url));
const tracks = {
  en: parseSrt(readFileSync(join(dir, '../captions.en.srt'), 'utf8')),
  es: parseSrt(readFileSync(join(dir, '../captions.es.srt'), 'utf8')),
};

function waitFor(cond, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout')); }
    }, 20);
  });
}

test('demo source: welcome, cues on play, pause freezes, seek restarts', async () => {
  const events = [];
  const src = new DemoSource({
    handlers: {
      onWelcome: (m) => events.push(['welcome', m]),
      onCue: (m) => events.push(['cue', m]),
      onTransport: (m) => events.push(['transport', m]),
      onStatus: (s) => events.push(['status', s]),
    },
    tracks,
    tickMs: 50,
  });
  src.connect();
  try {
  const welcome = events.find((e) => e[0] === 'welcome')[1];
  assert.equal(welcome.source, 'demo');
  assert.deepEqual(welcome.languages.sort(), ['en', 'es']);
  assert.deepEqual(
    events.filter((e) => e[0] === 'status').map((e) => e[1]),
    ['connecting', 'live']);

  src.subscribe('en');
  src.play();
  await waitFor(() => events.filter((e) => e[0] === 'cue').length >= 2, 8000);
  const cues = events.filter((e) => e[0] === 'cue').map((e) => e[1]);
  assert.equal(cues[0].lang, 'en');
  assert.ok(cues[0].text.length > 0);

  src.pause();
  const n = events.filter((e) => e[0] === 'cue').length;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(events.filter((e) => e[0] === 'cue').length, n);

  src.seek(60000);
  src.subscribe('es');
  src.play();
  await waitFor(
    () => events.filter((e) => e[0] === 'cue').some((e) => e[1].lang === 'es'), 8000);
  const es = events.filter((e) => e[0] === 'cue').map((e) => e[1]).filter((c) => c.lang === 'es');
  assert.ok(es.length >= 1);
  assert.ok(es[0].startMs >= 59000);

  } finally {
    src.close();
  }
  assert.equal(events.at(-1)[1], 'closed');
});

test('demo source ignores unknown languages', () => {
  const langs = [];
  const src = new DemoSource({
    handlers: { onLanguage: (l) => langs.push(l) },
    tracks,
  });
  src.subscribe('xx');
  assert.deepEqual(langs, []);
  src.close();
});
