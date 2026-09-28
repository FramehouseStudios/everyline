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
  }

  close() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    for (const c of this.clients) {
      try { c.ws.close(); } catch { /* gone */ }
    }
    this.clients.clear();
  }

  _onConnection(ws) {
    const client = { ws, lang: 'en', sent: new Set() };
    this.clients.add(client);
    ws.on('message', (raw) => this._onMessage(client, raw));
    ws.on('close', () => this.clients.delete(client));
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

  async _transport(media) {
    const s = await media.state();
    return {
      type: 'transport',
      status: s.status,
      positionMs: s.positionMs,
      serverNowMs: Date.now(),
      clients: this.clients.size,
    };
  }

  async _emitDue(client, media) {
    const s = await media.state();
    const pos = s.positionMs;
    let cues = media.cues(client.lang);
    if (cues && typeof cues.then === 'function') cues = await cues;
    for (const c of cues || []) {
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
    if (!this.clients.size) return;
    const media = this.getMedia();
    const transport = await this._transport(media).catch(() => null);
    for (const client of [...this.clients]) {
      if (client.ws.readyState !== 1) continue;
      await this._emitDue(client, media).catch(() => {});
      if (transport) this._send(client, { ...transport });
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
