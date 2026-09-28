'use strict';
const { Router } = require('express');
const crypto = require('node:crypto');
const { now } = require('../db');
const { operatorAuth } = require('../auth');

const publicShow = (s) => ({
  id: s.id,
  auditoriumId: s.auditorium_id,
  title: s.title,
  startsAt: s.starts_at,
  languages: JSON.parse(s.languages),
  createdAt: s.created_at,
});

module.exports = (db) => {
  const r = Router();
  const audExists = db.prepare('SELECT id FROM auditoriums WHERE id = ?');

  r.post('/v1/auditoriums/:auditoriumId/shows', operatorAuth, (req, res) => {
    if (!audExists.get(req.params.auditoriumId)) {
      return res.status(404).json({ error: 'auditorium not found' });
    }
    const { title, startsAt = null, languages = ['en'] } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!Array.isArray(languages) || languages.length === 0 ||
        !languages.every((l) => typeof l === 'string' && l.trim())) {
      return res.status(400).json({ error: 'languages must be a non-empty array of strings' });
    }
    const s = {
      id: crypto.randomUUID(),
      auditorium_id: req.params.auditoriumId,
      title: title.trim(),
      starts_at: startsAt,
      languages: JSON.stringify(languages),
      created_at: now(),
    };
    db.prepare(`INSERT INTO shows
      (id, auditorium_id, title, starts_at, languages, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(s.id, s.auditorium_id, s.title, s.starts_at, s.languages, s.created_at);
    res.status(201).json(publicShow(s));
  });

  r.get('/v1/auditoriums/:auditoriumId/shows', operatorAuth, (req, res) => {
    if (!audExists.get(req.params.auditoriumId)) {
      return res.status(404).json({ error: 'auditorium not found' });
    }
    const rows = db.prepare(
      'SELECT * FROM shows WHERE auditorium_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.params.auditoriumId);
    res.json({ shows: rows.map(publicShow) });
  });

  return r;
};
