// everyline home bridge: HTTP control + Cue Stream Protocol v0 on one port.
//
// The bridge is the booth, for the living room. The companion app talks to
// it exactly like a theater booth; only the "showing" and the source of the
// media clock differ.

import express from 'express';
import { WebSocketServer } from 'ws';
import { ManualMedia } from './providers/manual.js';
import { PlexMedia } from './providers/plex.js';
import { CueServer } from './cueServer.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const manual = new ManualMedia();
  let media = manual;
  let mediaKind = 'manual';

  const getMedia = () => media;

  app.get('/v1/status', async (req, res) => {
    res.json({
      source: 'home',
      kind: mediaKind,
      title: media.title,
      languages: media.languages(),
      media: await media.state(),
    });
  });

  // Manual provider: load an SRT track.
  app.post('/v1/load', (req, res) => {
    const { lang = 'en', srt, title } = req.body || {};
    if (!srt) return res.status(400).json({ error: 'srt text required' });
    try {
      const n = manual.load(lang, srt, title);
      media = manual;
      mediaKind = 'manual';
      res.json({ ok: true, lang, cues: n, title: manual.title });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Manual provider: transport control (tap-to-sync).
  app.post('/v1/transport', (req, res) => {
    if (mediaKind !== 'manual') {
      return res.status(409).json({ error: `transport is owned by ${mediaKind}` });
    }
    const { action, positionMs } = req.body || {};
    if (action === 'play') manual.play();
    else if (action === 'pause') manual.pause();
    else if (action === 'seek') manual.seek(Number(positionMs) || 0);
    else return res.status(400).json({ error: 'action must be play, pause, or seek' });
    manual.state().then((s) => res.json({ ok: true, media: s }));
  });

  // Plex provider: list active sessions.
  app.get('/v1/providers/plex/sessions', async (req, res) => {
    const { url, token } = req.query;
    if (!url || !token) return res.status(400).json({ error: 'url and token required' });
    try {
      const plex = new PlexMedia({ url, token });
      res.json({ sessions: await plex.sessions() });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // Plex provider: bind the bridge to one session's subtitles.
  app.post('/v1/providers/plex/attach', async (req, res) => {
    const { url, token, sessionKey } = req.body || {};
    if (!url || !token || !sessionKey) {
      return res.status(400).json({ error: 'url, token, and sessionKey required' });
    }
    try {
      const plex = new PlexMedia({ url, token });
      const session = await plex.attach(sessionKey);
      // Warm the default language's cache now so first paint is fast.
      const langs = session.languages();
      if (langs.includes('en')) await session.cues('en');
      media = session;
      mediaKind = 'plex';
      res.json({ ok: true, title: session.title, languages: langs });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // Back to manual.
  app.post('/v1/providers/manual', (req, res) => {
    media = manual;
    mediaKind = 'manual';
    res.json({ ok: true });
  });

  return { app, getMedia, cueServer: new CueServer({ getMedia, source: 'home' }) };
}
