"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHandlers = registerHandlers;
const types_1 = require("../game/types");
const room_manager_1 = require("../game/room-manager");
const engine_1 = require("../game/engine");
const gemini_1 = require("../inference/gemini");
const intensity_1 = require("../inference/intensity");
const logger_1 = require("../game/logger");
const ROUND_TRANSITION_DELAY = 3000;
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
                        series: {
                            currentRound: room.series.currentRound,
                            maxRounds: room.series.maxRounds,
                            wins: { ...room.series.wins },
                            seriesOver: false,
                            roundResults: [],
                        },
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
                const code = room.status === 'round-over' ? 'ROUND_TRANSITION' : 'GAME_NOT_ACTIVE';
                const msg = room.status === 'round-over' ? 'Round is transitioning' : 'Game is not in active state';
                (0, logger_1.log)('GAME', 'move-rejected', { room: roomId, reason: code, status: room.status });
                emitError(socket, code, msg);
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
                // Record the round result
                (0, room_manager_1.recordRoundResult)(room, result.winner, room.intensity);
                // Check if series is decided
                const seriesDecided = (0, room_manager_1.checkSeriesOver)(room);
                // Emit round-over to room
                io.to(roomId).emit('round-over', {
                    round: room.series.currentRound,
                    winner: result.winner,
                    winningCells: result.winningCells,
                    board: room.board,
                    finalIntensity: room.intensity,
                    series: {
                        wins: { ...room.series.wins },
                        currentRound: room.series.currentRound,
                        maxRounds: room.series.maxRounds,
                        seriesOver: room.series.seriesOver,
                        roundResults: [...room.series.roundResults],
                    },
                    nextRoundIn: seriesDecided ? null : ROUND_TRANSITION_DELAY,
                });
                (0, logger_1.log)('GAME', 'round-over', {
                    room: roomId,
                    round: room.series.currentRound,
                    winner: result.winner,
                    score: `${room.series.wins.X}-${room.series.wins.O}`,
                    seriesOver: seriesDecided,
                    ms: moveTimer(),
                });
                if (seriesDecided) {
                    // Emit series-over
                    room.status = 'finished';
                    const totalMoves = room.series.roundResults.reduce((sum, r) => sum + r.moves, 0);
                    const peakIntensity = Math.max(...room.series.roundResults.map(r => r.finalIntensity), 0);
                    io.to(roomId).emit('series-over', {
                        seriesWinner: room.series.seriesWinner,
                        finalScore: { ...room.series.wins },
                        rounds: room.series.roundResults.map(r => ({ round: r.round, winner: r.winner, moves: r.moves })),
                        totalMoves,
                        peakIntensity,
                    });
                    (0, logger_1.log)('GAME', 'series-over', {
                        room: roomId,
                        winner: room.series.seriesWinner,
                        score: `${room.series.wins.X}-${room.series.wins.O}`,
                        totalMoves,
                    });
                }
                else {
                    // Schedule next round after delay
                    setTimeout(() => {
                        // Guard: room might have been cleaned up
                        const currentRoom = (0, room_manager_1.getRoom)(roomId);
                        if (!currentRoom || currentRoom.status !== 'round-over')
                            return;
                        (0, room_manager_1.advanceRound)(currentRoom);
                        io.to(roomId).emit('round-start', {
                            round: currentRoom.series.currentRound,
                            board: currentRoom.board,
                            currentTurn: currentRoom.currentTurn,
                            series: {
                                wins: { ...currentRoom.series.wins },
                                currentRound: currentRoom.series.currentRound,
                                maxRounds: currentRoom.series.maxRounds,
                            },
                            intensity: 0,
                        });
                        (0, logger_1.log)('GAME', 'round-start', {
                            room: roomId,
                            round: currentRoom.series.currentRound,
                            firstTurn: currentRoom.currentTurn,
                        });
                    }, ROUND_TRANSITION_DELAY);
                }
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
                    series: {
                        currentRound: room.series.currentRound,
                        wins: { ...room.series.wins },
                    },
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
            (0, gemini_1.getIntensity)(boardSnapshot, mark, moveNumber, room.series)
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
                    seriesPressure: intensityResult.seriesPressure,
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
        // === NEW SERIES ===
        socket.on('new-series', () => {
            const roomInfo = (0, room_manager_1.getRoomBySocket)(sid);
            if (!roomInfo) {
                emitError(socket, 'ROOM_NOT_FOUND', 'Room does not exist');
                return;
            }
            const { room, playerToken } = roomInfo;
            if (!room.series.seriesOver) {
                emitError(socket, 'SERIES_NOT_FINISHED', 'Series is not finished');
                return;
            }
            const playerMark = (0, room_manager_1.getPlayerMark)(room, playerToken);
            (0, logger_1.log)('ROOM', 'new-series-request', { room: room.id, mark: playerMark, sid });
            const started = (0, room_manager_1.requestRematch)(room, playerToken);
            if (started) {
                io.to(room.id).emit('round-start', {
                    round: room.series.currentRound,
                    board: room.board,
                    currentTurn: room.currentTurn,
                    series: {
                        wins: { ...room.series.wins },
                        currentRound: room.series.currentRound,
                        maxRounds: room.series.maxRounds,
                    },
                    intensity: 0,
                });
                (0, logger_1.log)('ROOM', 'new-series-started', { room: room.id });
            }
            else {
                (0, logger_1.log)('ROOM', 'new-series-waiting', { room: room.id });
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
                series: {
                    currentRound: room.series.currentRound,
                    maxRounds: room.series.maxRounds,
                    wins: { ...room.series.wins },
                    seriesOver: room.series.seriesOver,
                    roundResults: [...room.series.roundResults],
                },
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
                        // Record current round as forfeited
                        (0, room_manager_1.recordRoundResult)(forfeited, winnerMark, forfeited.intensity);
                        // Emit round-over
                        io.to(opponentSocketId).emit('round-over', {
                            round: forfeited.series.currentRound,
                            winner: winnerMark,
                            board: forfeited.board,
                            finalIntensity: forfeited.intensity,
                            series: {
                                wins: { ...forfeited.series.wins },
                                currentRound: forfeited.series.currentRound,
                                maxRounds: forfeited.series.maxRounds,
                                seriesOver: true,
                                roundResults: [...forfeited.series.roundResults],
                            },
                            nextRoundIn: null,
                        });
                        // Emit series-over (forfeit ends the whole series)
                        const totalMoves = forfeited.series.roundResults.reduce((sum, r) => sum + r.moves, 0);
                        const peakIntensity = Math.max(...forfeited.series.roundResults.map(r => r.finalIntensity), 0);
                        io.to(opponentSocketId).emit('series-over', {
                            seriesWinner: winnerMark,
                            finalScore: { ...forfeited.series.wins },
                            rounds: forfeited.series.roundResults.map(r => ({ round: r.round, winner: r.winner, moves: r.moves })),
                            totalMoves,
                            peakIntensity,
                        });
                        (0, logger_1.log)('GAME', 'series-over', {
                            room: room.id,
                            winner: winnerMark,
                            reason: 'forfeit',
                            score: `${forfeited.series.wins.X}-${forfeited.series.wins.O}`,
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
        SERIES_NOT_FINISHED: 'Series is not finished',
        ROUND_TRANSITION: 'Round is transitioning',
    };
    return messages[code] || 'An unknown error occurred';
}
