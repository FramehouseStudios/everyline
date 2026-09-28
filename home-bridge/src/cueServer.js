// CueServer: speaks Cue Stream Protocol v0 to phones.
//
// Identical wire contract to the theater booth (see demo/protocol.md):
// hello -> welcome + transport, subscribe -> lookahead cues in the chosen
// language, transport broadcast at 1Hz, heartbeat implied by transport.
// The media behind it is pluggable: manual SRT, Plex session, later
// Jellyfin/Emby. The phone cannot tell which one is talking.

const LOOKAHEAD_MS = 750;
const TICK_MS = 250;

export class CueServer {
  constructor({ getMedia, source = 'home' }) {
    this.getMedia = getMedia; // () -> media implementing the media interface
    this.source = source;
    this.clients = new Set();
    this._timer = null;
  }

  attach(wss) {
    wss.on('connection', (ws) => this._onConnection(ws));
    this._timer = setInterval(() => this._tick(), TICK_MS);
    // Heartbeat: drop phones that lost WiFi without a close frame,
    // otherwise `clients` grows forever and its size (broadcast in every
    // transport message) lies.
    this._heartbeat = setInterval(() => {
      for (const client of [...this.clients]) {
        if (!client.alive) {
          try { client.ws.terminate(); } catch { /* gone */ }
          this.clients.delete(client);
        } else {
          client.alive = false;
          try { client.ws.ping(); } catch { /* gone */ }
        }
      }
    }, 30000);
  }

  close() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._heartbeat) clearInterval(this._heartbeat);
    this._heartbeat = null;
    for (const c of this.clients) {
      try { c.ws.close(); } catch { /* gone */ }
    }
    this.clients.clear();
  }

  _onConnection(ws) {
    const client = { ws, lang: 'en', sent: new Set(), posMs: null, alive: true };
    this.clients.add(client);
    // Never let a socket error become an uncaught 'error' event: that
    // kills the whole Node process. Close the socket; the 'close'
    // handler below removes the client.
    ws.on('error', () => { try { ws.close(); } catch { /* gone */ } });
    ws.on('message', (raw) => {
      // _onMessage is async: an unhandled rejection (Plex down, network
      // blip) would crash the bridge for every connected phone. Answer
      // the sender with an error frame instead.
      this._onMessage(client, raw).catch((e) => {
        this._send(client, { type: 'error', error: String((e && e.message) || e) });
      });
    });
    ws.on('close', () => this.clients.delete(client));
    ws.on('pong', () => { client.alive = true; });
  }

  async _onMessage(client, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const media = this.getMedia();
    if (msg.type === 'hello') {
      this._send(client, {
        type: 'welcome',
        protocol: 0,
        showing: { title: media.title, auditorium: 'Home' },
        serverNowMs: Date.now(),
        languages: media.languages(),
        source: this.source,
      });
      this._send(client, await this._transport(media));
    } else if (msg.type === 'subscribe') {
      client.lang = msg.lang || 'en';
      client.sent.clear();
      await this._emitDue(client, media);
    }
  }

  async _transport(media, st) {
    const s = st || await media.state();
    return {
      type: 'transport',
      status: s.status,
      positionMs: s.positionMs,
      serverNowMs: Date.now(),
      clients: this.clients.size,
    };
  }

  async _emitDue(client, media, st) {
    const s = st || await media.state();
    const pos = s.positionMs;
    let cues = media.cues(client.lang);
    if (cues && typeof cues.then === 'function') cues = await cues;
    cues = cues || [];
    // Rewind: a backward jump must resend cues in the rewound region.
    // `sent` otherwise remembers them forever and the rewound section
    // plays with no captions.
    if (client.posMs !== null && pos < client.posMs) {
      const endById = new Map(cues.map((c) => [c.id, c.endMs]));
      for (const cid of [...client.sent]) {
        if ((endById.get(cid) || 0) > pos) client.sent.delete(cid);
      }
    }
    client.posMs = pos;
    for (const c of cues) {
      if (c.startMs > pos + LOOKAHEAD_MS) break;
      if (c.endMs <= pos) continue; // over; never visible again
      if (client.sent.has(c.id)) continue;
      client.sent.add(c.id);
      this._send(client, {
        type: 'cue',
        id: `${client.lang}-${c.id}`,
        lang: client.lang,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
        issuedAtMs: Date.now(),
      });
    }
  }

  async _tick() {
    // setInterval does not await: without the guard a hung media backend
    // piles up overlapping ticks without bound.
    if (this._ticking || !this.clients.size) return;
    this._ticking = true;
    try {
      const media = this.getMedia();
      // One state poll per tick, shared by every client: previously each
      // tick cost 1 + N full Plex /status/sessions fetches (12+/s with two
      // phones), inviting rate limiting.
      let st = null;
      try { st = await media.state(); } catch { /* media down; skip */ }
      const transport = st ? {
        type: 'transport',
        status: st.status,
        positionMs: st.positionMs,
        serverNowMs: Date.now(),
        clients: this.clients.size,
      } : null;
      for (const client of [...this.clients]) {
        if (client.ws.readyState !== 1) continue;
        try { await this._emitDue(client, media, st); } catch { /* drop */ }
        if (transport) this._send(client, { ...transport });
      }
    } finally {
      this._ticking = false;
    }
  }

  _send(client, obj) {
    try {
      if (client.ws.readyState === 1) client.ws.send(JSON.stringify(obj));
    } catch {
      /* drop */
    }
  }
}
