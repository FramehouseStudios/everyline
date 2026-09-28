import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

import { ManualMedia } from '../src/providers/manual.js';
import { CueServer } from '../src/cueServer.js';

const SRT = `1
00:00:01,000 --> 00:00:02,000
one

2
00:00:05,000 --> 00:00:06,000
two
`;

function waitFor(cond, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout')); }
    }, 25);
  });
}

test('cue server speaks protocol v0 over a manual media', async () => {
  const media = new ManualMedia();
  media.load('en', SRT, 'Test Film');

  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/cue' });
  const cueServer = new CueServer({ getMedia: () => media, source: 'home' });
  cueServer.attach(wss);
  await new Promise((r) => httpServer.listen(0, r));
  const port = httpServer.address().port;

  const got = [];
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/cue`);
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await waitFor(() => ws.readyState === 1);
    ws.send(JSON.stringify({ type: 'hello', client: 't', protocol: 0 }));
    await waitFor(() => got.some((m) => m.type === 'welcome'));
    const welcome = got.find((m) => m.type === 'welcome');
    assert.equal(welcome.showing.title, 'Test Film');
    assert.equal(welcome.source, 'home');
    assert.deepEqual(welcome.languages, ['en']);

    ws.send(JSON.stringify({ type: 'subscribe', lang: 'en' }));
    media.play();
    await waitFor(() => got.filter((m) => m.type === 'cue').length >= 2, 8000);
    const cues = got.filter((m) => m.type === 'cue');
    assert.equal(cues[0].text, 'one');
    assert.equal(cues[1].text, 'two');
    assert.equal(cues[0].lang, 'en');
    assert.ok(got.some((m) => m.type === 'transport' && m.status === 'playing'));

    ws.close();
    await waitFor(() => cueServer.clients.size === 0);
  } finally {
    cueServer.close();
    wss.close();
    httpServer.close();
  }
});

test('rewinding resends cues in the rewound region', async () => {
  const media = new ManualMedia();
  media.load('en', SRT, 'Test Film');

  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/cue' });
  const cueServer = new CueServer({ getMedia: () => media, source: 'home' });
  cueServer.attach(wss);
  await new Promise((r) => httpServer.listen(0, r));
  const port = httpServer.address().port;

  const got = [];
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/cue`);
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await waitFor(() => ws.readyState === 1);
    ws.send(JSON.stringify({ type: 'hello', client: 't', protocol: 0 }));
    await waitFor(() => got.some((m) => m.type === 'welcome'));
    ws.send(JSON.stringify({ type: 'subscribe', lang: 'en' }));

    const cueIds = () => got.filter((m) => m.type === 'cue').map((m) => m.id);
    media.seek(1500);
    await waitFor(() => cueIds().includes('en-cue-0'));
    media.seek(5500);
    await waitFor(() => cueIds().includes('en-cue-1'));
    // Rewind into cue 0's window: it must be sent again.
    media.seek(1500);
    await waitFor(() => cueIds().filter((id) => id === 'en-cue-0').length >= 2, 8000);
    assert.ok(true, 'rewound cue was resent');

    ws.close();
    await waitFor(() => cueServer.clients.size === 0);
  } finally {
    cueServer.close();
    wss.close();
    httpServer.close();
  }
});

test('a failing media backend answers with an error frame, not a crash', async () => {
  const broken = {
    title: 'Broken',
    languages: () => ['en'],
    cues: () => [],
    state: async () => { throw new Error('plex is down'); },
  };
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/cue' });
  const cueServer = new CueServer({ getMedia: () => broken, source: 'home' });
  cueServer.attach(wss);
  await new Promise((r) => httpServer.listen(0, r));
  const port = httpServer.address().port;

  const got = [];
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/cue`);
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await waitFor(() => ws.readyState === 1);
    ws.send(JSON.stringify({ type: 'hello', client: 't', protocol: 0 }));
    // The rejection is caught and answered; an unhandled rejection here
    // would fail the test file (and in production, kill the bridge).
    await waitFor(() => got.some((m) => m.type === 'error'), 8000);
    assert.match(got.find((m) => m.type === 'error').error, /plex is down/);
    ws.close();
    await waitFor(() => cueServer.clients.size === 0);
  } finally {
    cueServer.close();
    wss.close();
    httpServer.close();
  }
});
