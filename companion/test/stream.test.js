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

// Controllable fake socket: the test drives open/message/close.
function fakeWsFactory() {
  const instances = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      instances.push(this);
    }
    send(data) { this.sent.push(data); }
    close() {
      if (this.closed) return;
      this.closed = true;
      if (this.onclose) this.onclose();
    }
  }
  return { instances, FakeWS };
}

test('stale socket close does not trigger a spurious reconnect', async () => {
  const { instances, FakeWS } = fakeWsFactory();
  const states = [];
  const stream = new BoothStream({
    wsImpl: FakeWS,
    handlers: { onStatus: (s) => states.push(s) },
  });
  stream.connect('ws://x');
  const a = instances[0];
  a.onopen();
  assert.equal(stream.state, 'live');
  // A second connect while A is mid-close: A's async onclose must not
  // schedule a reconnect after B is already live.
  stream.connect('ws://x');
  const b = instances[1];
  b.onopen();
  assert.equal(stream.state, 'live');
  assert.equal(stream.ws, b);
  a.onclose(); // stale socket fires late
  assert.equal(stream.state, 'live', 'stale onclose must not reconnect');
  assert.ok(!states.includes('reconnecting'), `states: ${states}`);
  // ...but the CURRENT socket closing still reconnects.
  b.onclose();
  assert.equal(stream.state, 'reconnecting');
  stream.close();
});

test('stale socket messages are ignored', () => {
  const { instances, FakeWS } = fakeWsFactory();
  const cues = [];
  const stream = new BoothStream({
    wsImpl: FakeWS,
    handlers: { onCue: (m) => cues.push(m) },
  });
  stream.connect('ws://x');
  const a = instances[0];
  a.onopen();
  stream.connect('ws://x');
  instances[1].onopen();
  a.onmessage({ data: JSON.stringify({ type: 'cue', id: 'stale-1' }) });
  assert.equal(cues.length, 0, 'message from stale socket must be dropped');
  stream.close();
});

test('connect watchdog closes a socket stuck in CONNECTING', async () => {
  const { instances, FakeWS } = fakeWsFactory();
  const states = [];
  const stream = new BoothStream({
    wsImpl: FakeWS,
    handlers: { onStatus: (s) => states.push(s) },
    connectTimeoutMs: 50,
  });
  stream.connect('ws://blackhole');
  assert.equal(stream.state, 'connecting');
  // Never fires onopen: the SYN goes nowhere (wrong IP, client isolation).
  await waitFor(() => states.includes('reconnecting'), 4000);
  assert.ok(instances[0].closed, 'watchdog must close the stuck socket');
  stream.close();
});
