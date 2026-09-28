import http from 'http';
import { createApp } from './server.js';

const PORT = Number(process.env.PORT) || 8787;

const { app, cueServer } = createApp();
const server = http.createServer(app);

import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ server, path: '/cue' });
cueServer.attach(wss);

server.listen(PORT, () => {
  console.log(`everyline home bridge on http://0.0.0.0:${PORT}`);
  console.log(`cue stream at ws://0.0.0.0:${PORT}/cue`);
});
