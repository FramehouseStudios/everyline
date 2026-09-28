import test from 'node:test';
import assert from 'node:assert/strict';

import { parseJoinParams, theaterDeepLink, publicNowPlayingUrl } from '../src/join.js';

test('parses a seat-QR deep link', () => {
  const qp = parseJoinParams(new URLSearchParams(
    'source=theater&backend=https://b.example.com/&theater=t1&auditorium=a1'));
  assert.deepEqual(qp, {
    source: 'theater',
    backend: 'https://b.example.com',
    token: '',
    theater: 't1',
    auditorium: 'a1',
    bridge: '',
  });
});

test('builds the deep link the QR encodes', () => {
  const link = theaterDeepLink({
    base: 'https://app.example.com',
    backend: 'https://b.example.com/',
    theater: 't1',
    auditorium: 'a1',
  });
  assert.ok(link.startsWith('https://app.example.com/?'));
  const back = parseJoinParams(new URL(link).searchParams);
  assert.equal(back.source, 'theater');
  assert.equal(back.backend, 'https://b.example.com');
  assert.equal(back.theater, 't1');
  assert.equal(back.auditorium, 'a1');
});

test('public now-playing URL', () => {
  const url = publicNowPlayingUrl({
    backend: 'https://b.example.com/',
    theater: 't1',
    auditorium: 'a1',
  });
  assert.equal(
    url,
    'https://b.example.com/v1/public/now-playing?theaterId=t1&auditoriumId=a1');
});
