'use strict';
// Patron discovery: the phone app calls this to learn what's playing in each
// auditorium of a theater and where the booth's cue stream lives on the LAN.
// v1 is operator-token gated; production will open a scoped public variant
// (theater + showtimes are not sensitive, but appliance URLs stay internal).

const { Router } = require('express');
const { operatorAuth } = require('../auth');

const REACHABLE_MS = 120000; // appliance seen within the last 2 minutes

module.exports = (db) => {
  const r = Router();
  const currentShow = db.prepare(`
    SELECT * FROM shows WHERE auditorium_id = ?
      AND (starts_at IS NULL OR starts_at <= ?)
    ORDER BY starts_at IS NULL, starts_at DESC, created_at DESC LIMIT 1`);
  const applianceFor = db.prepare('SELECT * FROM appliances WHERE auditorium_id = ?');

  r.get('/v1/discovery', operatorAuth, (req, res) => {
    const { theaterId } = req.query;
    if (!theaterId) return res.status(400).json({ error: 'theaterId is required' });
    const theater = db.prepare('SELECT * FROM theaters WHERE id = ?').get(theaterId);
    if (!theater) return res.status(404).json({ error: 'theater not found' });

    const auditoriums = db.prepare(
      'SELECT * FROM auditoriums WHERE theater_id = ? ORDER BY name').all(theaterId);

    res.json({
      theater: { id: theater.id, name: theater.name, chain: theater.chain, city: theater.city },
      auditoriums: auditoriums.map((a) => {
        const s = currentShow.get(a.id, new Date().toISOString());
        const ap = applianceFor.get(a.id);
        const lastSeenMs = ap && ap.last_seen_at ? Date.parse(ap.last_seen_at) : 0;
        const reachable = Date.now() - lastSeenMs < REACHABLE_MS;
        return {
          id: a.id,
          name: a.name,
          currentShow: s ? {
            title: s.title,
            startsAt: s.starts_at,
            languages: JSON.parse(s.languages),
          } : null,
          captionsAvailable: reachable && !!s,
          cueStreamUrl: reachable ? (ap && ap.cue_stream_url) || null : null,
        };
      }),
    });
  });

  return r;
};
