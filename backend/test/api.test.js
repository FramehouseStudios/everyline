'use strict';
// End-to-end tests for the everyline backend. Real HTTP against an ephemeral
// server, fresh in-memory database per file run.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/index');

const OPERATOR_TOKEN = 'test-operator-token';
process.env.OPERATOR_TOKEN = OPERATOR_TOKEN;

let base;
let server;

test.before(async () => {
  const { app } = createApp({ dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
});

const op = (body, method = 'POST') => ({
  method,
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${OPERATOR_TOKEN}`,
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const call = async (path, opts = {}) => {
  const res = await fetch(base + path, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

test('health is public', async () => {
  const { status, json } = await call('/v1/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('operator endpoints reject missing token', async () => {
  const { status } = await call('/v1/theaters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(status, 401);
});

test('theater validation', async () => {
  const { status, json } = await call('/v1/theaters', op({}));
  assert.equal(status, 400);
  assert.match(json.error, /name/i);
});

let theaterId;
let auditoriumId;

test('create theater and auditorium', async () => {
  const t = await call('/v1/theaters', op({ name: 'Roxie Theater', city: 'San Francisco' }));
  assert.equal(t.status, 201);
  assert.ok(t.json.id);
  theaterId = t.json.id;

  const a = await call(`/v1/theaters/${theaterId}/auditoriums`,
    op({ name: 'Auditorium 1', serverVendor: 'GDC', serverModel: 'SR-1000', seats: 200 }));
  assert.equal(a.status, 201);
  assert.equal(a.json.serverVendor, 'GDC');
  auditoriumId = a.json.id;

  const missing = await call('/v1/theaters/nope/auditoriums', op({ name: 'x' }));
  assert.equal(missing.status, 404);
});

let apiKey;

test('register appliance, key shown once and never leaked', async () => {
  const r = await call(`/v1/auditoriums/${auditoriumId}/appliance`, op({ label: 'booth-box-1' }));
  assert.equal(r.status, 201);
  assert.ok(r.json.apiKey.startsWith('ev_'));
  assert.ok(!('apiKeyHash' in r.json.appliance) && !('api_key_hash' in r.json.appliance));
  apiKey = r.json.apiKey;

  const dup = await call(`/v1/auditoriums/${auditoriumId}/appliance`, op({}));
  assert.equal(dup.status, 409);
});

test('heartbeat auth and update', async () => {
  const bad = await call('/v1/appliances/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'ev_wrong' },
    body: JSON.stringify({}),
  });
  assert.equal(bad.status, 401);

  const good = await call('/v1/appliances/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ status: 'ok', version: '0.1.0', cueStreamUrl: 'ws://10.0.1.10:8765' }),
  });
  assert.equal(good.status, 200);
  assert.ok(good.json.lastSeenAt);

  const list = await call('/v1/appliances', op(undefined, 'GET'));
  assert.equal(list.status, 200);
  assert.equal(list.json.appliances[0].cueStreamUrl, 'ws://10.0.1.10:8765');
  assert.equal(list.json.appliances[0].theaterName, 'Roxie Theater');
});

test('shows and discovery', async () => {
  const s = await call(`/v1/auditoriums/${auditoriumId}/shows`,
    op({ title: 'The Long Room', languages: ['en', 'es'] }));
  assert.equal(s.status, 201);
  assert.deepEqual(s.json.languages, ['en', 'es']);

  const d = await call(`/v1/discovery?theaterId=${theaterId}`, op(undefined, 'GET'));
  assert.equal(d.status, 200);
  assert.equal(d.json.theater.name, 'Roxie Theater');
  const aud = d.json.auditoriums[0];
  assert.equal(aud.currentShow.title, 'The Long Room');
  assert.equal(aud.captionsAvailable, true);
  assert.equal(aud.cueStreamUrl, 'ws://10.0.1.10:8765');
});

test('discovery validation', async () => {
  const noId = await call('/v1/discovery', op(undefined, 'GET'));
  assert.equal(noId.status, 400);
  const missing = await call('/v1/discovery?theaterId=nope', op(undefined, 'GET'));
  assert.equal(missing.status, 404);
});

test('unknown routes 404 as json', async () => {
  const { status, json } = await call('/v1/nope', op(undefined, 'GET'));
  assert.equal(status, 404);
  assert.equal(json.error, 'not found');
});

test('public now-playing needs no token', async () => {
  const r = await call(`/v1/public/now-playing?theaterId=${theaterId}&auditoriumId=${auditoriumId}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.theater.name, 'Roxie Theater');
  assert.equal(r.json.auditorium.id, auditoriumId);
  assert.equal(r.json.currentShow.title, 'The Long Room');
  assert.equal(r.json.captionsAvailable, true);
  assert.equal(r.json.cueStreamUrl, 'ws://10.0.1.10:8765');
});

test('public now-playing validation', async () => {
  const bad = await call('/v1/public/now-playing');
  assert.equal(bad.status, 400);
  const missing = await call('/v1/public/now-playing?theaterId=nope&auditoriumId=nope');
  assert.equal(missing.status, 404);
});

test('seat QR page renders with a QR code', async () => {
  const res = await fetch(`${base}/v1/public/auditoriums/${auditoriumId}/join`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.ok(html.includes('Roxie Theater'));
  assert.ok(html.includes('<svg'), 'expected an inline QR svg');

  const missing = await fetch(`${base}/v1/public/auditoriums/nope/join`);
  assert.equal(missing.status, 404);
});

test('cors headers are present on public endpoints', async () => {
  const r = await fetch(`${base}/v1/public/now-playing?theaterId=${theaterId}&auditoriumId=${auditoriumId}`);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.status, 200);
});

test('shows validate startsAt', async () => {
  const bad = await call(`/v1/auditoriums/${auditoriumId}/shows`,
    op({ title: 'Bad Time', startsAt: 'not-a-date' }));
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /startsAt/i);

  const nonString = await call(`/v1/auditoriums/${auditoriumId}/shows`,
    op({ title: 'Bad Time', startsAt: 12345 }));
  assert.equal(nonString.status, 400);

  const dated = await call(`/v1/auditoriums/${auditoriumId}/shows`,
    op({ title: 'Dated', startsAt: '2030-01-01T19:00:00Z' }));
  assert.equal(dated.status, 201);
  assert.equal(dated.json.startsAt, '2030-01-01T19:00:00Z');
});

