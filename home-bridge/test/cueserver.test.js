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
