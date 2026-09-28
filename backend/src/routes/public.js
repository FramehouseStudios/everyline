'use strict';
// Public patron surface: no operator token required.
//
// Two endpoints:
//   GET /v1/public/now-playing?theaterId=&auditoriumId=
//     What the companion needs to join: theater, auditorium, current show,
//     whether captions are live, and the booth's LAN cue stream URL.
//     Theater + showtimes are not sensitive; the cue stream URL is a LAN
//     address, reachable only from the auditorium WiFi anyway.
//   GET /v1/public/auditoriums/:auditoriumId/join
//     Printable seat-side page: theater, auditorium, current show, and a
//     QR code encoding the companion deep link. Staff open it on a tablet
//     or print it; patrons scan and land straight in the live screen.

const { Router } = require('express');
const QRCode = require('qrcode');

const REACHABLE_MS = 120000; // appliance seen within the last 2 minutes

// The QR render is CPU-heavy and unauthenticated. Bound it per IP so the
// endpoint cannot be hammered. Staff open this page on a tablet or print
// it, so a strict budget is fine.
const qrHits = new Map(); // ip -> { count, resetAt }
const QR_LIMIT = 30;
const QR_WINDOW_MS = 60 * 1000;

function qrRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const nowMs = Date.now();
  let e = qrHits.get(ip);
  if (!e || nowMs >= e.resetAt) {
    e = { count: 0, resetAt: nowMs + QR_WINDOW_MS };
    qrHits.set(ip, e);
  }
  e.count += 1;
  if (e.count > QR_LIMIT) {
    return res.status(429).json({ error: 'too many requests' });
  }
  next();
}

function backendBase(req) {
  if (process.env.PUBLIC_BACKEND_URL) {
    return process.env.PUBLIC_BACKEND_URL.replace(/\/+$/, '');
  }
  // Fallback: build from the request. The Host header is attacker
  // controlled, so validate it tightly: a poisoned Host here puts an
  // attacker's backend URL into printed seat QR codes, and scanning
  // patrons then connect to it. In production, set PUBLIC_BACKEND_URL.
  const host = req.get('host') || '';
  if (!/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) {
    throw new Error('cannot determine backend URL from request; set PUBLIC_BACKEND_URL');
  }
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${host}`;
}

function companionBase() {
  return (process.env.COMPANION_URL || 'https://everyline.example.com').replace(/\/+$/, '');
}

module.exports = (db) => {
  const r = Router();

  // "Current" means started but not listed for the future: without the
  // time window, a 9pm show listed at 7pm (or yesterday's show, forever)
  // reports as current and the seat QR claims "Captions live".
  // starts_at is ISO-8601 text (validated on write), so lexicographic
  // comparison is chronological.
  const currentShow = db.prepare(`
    SELECT * FROM shows WHERE auditorium_id = ?
      AND (starts_at IS NULL OR starts_at <= ?)
    ORDER BY starts_at IS NULL, starts_at DESC, created_at DESC LIMIT 1`);
  const applianceFor = db.prepare('SELECT * FROM appliances WHERE auditorium_id = ?');

  function nowPlaying(theaterId, auditoriumId) {
    const theater = db.prepare('SELECT * FROM theaters WHERE id = ?').get(theaterId);
    if (!theater) return { error: 'theater not found', status: 404 };
    const aud = db.prepare(
      'SELECT * FROM auditoriums WHERE id = ? AND theater_id = ?').get(auditoriumId, theaterId);
    if (!aud) return { error: 'auditorium not found', status: 404 };
    const s = currentShow.get(aud.id, new Date().toISOString());
    const ap = applianceFor.get(aud.id);
    const lastSeenMs = ap && ap.last_seen_at ? Date.parse(ap.last_seen_at) : 0;
    const reachable = Date.now() - lastSeenMs < REACHABLE_MS;
    const show = s ? {
      title: s.title,
      startsAt: s.starts_at,
      languages: JSON.parse(s.languages),
    } : null;
    return {
      theater: { id: theater.id, name: theater.name, chain: theater.chain, city: theater.city },
      auditorium: { id: aud.id, name: aud.name },
      currentShow: show,
      captionsAvailable: reachable && !!show,
      cueStreamUrl: reachable ? (ap && ap.cue_stream_url) || null : null,
    };
  }

  r.get('/v1/public/now-playing', (req, res) => {
    const { theaterId, auditoriumId } = req.query;
    if (!theaterId || !auditoriumId) {
      return res.status(400).json({ error: 'theaterId and auditoriumId are required' });
    }
    const out = nowPlaying(theaterId, auditoriumId);
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.json(out);
  });

  r.get('/v1/public/auditoriums/:auditoriumId/join', qrRateLimit, async (req, res) => {
    const aud = db.prepare('SELECT * FROM auditoriums WHERE id = ?').get(req.params.auditoriumId);
    if (!aud) return res.status(404).json({ error: 'auditorium not found' });
    const out = nowPlaying(aud.theater_id, aud.id);
    if (out.error) return res.status(out.status).json({ error: out.error });

    let base;
    try {
      base = backendBase(req);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    const deep = new URLSearchParams({
      source: 'theater',
      backend: base,
      theater: out.theater.id,
      auditorium: out.auditorium.id,
    });
    const deepLink = `${companionBase()}/?${deep.toString()}`;
    let qr;
    try {
      qr = await QRCode.toString(deepLink, { type: 'svg', margin: 2, width: 320 });
    } catch {
      return res.status(500).json({ error: 'qr render failed' });
    }

    const show = out.currentShow ? out.currentShow.title : 'No show listed';
    const badge = out.captionsAvailable ? 'Captions live' : 'Captions not live yet';
    res.set('content-type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>everyline — ${esc(out.auditorium.name)}</title>
<style>
body{background:#000;color:#f5f5f5;font-family:-apple-system,system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{max-width:380px;text-align:center}
h1{font-size:1.1rem;letter-spacing:-.01em;margin:0 0 4px}
p{color:#8f8f8f;margin:0 0 16px}
.qr{background:#fff;border-radius:16px;padding:12px;display:inline-block}
.qr svg{display:block;width:280px;height:280px}
.badge{display:inline-block;margin-top:16px;font-size:.8rem;letter-spacing:.06em;
text-transform:uppercase;color:${out.captionsAvailable ? '#ffd60a' : '#8f8f8f'}}
small{display:block;margin-top:12px;color:#555;font-size:.75rem}
</style></head><body><div class="card">
<h1>${esc(out.theater.name)} — ${esc(out.auditorium.name)}</h1>
<p>${esc(show)}</p>
<div class="qr">${qr}</div>
<div><span class="badge">${badge}</span></div>
<small>Scan with your phone to watch with live captions on your glasses.<br>
Print this page and place it at the seat.</small>
</div></body></html>`);
  });

  return r;
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