test('future shows are not current; past shows are', async () => {
  const a = await call(`/v1/theaters/${theaterId}/auditoriums`, op({ name: 'Auditorium 2' }));
  assert.equal(a.status, 201);
  const aud2 = a.json.id;

  const future = await call(`/v1/auditoriums/${aud2}/shows`,
    op({ title: 'Tomorrow', startsAt: new Date(Date.now() + 86400000).toISOString() }));
  assert.equal(future.status, 201);

  let np = await call(`/v1/public/now-playing?theaterId=${theaterId}&auditoriumId=${aud2}`);
  assert.equal(np.status, 200);
  assert.equal(np.json.currentShow, null);
  assert.equal(np.json.captionsAvailable, false);

  const past = await call(`/v1/auditoriums/${aud2}/shows`,
    op({ title: 'Tonight', startsAt: new Date(Date.now() - 3600000).toISOString() }));
  assert.equal(past.status, 201);

  np = await call(`/v1/public/now-playing?theaterId=${theaterId}&auditoriumId=${aud2}`);
  assert.equal(np.json.currentShow.title, 'Tonight');
});

test('heartbeat rejects a non-ws cue stream url', async () => {
  const bad = await call('/v1/appliances/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ cueStreamUrl: 'http://evil.example/x' }),
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /ws/i);

  const noHost = await call('/v1/appliances/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ cueStreamUrl: 'ws://' }),
  });
  assert.equal(noHost.status, 400);

  const good = await call('/v1/appliances/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ cueStreamUrl: 'wss://booth.lan:8443/cue' }),
  });
  assert.equal(good.status, 200);
});

test('poisoned host header cannot reach the seat qr', async () => {
  const http = require('http');
  const port = server.address().port;
  const get = (host) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port,
      path: `/v1/public/auditoriums/${auditoriumId}/join`, headers: { Host: host } },
      (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
    req.on('error', reject);
    req.end();
  });

  const poisoned = await get('evil.com/x');
  assert.equal(poisoned.status, 500);
  assert.match(poisoned.body, /PUBLIC_BACKEND_URL/);
  assert.ok(!poisoned.body.includes('evil.com'));

  process.env.PUBLIC_BACKEND_URL = 'https://backend.example.com';
  try {
    // The deep link is encoded in the QR modules, not page text; the
    // observable property is that the poisoned host never reaches the
    // page while the configured backend wins.
    const ok = await get('evil.com');
    assert.equal(ok.status, 200);
    assert.ok(!ok.body.includes('evil.com'));
  } finally {
    delete process.env.PUBLIC_BACKEND_URL;
  }
});

// Keep last: it burns through the per-IP QR budget (30/min).
test('join endpoint is rate limited', async () => {
  const statuses = [];
  for (let i = 0; i < 31; i++) {
    const r = await fetch(`${base}/v1/public/auditoriums/${auditoriumId}/join`);
    statuses.push(r.status);
    await r.text();
  }
  assert.equal(statuses[0], 200);
  assert.ok(statuses.includes(429), `expected some 429s, got ${statuses.join(',')}`);
});
