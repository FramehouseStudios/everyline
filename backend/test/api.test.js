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
