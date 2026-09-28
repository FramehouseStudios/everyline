// Plex provider: true sync for the home library.
//
// Reads playback position from Plex's session API and pulls the subtitle
// stream for the active session, then serves it over Cue Stream Protocol v0
// exactly like the theater booth does. The phone can't tell the difference.
//
// Built against Plex's documented API shapes (/status/sessions, stream keys).
// Tested here against a mock Plex server; verify once against a real one
// before calling it production (see README).

import { parseSrt } from '../srt.js';

const LANG3 = {
  eng: 'en', spa: 'es', fre: 'fr', deu: 'de', ita: 'it',
  por: 'pt', nld: 'nl', jpn: 'ja', kor: 'ko', zho: 'zh',
};

function normLang(code) {
  const c = String(code || '').toLowerCase();
  return LANG3[c] || c;
}

export class PlexMedia {
  constructor({ url, token, fetchImpl = fetch }) {
    this.url = String(url).replace(/\/+$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  _get(path) {
    const sep = path.includes('?') ? '&' : '?';
    return this.fetch(`${this.url}${path}${sep}X-Plex-Token=${encodeURIComponent(this.token)}`, {
      headers: { Accept: 'application/json' },
    });
  }

  async sessions() {
    const res = await this._get('/status/sessions');
    if (!res.ok) throw new Error(`plex sessions: HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.MediaContainer?.Metadata || [];
    return items.map((m) => ({
      key: m.key,
      title: m.grandparentTitle || m.title,
      episode: m.title,
      state: m.Player?.state || 'paused',
      positionMs: m.viewOffset || 0,
      durationMs: m.duration || 0,
    }));
  }

  // Bind to one active session; returns a PlexSession implementing the
  // media interface the cue server expects.
  async attach(sessionKey) {
    const res = await this._get(sessionKey);
    if (!res.ok) throw new Error(`plex metadata: HTTP ${res.status}`);
    const data = await res.json();
    const meta = data?.MediaContainer?.Metadata?.[0];
    if (!meta) throw new Error('plex: session metadata not found');
    const streams = [];
    for (const media of meta.Media || []) {
      for (const part of media.Part || []) {
        for (const s of part.Stream || []) {
          if (s.streamType === 3 && s.key) {
            streams.push({ lang: normLang(s.languageCode), key: s.key, codec: s.codec });
          }
        }
      }
    }
    if (!streams.length) throw new Error('plex: no downloadable subtitle streams on this session');
    return new PlexSession(this, sessionKey, meta, streams);
  }
}

class PlexSession {
  constructor(client, sessionKey, meta, streams) {
    this.client = client;
    this.sessionKey = sessionKey;
    this.title = meta.grandparentTitle || meta.title || 'Plex';
    this.streams = streams;
    this.cache = new Map(); // lang -> cues
  }

  languages() {
    return [...new Set(this.streams.map((s) => s.lang))];
  }

  async cues(lang) {
    if (this.cache.has(lang)) return this.cache.get(lang);
    const stream = this.streams.find((s) => s.lang === lang);
    if (!stream) return [];
    const res = await this.client._get(stream.key);
    if (!res.ok) throw new Error(`plex subtitle download: HTTP ${res.status}`);
    const text = await res.text();
    const cues = parseSrt(text);
    if (!cues.length) {
      throw new Error(
        `plex: subtitle stream for [${lang}] is not SRT-shaped (codec ${stream.codec}); text-based SRT/VTT only in v1`);
    }
    this.cache.set(lang, cues);
    return cues;
  }

  async state() {
    const sessions = await this.client.sessions();
    const s = sessions.find((x) => x.key === this.sessionKey);
    if (!s) return { status: 'paused', positionMs: 0 };
    return {
      status: s.state === 'playing' ? 'playing' : 'paused',
      positionMs: s.positionMs,
    };
  }
}
