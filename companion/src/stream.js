// BoothStream: the WebSocket conversation with the booth appliance.
//
// Speaks Cue Stream Protocol v0 (see demo/protocol.md): hello on connect,
// subscribe for a language, then welcome/cue/transport inbound. Reconnects
// with capped exponential backoff; hello+subscribe are re-sent on every
// (re)connect so join-in-progress works after a drop.
//
// The WebSocket implementation is injected so this is testable in Node
// (ws package) and runs in the browser (native WebSocket) unchanged.

const PROTOCOL_VERSION = 0;

export class BoothStream {
  constructor({ wsImpl, handlers = {} }) {
    this.WS = wsImpl;
    this.h = handlers;
    this.state = 'idle'; // idle|connecting|live|reconnecting|closed
    this.attempt = 0;
    this.url = null;
    this.lang = null;
    this.ws = null;
    this._timer = null;
  }

  connect(url) {
    this.close();
    this.url = url;
    this.attempt = 0;
    this.state = 'idle';
    this._open();
  }

  subscribe(lang) {
    this.lang = lang;
    if (this.state === 'live') this._send({ type: 'subscribe', lang });
    if (this.h.onLanguage) this.h.onLanguage(lang);
  }

  close() {
    this.state = 'closed';
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    try {
      if (this.ws) this.ws.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
  }

  _open() {
    this._setState('connecting');
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this._setState('live');
      this._send({ type: 'hello', client: 'everyline-companion', protocol: PROTOCOL_VERSION });
      if (this.lang) this._send({ type: 'subscribe', lang: this.lang });
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      this._route(msg);
    };
    ws.onclose = () => this._reconnect();
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* onclose will drive the reconnect */
      }
    };
  }

  _route(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'welcome' && this.h.onWelcome) this.h.onWelcome(msg);
    else if (msg.type === 'cue' && this.h.onCue) this.h.onCue(msg);
    else if (msg.type === 'transport' && this.h.onTransport) this.h.onTransport(msg);
  }

  _reconnect() {
    if (this.state === 'closed') return;
    this._setState('reconnecting');
    const delay = Math.min(500 * 2 ** this.attempt, 15000);
    this.attempt += 1;
    this._timer = setTimeout(() => this._open(), delay);
  }

  _send(obj) {
    try {
      this.ws.send(JSON.stringify(obj));
    } catch {
      /* reconnect will repair */
    }
  }

  _setState(s) {
    this.state = s;
    if (this.h.onStatus) this.h.onStatus(s);
  }
}
