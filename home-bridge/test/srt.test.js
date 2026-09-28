import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { parseSrt } from '../src/srt.js';

const demoSrt = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../demo/captions.en.srt'), 'utf8');

test('parses the demo SRT: 24 cues, sane timestamps', () => {
  const cues = parseSrt(demoSrt);
  assert.equal(cues.length, 24);
  assert.equal(cues[0].id, 'cue-0');
  assert.ok(cues[0].startMs >= 0 && cues[0].endMs > cues[0].startMs);
  for (let i = 1; i < cues.length; i++) {
    assert.ok(cues[i].startMs >= cues[i - 1].startMs, 'sorted');
  }
  assert.match(cues[0].text, /./);
});

test('strips inline tags and skips malformed blocks', () => {
  const cues = parseSrt(`1
00:00:01,000 --> 00:00:02,000
<i>Hello</i> <b>world</b>

not a timestamp block

2
00:00:05.500 --> 00:00:04,000
backwards

3
00:00:10,000 --> 00:00:12,000
fine
`);
  assert.deepEqual(cues.map((c) => c.text), ['Hello world', 'fine']);
  assert.equal(cues[1].startMs, 10000);
});

test('strips a UTF-8 BOM instead of dropping the first cue', () => {
  const cues = parseSrt('\uFEFF1\n00:00:01,000 --> 00:00:02,000\nfirst\n\n2\n00:00:05,000 --> 00:00:06,000\nsecond\n');
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'first');
  assert.equal(cues[0].id, 'cue-0');
});
