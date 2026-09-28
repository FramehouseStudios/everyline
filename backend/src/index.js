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

  app.get('/v1/health', (req, res) => res.json({
    ok: true, version: '0.1.0', time: new Date().toISOString(),
  }));

  app.use(require('./routes/theaters')(db));
  app.use(require('./routes/auditoriums')(db));
  app.use(require('./routes/appliances')(db));
  app.use(require('./routes/shows')(db));
  app.use(require('./routes/discovery')(db));

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
    console.warn('[everyline] OPERATOR_TOKEN not set, using dev default (do not use in production)');
  }
  const { app } = createApp();
  app.listen(port, () => console.log(`[everyline] backend listening on :${port}`));
}

module.exports = { createApp };
