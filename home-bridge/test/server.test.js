import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

import { createApp } from '../src/server.js';

// Minimal mock Plex: one session with a downloadable English SRT.
function startMockPlex(sessionsRef) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/status/sessions') {
      res.end(JSON.stringify({ MediaContainer: { Metadata: sessionsRef.list } }));
    } else if (url.pathname === '/library/metadata/42') {
      res.end(JSON.stringify({ MediaContainer: { Metadata: [{
        key: '/library/metadata/42',
        grandparentTitle: 'The Long Room',
        title: 'The Long Room',
        Media: [{ Part: [{ Stream: [
          { streamType: 3, languageCode: 'eng', codec: 'srt', key: '/library/streams/7' },
        ] }] }],
      }] } }));
    } else if (url.pathname === '/library/streams/7') {
      res.setHeader('Content-Type', 'text/plain');
      res.end('1\n00:00:01,000 --> 00:00:02,000\nhello\n');
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  return server;
}

test('/v1/status returns JSON 502 when the plex backend goes down', async () => {
  const sessionsRef = { list: [{
    key: '/library/metadata/42',
    grandparentTitle: 'The Long Room',
    title: 'The Long Room',
    Player: { state: 'playing' },
    viewOffset: 1000,
    duration: 90000,
  }] };
  const plexServer = startMockPlex(sessionsRef);
  await new Promise((r) => plexServer.listen(0, r));
  const plexUrl = `http://127.0.0.1:${plexServer.address().port}`;

  const { app } = createApp();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const ar = await fetch(`${base}/v1/providers/plex/attach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: plexUrl, token: 't', sessionKey: '/library/metadata/42' }),
    });
    assert.equal(ar.status, 200);

    // Plex dies mid-movie.
    await new Promise((r) => plexServer.close(r));

    const st = await fetch(`${base}/v1/status`);
    assert.equal(st.status, 502);
    assert.match(st.headers.get('content-type'), /application\/json/);
    const j = await st.json();
    assert.ok(j.error, 'expected a JSON error body, not an HTML error page');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
