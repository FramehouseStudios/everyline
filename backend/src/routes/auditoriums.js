'use strict';
const { Router } = require('express');
const crypto = require('node:crypto');
const { now } = require('../db');
const { operatorAuth } = require('../auth');

const publicAud = (a) => ({
  id: a.id,
  theaterId: a.theater_id,
  name: a.name,
  serverVendor: a.server_vendor,
  serverModel: a.server_model,
  seats: a.seats,
  createdAt: a.created_at,
});

module.exports = (db) => {
  const r = Router();
  const theaterExists = db.prepare('SELECT id FROM theaters WHERE id = ?');

  r.post('/v1/theaters/:theaterId/auditoriums', operatorAuth, (req, res) => {
    if (!theaterExists.get(req.params.theaterId)) {
      return res.status(404).json({ error: 'theater not found' });
    }
    const { name, serverVendor = null, serverModel = null, seats = null } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (seats !== null && (!Number.isInteger(seats) || seats < 0)) {
      return res.status(400).json({ error: 'seats must be a non-negative integer' });
    }
    const a = {
      id: crypto.randomUUID(),
      theater_id: req.params.theaterId,
      name: name.trim(),
      server_vendor: serverVendor,
      server_model: serverModel,
      seats,
      created_at: now(),
    };
    db.prepare(`INSERT INTO auditoriums
      (id, theater_id, name, server_vendor, server_model, seats, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(a.id, a.theater_id, a.name, a.server_vendor, a.server_model, a.seats, a.created_at);
    res.status(201).json(publicAud(a));
  });

  r.get('/v1/theaters/:theaterId/auditoriums', operatorAuth, (req, res) => {
    if (!theaterExists.get(req.params.theaterId)) {
      return res.status(404).json({ error: 'theater not found' });
    }
    const rows = db.prepare('SELECT * FROM auditoriums WHERE theater_id = ? ORDER BY name')
      .all(req.params.theaterId);
    res.json({ auditoriums: rows.map(publicAud) });
  });

  return r;
};
