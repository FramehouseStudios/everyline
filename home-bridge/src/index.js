import http from 'http';
import { createApp } from './server.js';

const PORT = Number(process.env.PORT) || 8787;

const { app, cueServer } = createApp();
const server = http.createServer(app);

import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({
  server,
  path: '/cue',
  // Cue-protocol messages are tiny. The ws default (100 MB) lets one
  // malicious or buggy client force a huge buffer alloc before it is
  // closed.
  maxPayload: 64 * 1024,
});
cueServer.attach(wss);

server.listen(PORT, () => {
  console.log(`everyline home bridge on http://0.0.0.0:${PORT}`);
  console.log(`cue stream at ws://0.0.0.0:${PORT}/cue`);
});
