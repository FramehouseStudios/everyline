import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

import { PlexMedia } from '../src/providers/plex.js';

// Canned Plex API: one playing session with external English/Spanish SRT
// streams plus an embedded (keyless, undownloadable) French stream.
// Shapes follow research/plex-api.md (verified against python-plexapi).
function startMockPlex() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/status/sessions') {
      // Auth must arrive as the X-Plex-Token header, never in the URL.
      if (req.headers['x-plex-token'] !== 'tok' || url.searchParams.has('X-Plex-Token')) {
        res.statusCode = 401;
        res.end('{}');
        return;
      }
      res.end(JSON.stringify({
        MediaContainer: {
          Metadata: [{
            key: '/library/metadata/42',
            sessionKey: '7',
            type: 'movie',
            grandparentTitle: 'The Long Room',
            title: 'The Long Room',
            duration: 90000,
            viewOffset: 12345,
            Player: { state: 'playing', title: 'Plex for iOS' },
            Session: { id: 'abc123', bandwidth: 8000, location: 'lan' },
            User: { id: '1', title: 'josh' },
          }],
        },
      }));
    } else if (url.pathname === '/library/metadata/42') {
      res.end(JSON.stringify({
        MediaContainer: {
          Metadata: [{
            key: '/library/metadata/42',
            grandparentTitle: 'The Long Room',
            Media: [{
              Part: [{
                Stream: [
                  { streamType: 1, codec: 'h264' },
                  { streamType: 3, languageCode: 'eng', languageTag: 'en', codec: 'srt', key: '/library/streams/7' },
                  { streamType: 3, languageCode: 'spa', codec: 'srt', key: '/library/streams/8' },
                  // Embedded subtitle: no key, structurally undownloadable.
                  { streamType: 3, languageCode: 'fre', codec: 'srt' },
                ],
              }],
            }],
          }],
        },
      }));
    } else if (url.pathname === '/library/streams/7') {
      res.setHeader('Content-Type', 'text/plain');
      res.end('1\n00:00:01,000 --> 00:00:02,000\nhello\n');
    } else if (url.pathname === '/library/streams/8') {
      res.setHeader('Content-Type', 'text/plain');
      res.end('1\n00:00:01,000 --> 00:00:02,000\nhola\n');
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({
      server,
      url: `http://127.0.0.1:${server.address().port}`,
    }));
  });
}

test('plex: sessions, attach, subtitle download, live position', async () => {
  const { server, url } = await startMockPlex();
  try {
    const plex = new PlexMedia({ url, token: 'tok' });
    const sessions = await plex.sessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].title, 'The Long Room');
    assert.equal(sessions[0].state, 'playing');
    assert.equal(sessions[0].positionMs, 12345);

    const session = await plex.attach('/library/metadata/42');
    assert.equal(session.title, 'The Long Room');
    // Embedded French (no key) is skipped, not errored.
    assert.deepEqual(session.languages().sort(), ['en', 'es']);

    const en = await session.cues('en');
    assert.equal(en.length, 1);
    assert.equal(en[0].text, 'hello');
    const es = await session.cues('es');
    assert.equal(es[0].text, 'hola');

    const state = await session.state();
    assert.deepEqual(state, { status: 'playing', positionMs: 12345 });
  } finally {
    server.close();
  }
});

test('plex: non-SRT subtitle stream raises honestly', async () => {
  const { server, url } = await startMockPlex();
  try {
    const plex = new PlexMedia({ url, token: 'tok' });
    // point the mock at nothing downloadable by attaching with a bad key
    await assert.rejects(
      plex.attach('/library/metadata/missing'),
      /HTTP 404/);
  } finally {
    server.close();
  }
});

test('a vanished session reports paused at the last known position, not 0:00', async () => {
  let sessions = [{
    key: '/library/metadata/42',
    grandparentTitle: 'The Long Room',
    title: 'The Long Room',
    Player: { state: 'playing' },
    viewOffset: 61000,
    duration: 90000,
  }];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/status/sessions') {
      res.end(JSON.stringify({ MediaContainer: { Metadata: sessions } }));
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
      res.end('1\n00:00:01,000 --> 00:01:02,000\nhello\n');
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise((r) => server.listen(0, r));
  const plexUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const plex = new PlexMedia({ url: plexUrl, token: 'tok' });
    const session = await plex.attach('/library/metadata/42');
    let st = await session.state();
    assert.equal(st.positionMs, 61000);
    sessions = []; // the session ends
    st = await session.state();
    assert.equal(st.status, 'paused');
    assert.equal(st.positionMs, 61000);
  } finally {
    server.close();
  }
});
