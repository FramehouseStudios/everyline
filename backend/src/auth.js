'use strict';
// Two credentials, two audiences.
// - Operators (theater staff, us): Bearer token, manages theaters/auditoriums/shows.
// - Booth appliances: per-device API key in X-Api-Key, only heartbeat + status.
// Caption content never passes through here; the cue stream stays on the LAN.

const crypto = require('node:crypto');
const { hashKey } = require('./db');

function operatorToken() {
  return process.env.OPERATOR_TOKEN || 'dev-operator-token';
}

function operatorAuth(req, res, next) {
  const got = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const want = operatorToken();
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  // timingSafeEqual throws on length mismatch; the length check first is
  // the standard guard (it leaks length only, not content).
  if (!got || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function applianceAuth(db) {
  const find = db.prepare('SELECT * FROM appliances WHERE api_key_hash = ?');
  return (req, res, next) => {
    const key = (req.get('x-api-key') || '').trim();
    if (!key) return res.status(401).json({ error: 'missing api key' });
    const row = find.get(hashKey(key));
    if (!row) return res.status(401).json({ error: 'invalid api key' });
    req.appliance = row;
    next();
  };
}

module.exports = { operatorAuth, applianceAuth };
