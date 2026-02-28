import 'dotenv/config';
import { createServer } from 'http';
import next from 'next';
import { Server } from 'socket.io';
import { registerHandlers } from './src/socket/handlers';
import { log } from './src/game/logger';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

log('SERVER', 'booting', {
  env: dev ? 'development' : 'production',
  port,
  clientOrigin,
  geminiKey: process.env.GEMINI_API_KEY ? 'set' : 'MISSING',
  inferenceTimeout: Number(process.env.INFERENCE_TIMEOUT) || 3000,
  reconnectTimeout: Number(process.env.RECONNECT_TIMEOUT) || 30000,
});

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  log('SERVER', 'next-ready');

  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    cors: {
      origin: clientOrigin,
      methods: ['GET', 'POST'],
    },
  });

  registerHandlers(io);
  log('SERVER', 'socket-handlers-registered');

  httpServer.listen(port, () => {
    log('SERVER', 'listening', { url: `http://localhost:${port}` });
  });
});
