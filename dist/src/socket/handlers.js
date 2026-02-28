"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHandlers = registerHandlers;
const types_1 = require("../game/types");
const room_manager_1 = require("../game/room-manager");
const engine_1 = require("../game/engine");
const gemini_1 = require("../inference/gemini");
const intensity_1 = require("../inference/intensity");
const logger_1 = require("../game/logger");
function emitError(socket, code, message) {
    (0, logger_1.log)('SOCKET', 'emit-error', { sid: socket.id, code, message });
    socket.emit('error', { code, message });
}
function getOpponentSocketId(room, excludeToken) {
    for (const [token, player] of Object.entries(room.players)) {
        if (token !== excludeToken && player.socketId) {
            return player.socketId;
        }
    }
    return null;
}
function playerCount(room) {
    return Object.keys(room.players).length;
}
function connectedCount(room) {
    return Object.values(room.players).filter(p => p.connected).length;
}
function registerHandlers(io) {
    (0, room_manager_1.startCleanupInterval)();
    io.on('connection', (socket) => {
        const sid = socket.id;
        (0, logger_1.log)('SOCKET', 'connect', {
            sid,
            transport: socket.conn.transport.name,
            remote: socket.handshake.address,
        });
        // === CREATE ROOM ===
        socket.on('create-room', () => {
            const elapsed = (0, logger_1.timer)();
            const result = (0, room_manager_1.createRoom)(sid);
            socket.join(result.room.id);
            socket.emit('room-created', {
                roomId: result.room.id,
                mark: 'X',
                playerToken: result.playerToken,
            });
            (0, logger_1.log)('ROOM', 'created', {
                room: result.room.id,
                mark: 'X',
                sid,
                ms: elapsed(),
            });
        });
        // === JOIN ROOM ===
        socket.on('join-room', (payload) => {
            const elapsed = (0, logger_1.timer)();
            const { roomId } = payload;
            (0, logger_1.log)('ROOM', 'join-attempt', { room: roomId, sid });
            const result = (0, room_manager_1.joinRoom)(roomId, sid);
            if ('error' in result) {
                (0, logger_1.log)('ROOM', 'join-rejected', { room: roomId, sid, reason: result.error });
                emitError(socket, result.error, getErrorMessage(result.error));
                return;
            }
            socket.join(roomId);
            const room = result.room;
            for (const [token, player] of Object.entries(room.players)) {
                if (player.socketId) {
                    const startPayload = {
                        roomId,
                        board: room.board,
                        currentTurn: room.currentTurn,
                        players: Object.fromEntries(Object.entries(room.players).map(([, p]) => [p.mark, { mark: p.mark }])),
                        intensity: 0,
                    };
                    if (token === result.playerToken) {
                        startPayload.playerToken = result.playerToken;
                    }
                    io.to(player.socketId).emit('game-start', startPayload);
                }
            }
            (0, logger_1.log)('ROOM', 'joined', {
                room: roomId,
                mark: 'O',
                sid,
                players: playerCount(room),
                status: room.status,
                ms: elapsed(),
            });
        });
        // === MAKE MOVE (non-blocking inference) ===
        socket.on('make-move', (payload) => {
            const moveTimer = (0, logger_1.timer)();
            const { roomId, cell } = payload;
            // --- Validate ---
            const roomInfo = (0, room_manager_1.getRoomBySocket)(sid);
            if (!roomInfo) {
                emitError(socket, 'ROOM_NOT_FOUND', 'Room does not exist');
                return;
            }
            const { room, playerToken } = roomInfo;
            if (room.status !== 'active') {
                (0, logger_1.log)('GAME', 'move-rejected', { room: roomId, reason: 'not-active', status: room.status });
                emitError(socket, 'GAME_NOT_ACTIVE', 'Game is not in active state');
                return;
            }
            const mark = (0, room_manager_1.getPlayerMark)(room, playerToken);
            if (!mark || mark !== room.currentTurn) {
                (0, logger_1.log)('GAME', 'move-rejected', { room: roomId, reason: 'not-your-turn', mark, turn: room.currentTurn });
                emitError(socket, 'NOT_YOUR_TURN', 'It is not your turn');
                return;
            }
            if (!(0, engine_1.isValidCell)(cell)) {
                (0, logger_1.log)('GAME', 'move-rejected', { room: roomId, reason: 'invalid-cell', cell });
                emitError(socket, 'INVALID_CELL', 'Cell index out of range (0-8)');
                return;
            }
            if (!(0, engine_1.isCellEmpty)(room.board, cell)) {
                (0, logger_1.log)('GAME', 'move-rejected', { room: roomId, reason: 'cell-occupied', cell });
                emitError(socket, 'CELL_OCCUPIED', 'Cell is already occupied');
                return;
            }
            // --- Place marker ---
            room.board = (0, engine_1.placeMarker)(room.board, cell, mark);
            const moveNumber = room.moveHistory.length + 1;
            // Instant heuristic intensity (synchronous, ~0ms)
            const heuristicIntensity = (0, intensity_1.analyzeIntensity)(room.board, room.currentTurn);
            room.intensity = heuristicIntensity;
            // Record move with heuristic value (will be upgraded when Gemini returns)
            const moveIndex = room.moveHistory.length;
            room.moveHistory.push({
                cell,
                mark,
                timestamp: Date.now(),
                intensity: heuristicIntensity,
            });
            (0, logger_1.log)('GAME', 'move-placed', {
                room: roomId,
                cell,
                mark,
                move: moveNumber,
                board: (0, logger_1.formatBoard)(room.board),
                heuristic: heuristicIntensity.toFixed(2),
                ms: moveTimer(),
            });
            // --- Check game result ---
            const result = (0, engine_1.checkGameResult)(room.board);
            if (result) {
                room.status = 'finished';
                room.winner = result.winner;
                io.to(roomId).emit('game-over', {
                    winner: result.winner,
                    winningCells: result.winningCells,
                    board: room.board,
                    finalIntensity: room.intensity,
                });
                (0, logger_1.log)('GAME', 'game-over', {
                    room: roomId,
                    winner: result.winner,
                    winningCells: result.winningCells,
                    moves: moveNumber,
                    intensity: heuristicIntensity.toFixed(2),
                    ms: moveTimer(),
                });
            }
            else {
                room.currentTurn = (0, types_1.toggleTurn)(room.currentTurn);
                io.to(roomId).emit('move-made', {
                    board: room.board,
                    cell,
                    mark,
                    currentTurn: room.currentTurn,
                    intensity: room.intensity,
                    moveNumber,
                });
                (0, logger_1.log)('GAME', 'move-emitted', {
                    room: roomId,
                    nextTurn: room.currentTurn,
                    intensity: heuristicIntensity.toFixed(2),
                    ms: moveTimer(),
                });
            }
            // --- Fire Gemini in background (non-blocking) ---
            const inferTimer = (0, logger_1.timer)();
            const boardSnapshot = [...room.board];
            (0, gemini_1.getIntensity)(boardSnapshot, mark, moveNumber)
                .then((intensityResult) => {
                const elapsed = inferTimer();
                // Only update if room still exists and hasn't been reset (rematch)
                if (room.moveHistory.length >= moveNumber) {
                    room.intensity = intensityResult.value;
                    room.moveHistory[moveIndex].intensity = intensityResult.value;
                }
                io.to(roomId).emit('intensity-update', {
                    intensity: intensityResult.value,
                    source: intensityResult.source,
                    moveNumber,
                });
                (0, logger_1.log)('INFER', 'intensity-resolved', {
                    room: roomId,
                    move: moveNumber,
                    value: intensityResult.value.toFixed(2),
                    source: intensityResult.source,
                    delta: (intensityResult.value - heuristicIntensity).toFixed(2),
                    ms: elapsed,
                });
            })
                .catch((err) => {
                (0, logger_1.logError)('INFER', 'intensity-failed', err, {
                    room: roomId,
                    move: moveNumber,
                    ms: inferTimer(),
                });
            });
        });
        // === REMATCH ===
        socket.on('rematch', () => {
            const roomInfo = (0, room_manager_1.getRoomBySocket)(sid);
            if (!roomInfo) {
                emitError(socket, 'ROOM_NOT_FOUND', 'Room does not exist');
                return;
            }
            const { room, playerToken } = roomInfo;
            if (room.status !== 'finished') {
                emitError(socket, 'GAME_NOT_ACTIVE', 'Game is not in finished state');
                return;
            }
            const playerMark = (0, room_manager_1.getPlayerMark)(room, playerToken);
            (0, logger_1.log)('ROOM', 'rematch-request', { room: room.id, mark: playerMark, sid });
            const rematchStarted = (0, room_manager_1.requestRematch)(room, playerToken);
            if (rematchStarted) {
                io.to(room.id).emit('game-start', {
                    roomId: room.id,
                    board: room.board,
                    currentTurn: room.currentTurn,
                    players: Object.fromEntries(Object.entries(room.players).map(([, p]) => [p.mark, { mark: p.mark }])),
                    intensity: 0,
                });
                (0, logger_1.log)('ROOM', 'rematch-started', { room: room.id, firstTurn: room.currentTurn });
            }
            else {
                (0, logger_1.log)('ROOM', 'rematch-waiting', { room: room.id, waiting: room.rematchRequests.size });
            }
        });
        // === REJOIN ROOM ===
        socket.on('rejoin-room', (payload) => {
            const elapsed = (0, logger_1.timer)();
            const { roomId, playerToken } = payload;
            (0, logger_1.log)('SOCKET', 'rejoin-attempt', { room: roomId, sid });
            const result = (0, room_manager_1.reconnectPlayer)(roomId, playerToken, sid);
            if ('error' in result) {
                (0, logger_1.log)('SOCKET', 'rejoin-rejected', { room: roomId, sid, reason: result.error });
                emitError(socket, result.error, getErrorMessage(result.error));
                return;
            }
            const { room, mark } = result;
            socket.join(roomId);
            socket.emit('game-state', {
                roomId,
                board: room.board,
                currentTurn: room.currentTurn,
                mark,
                intensity: room.intensity,
                status: room.status,
                moveHistory: room.moveHistory,
            });
            const opponentSocketId = getOpponentSocketId(room, playerToken);
            if (opponentSocketId) {
                io.to(opponentSocketId).emit('player-reconnected', {
                    reconnectedMark: mark,
                });
            }
            (0, logger_1.log)('SOCKET', 'rejoin-success', {
                room: roomId,
                mark,
                sid,
                status: room.status,
                moves: room.moveHistory.length,
                connected: connectedCount(room),
                ms: elapsed(),
            });
        });
        // === DISCONNECT ===
        socket.on('disconnect', (reason) => {
            const result = (0, room_manager_1.disconnectPlayer)(sid);
            if (!result) {
                (0, logger_1.log)('SOCKET', 'disconnect', { sid, reason, inRoom: false });
                return;
            }
            const { room, disconnectedMark } = result;
            (0, logger_1.log)('SOCKET', 'disconnect', {
                sid,
                reason,
                room: room.id,
                mark: disconnectedMark,
                status: room.status,
                connected: connectedCount(room),
            });
            let disconnectedToken = null;
            for (const [token, player] of Object.entries(room.players)) {
                if (player.mark === disconnectedMark && !player.connected) {
                    disconnectedToken = token;
                    break;
                }
            }
            const opponentSocketId = getOpponentSocketId(room, disconnectedToken || '');
            if (opponentSocketId) {
                const timeout = Number(process.env.RECONNECT_TIMEOUT) || 30000;
                io.to(opponentSocketId).emit('player-disconnected', {
                    disconnectedMark,
                    timeout,
                });
                (0, logger_1.log)('SOCKET', 'notify-opponent', { room: room.id, event: 'player-disconnected', timeout });
            }
            if (disconnectedToken && room.status === 'active') {
                (0, logger_1.log)('ROOM', 'forfeit-timer-start', {
                    room: room.id,
                    mark: disconnectedMark,
                    timeoutMs: Number(process.env.RECONNECT_TIMEOUT) || 30000,
                });
                (0, room_manager_1.setDisconnectTimer)(disconnectedToken, () => {
                    (0, logger_1.log)('ROOM', 'forfeit-timer-expired', { room: room.id, mark: disconnectedMark });
                    const forfeited = (0, room_manager_1.forfeitRoom)(room.id, disconnectedToken);
                    if (forfeited && opponentSocketId) {
                        const winnerMark = disconnectedMark === 'X' ? 'O' : 'X';
                        io.to(opponentSocketId).emit('game-over', {
                            winner: winnerMark,
                            board: forfeited.board,
                            finalIntensity: forfeited.intensity,
                        });
                        (0, logger_1.log)('GAME', 'game-over', {
                            room: room.id,
                            winner: winnerMark,
                            reason: 'forfeit',
                            moves: room.moveHistory.length,
                        });
                    }
                });
            }
        });
    });
}
function getErrorMessage(code) {
    const messages = {
        ROOM_NOT_FOUND: 'Room does not exist',
        ROOM_FULL: 'Room already has two players',
        GAME_NOT_ACTIVE: 'Game is not in active state',
        NOT_YOUR_TURN: 'It is not your turn',
        INVALID_CELL: 'Cell index out of range (0-8)',
        CELL_OCCUPIED: 'Cell is already occupied',
        ALREADY_IN_ROOM: 'Player is already in a room',
        INVALID_TOKEN: 'Session token does not match any player in room',
        RECONNECT_EXPIRED: 'Reconnection window has expired',
    };
    return messages[code] || 'An unknown error occurred';
}
