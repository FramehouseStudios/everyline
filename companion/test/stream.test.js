import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';

import { BoothStream } from '../src/stream.js';

// Scripted fake booth speaking Cue Stream Protocol v0.
// dropFirst: close the FIRST connection after it sends this many messages
// (later connections behave), to exercise the client's reconnect path.
function startBooth({ dropFirst = 0 } = {}) {
  const seen = [];
  const wss = new WebSocketServer({ port: 0 });
  let connections = 0;
  wss.on('connection', (sock) => {
    connections += 1;
    const first = connections === 1;
    let n = 0;
    sock.on('message', (data) => {
      const m = JSON.parse(data.toString());
      seen.push(m);
      n += 1;
      if (m.type === 'hello') {
        sock.send(JSON.stringify({
          type: 'welcome', protocol: 0,
          showing: { title: 'The Long Room', auditorium: 'Aud 1' },
          serverNowMs: 1, languages: ['en', 'es'], source: 'simulated',
        }));
      }
      if (m.type === 'subscribe' && m.lang === 'en') {
        sock.send(JSON.stringify({
          type: 'cue', id: 'en-0', lang: 'en',
          startMs: 1000, endMs: 2000, text: 'Did you hear that?', issuedAtMs: 1,
        }));
        sock.send(JSON.stringify({
          type: 'transport', status: 'playing',
          positionMs: 1200, serverNowMs: 1, clients: 1,
        }));
      }
      if (first && dropFirst > 0 && n >= dropFirst) sock.close();
    });
  });
  return { wss, seen, url: () => `ws://127.0.0.1:${wss.address().port}` };
}

function waitFor(cond, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - t0 > timeout) {
        clearInterval(iv);
        reject(new Error('timed out waiting for condition'));
      }
    }, 25);
  });
}

test('hello, subscribe, and inbound routing', async () => {
  const booth = startBooth();
  const events = [];
  const stream = new BoothStream({
    wsImpl: WebSocket,
    handlers: {
      onWelcome: (m) => events.push(['welcome', m]),
      onCue: (m) => events.push(['cue', m]),
      onTransport: (m) => events.push(['transport', m]),
      onStatus: (s) => events.push(['status', s]),
    },
  });
  stream.connect(booth.url());
  await waitFor(() => events.some((e) => e[0] === 'welcome'));
  stream.subscribe('en');
  await waitFor(() => events.some((e) => e[0] === 'cue')
    && events.some((e) => e[0] === 'transport'));

  const types = booth.seen.map((m) => m.type);
  assert.ok(types.includes('hello'));
  assert.ok(types.includes('subscribe'));
  const hello = booth.seen.find((m) => m.type === 'hello');
  assert.equal(hello.protocol, 0);

  const welcome = events.find((e) => e[0] === 'welcome')[1];
  assert.equal(welcome.showing.title, 'The Long Room');
  assert.deepEqual(welcome.languages, ['en', 'es']);
  const cue = events.find((e) => e[0] === 'cue')[1];
  assert.equal(cue.text, 'Did you hear that?');
  const transport = events.find((e) => e[0] === 'transport')[1];
  assert.equal(transport.status, 'playing');

  const states = events.filter((e) => e[0] === 'status').map((e) => e[1]);
  assert.deepEqual(states, ['connecting', 'live']);

  stream.close();
  booth.wss.close();
});

test('dropped connection reconnects and re-subscribes', async () => {
  const booth = startBooth({ dropFirst: 2 }); // drop after hello+subscribe
  const events = [];
  const stream = new BoothStream({
    wsImpl: WebSocket,
    handlers: {
      onWelcome: (m) => events.push(['welcome', m]),
      onStatus: (s) => events.push(['status', s]),
    },
  });
  stream.connect(booth.url());
  await waitFor(() => events.filter((e) => e[0] === 'welcome').length >= 1);
  stream.subscribe('en');
  // Server drops us after the subscribe; client must come back and say hello again.
  await waitFor(
    () => booth.seen.filter((m) => m.type === 'hello').length >= 2, 8000);
  const states = events.filter((e) => e[0] === 'status').map((e) => e[1]);
  assert.ok(states.includes('reconnecting'));
  assert.equal(states.at(-1), 'live');
  // re-subscribed on the fresh connection
  assert.ok(booth.seen.filter((m) => m.type === 'subscribe').length >= 2);

  stream.close();
  booth.wss.close();
});

test('close() stops reconnecting', async () => {
  const booth = startBooth({ dropFirst: 1 });
  const stream = new BoothStream({ wsImpl: WebSocket, handlers: {} });
  stream.connect(booth.url());
  await waitFor(() => booth.seen.length >= 1);
  stream.close();
  const hellos = booth.seen.filter((m) => m.type === 'hello').length;
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(booth.seen.filter((m) => m.type === 'hello').length, hellos);
  booth.wss.close();
});
