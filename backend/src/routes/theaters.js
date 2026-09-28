'use strict';
const { Router } = require('express');
const crypto = require('node:crypto');
const { now } = require('../db');
const { operatorAuth } = require('../auth');

module.exports = (db) => {
  const r = Router();
  const insert = db.prepare(
    'INSERT INTO theaters (id, name, chain, city, created_at) VALUES (?, ?, ?, ?, ?)');
  const get = db.prepare('SELECT * FROM theaters WHERE id = ?');

  r.post('/v1/theaters', operatorAuth, (req, res) => {
    const { name, chain = null, city = null } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const theater = {
      id: crypto.randomUUID(), name: name.trim(), chain, city, created_at: now(),
    };
    insert.run(theater.id, theater.name, theater.chain, theater.city, theater.created_at);
    res.status(201).json(theater);
  });

  r.get('/v1/theaters', operatorAuth, (req, res) => {
    const rows = db.prepare(`
      SELECT t.*, COUNT(a.id) AS auditorium_count
      FROM theaters t LEFT JOIN auditoriums a ON a.theater_id = t.id
      GROUP BY t.id ORDER BY t.created_at`).all();
    res.json({ theaters: rows });
  });

  r.get('/v1/theaters/:id', operatorAuth, (req, res) => {
    const theater = get.get(req.params.id);
    if (!theater) return res.status(404).json({ error: 'theater not found' });
    res.json(theater);
  });

  return r;
};
