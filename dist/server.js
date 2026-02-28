"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const http_1 = require("http");
const next_1 = __importDefault(require("next"));
const socket_io_1 = require("socket.io");
const handlers_1 = require("./src/socket/handlers");
const logger_1 = require("./src/game/logger");
const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
(0, logger_1.log)('SERVER', 'booting', {
    env: dev ? 'development' : 'production',
    port,
    clientOrigin,
    geminiKey: process.env.GEMINI_API_KEY ? 'set' : 'MISSING',
    inferenceTimeout: Number(process.env.INFERENCE_TIMEOUT) || 3000,
    reconnectTimeout: Number(process.env.RECONNECT_TIMEOUT) || 30000,
});
const app = (0, next_1.default)({ dev });
const handle = app.getRequestHandler();
app.prepare().then(() => {
    (0, logger_1.log)('SERVER', 'next-ready');
    const httpServer = (0, http_1.createServer)((req, res) => {
        handle(req, res);
    });
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: clientOrigin,
            methods: ['GET', 'POST'],
        },
    });
    (0, handlers_1.registerHandlers)(io);
    (0, logger_1.log)('SERVER', 'socket-handlers-registered');
    httpServer.listen(port, () => {
        (0, logger_1.log)('SERVER', 'listening', { url: `http://localhost:${port}` });
    });
});
