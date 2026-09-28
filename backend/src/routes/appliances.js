'use strict';
const { Router } = require('express');
const crypto = require('node:crypto');
const { now, hashKey } = require('../db');
const { operatorAuth, applianceAuth } = require('../auth');

// One appliance per auditorium in v1. The API key is shown exactly once,
// at registration; only its hash is stored.

const publicAppliance = (a) => ({
  id: a.id,
  auditoriumId: a.auditorium_id,
  label: a.label,
  status: a.status,
  version: a.version,
  cueStreamUrl: a.cue_stream_url,
  lastSeenAt: a.last_seen_at,
  createdAt: a.created_at,
});

module.exports = (db) => {
  const r = Router();

  r.post('/v1/auditoriums/:auditoriumId/appliance', operatorAuth, (req, res) => {
    const aud = db.prepare('SELECT id FROM auditoriums WHERE id = ?').get(req.params.auditoriumId);
    if (!aud) return res.status(404).json({ error: 'auditorium not found' });
    const exists = db.prepare('SELECT id FROM appliances WHERE auditorium_id = ?').get(aud.id);
    if (exists) {
      return res.status(409).json({ error: 'an appliance is already registered for this auditorium' });
    }
    const apiKey = 'ev_' + crypto.randomBytes(24).toString('hex');
    const ap = {
      id: crypto.randomUUID(),
      auditorium_id: aud.id,
      label: (req.body || {}).label || null,
      api_key_hash: hashKey(apiKey),
      status: 'unknown',
      version: null,
      cue_stream_url: null,
      last_seen_at: null,
      created_at: now(),
    };
    db.prepare(`INSERT INTO appliances
      (id, auditorium_id, label, api_key_hash, status, version, cue_stream_url, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ap.id, ap.auditorium_id, ap.label, ap.api_key_hash, ap.status,
        ap.version, ap.cue_stream_url, ap.last_seen_at, ap.created_at);
    res.status(201).json({ appliance: publicAppliance(ap), apiKey });
  });

  r.post('/v1/appliances/heartbeat', applianceAuth(db), (req, res) => {
    const { status = 'ok', version = null, cueStreamUrl = null } = req.body || {};
    const seen = now();
    db.prepare(`UPDATE appliances
      SET status = ?, version = ?, cue_stream_url = ?, last_seen_at = ? WHERE id = ?`)
      .run(String(status), version, cueStreamUrl, seen, req.appliance.id);
    res.json({ ok: true, lastSeenAt: seen });
  });

  r.get('/v1/appliances', operatorAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT ap.*, a.name AS auditorium_name, t.name AS theater_name
      FROM appliances ap
      JOIN auditoriums a ON a.id = ap.auditorium_id
      JOIN theaters t ON t.id = a.theater_id
      ORDER BY ap.created_at`).all();
    res.json({
      appliances: rows.map((a) => ({
        ...publicAppliance(a),
        auditoriumName: a.auditorium_name,
        theaterName: a.theater_name,
      })),
    });
  });

  return r;
};
