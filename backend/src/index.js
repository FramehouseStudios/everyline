'use strict';
// everyline backend: the control plane.
// Theaters, auditoriums, booth appliances, shows, and patron discovery.
// The cue stream itself stays on the auditorium LAN (see demo/protocol.md);
// this service never sees caption content.

const express = require('express');
const { openDb } = require('./db');

function createApp({ dbPath } = {}) {
  const db = openDb(dbPath);
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // The companion PWA calls /v1/public/* and /v1/discovery cross-origin
  // (the seat QR encodes a backend URL that differs from the PWA origin).
  // Without these headers every real browser blocks the flagship
  // scan -> join -> live captions loop with a CORS error.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Api-Key');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/v1/health', (req, res) => res.json({
    ok: true, version: '0.1.0', time: new Date().toISOString(),
  }));

  app.use(require('./routes/theaters')(db));
  app.use(require('./routes/auditoriums')(db));
  app.use(require('./routes/appliances')(db));
  app.use(require('./routes/shows')(db));
  app.use(require('./routes/discovery')(db));
  app.use(require('./routes/public')(db));

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return { app, db };
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  if (!process.env.OPERATOR_TOKEN) {
    // Fail closed: the dev default must never guard a real deployment.
    console.error('[everyline] refusing to start: OPERATOR_TOKEN is not set');
    process.exit(1);
  }
  const { app } = createApp();
  app.listen(port, () => console.log(`[everyline] backend listening on :${port}`));
}

module.exports = { createApp };
