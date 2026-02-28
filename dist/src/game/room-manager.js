"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRoom = createRoom;
exports.joinRoom = joinRoom;
exports.getRoom = getRoom;
exports.getRoomBySocket = getRoomBySocket;
exports.getPlayerMark = getPlayerMark;
exports.disconnectPlayer = disconnectPlayer;
exports.reconnectPlayer = reconnectPlayer;
exports.setDisconnectTimer = setDisconnectTimer;
exports.requestRematch = requestRematch;
exports.forfeitRoom = forfeitRoom;
exports.deleteRoom = deleteRoom;
exports.startCleanupInterval = startCleanupInterval;
const crypto_1 = require("crypto");
const nanoid_1 = require("nanoid");
const types_1 = require("./types");
const logger_1 = require("./logger");
const rooms = new Map();
// Reverse lookup: socketId -> { roomId, playerToken }
const socketToRoom = new Map();
// Disconnect timers: playerToken -> NodeJS.Timeout
const disconnectTimers = new Map();
function generateToken() {
    return (0, crypto_1.randomBytes)(16).toString('hex');
}
function generateRoomCode() {
    return (0, nanoid_1.nanoid)(6);
}
function createRoom(socketId) {
    const roomId = generateRoomCode();
    const playerToken = generateToken();
    const room = {
        id: roomId,
        players: {
            [playerToken]: { mark: 'X', socketId, connected: true },
        },
        board: (0, types_1.createEmptyBoard)(),
        currentTurn: 'X',
        status: 'waiting',
        winner: null,
        intensity: 0,
        moveHistory: [],
        createdAt: Date.now(),
        rematchRequests: new Set(),
    };
    rooms.set(roomId, room);
    socketToRoom.set(socketId, { roomId, playerToken });
    return { room, playerToken };
}
function joinRoom(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room)
        return { error: 'ROOM_NOT_FOUND' };
    if (room.status !== 'waiting')
        return { error: 'ROOM_FULL' };
    const playerCount = Object.keys(room.players).length;
    if (playerCount >= 2)
        return { error: 'ROOM_FULL' };
    const playerToken = generateToken();
    room.players[playerToken] = { mark: 'O', socketId, connected: true };
    room.status = 'active';
    socketToRoom.set(socketId, { roomId, playerToken });
    return { room, playerToken };
}
function getRoom(roomId) {
    return rooms.get(roomId);
}
function getRoomBySocket(socketId) {
    const mapping = socketToRoom.get(socketId);
    if (!mapping)
        return undefined;
    const room = rooms.get(mapping.roomId);
    if (!room)
        return undefined;
    return { room, playerToken: mapping.playerToken };
}
function getPlayerMark(room, playerToken) {
    return room.players[playerToken]?.mark;
}
function disconnectPlayer(socketId) {
    const mapping = socketToRoom.get(socketId);
    if (!mapping)
        return undefined;
    const room = rooms.get(mapping.roomId);
    if (!room)
        return undefined;
    const player = room.players[mapping.playerToken];
    if (!player)
        return undefined;
    player.socketId = null;
    player.connected = false;
    socketToRoom.delete(socketId);
    return { room, disconnectedMark: player.mark };
}
function reconnectPlayer(roomId, playerToken, newSocketId) {
    const room = rooms.get(roomId);
    if (!room)
        return { error: 'ROOM_NOT_FOUND' };
    const player = room.players[playerToken];
    if (!player)
        return { error: 'INVALID_TOKEN' };
    // Cancel disconnect timer if active
    const activeTimer = disconnectTimers.get(playerToken);
    if (activeTimer) {
        clearTimeout(activeTimer);
        disconnectTimers.delete(playerToken);
        (0, logger_1.log)('ROOM', 'forfeit-timer-cancelled', { room: roomId, mark: player.mark });
    }
    player.socketId = newSocketId;
    player.connected = true;
    socketToRoom.set(newSocketId, { roomId, playerToken });
    return { room, mark: player.mark };
}
function setDisconnectTimer(playerToken, callback) {
    const timeoutMs = Number(process.env.RECONNECT_TIMEOUT) || 30000;
    const timer = setTimeout(() => {
        disconnectTimers.delete(playerToken);
        callback();
    }, timeoutMs);
    disconnectTimers.set(playerToken, timer);
}
function requestRematch(room, playerToken) {
    room.rematchRequests.add(playerToken);
    const playerTokens = Object.keys(room.players);
    if (playerTokens.length === 2 && playerTokens.every(t => room.rematchRequests.has(t))) {
        // Both players requested rematch — reset
        room.board = (0, types_1.createEmptyBoard)();
        room.currentTurn = (0, types_1.toggleTurn)(room.currentTurn); // swap starter
        room.status = 'active';
        room.winner = null;
        room.intensity = 0;
        room.moveHistory = [];
        room.rematchRequests.clear();
        return true; // rematch started
    }
    return false; // waiting for other player
}
function forfeitRoom(roomId, forfeitedToken) {
    const room = rooms.get(roomId);
    if (!room)
        return undefined;
    const forfeited = room.players[forfeitedToken];
    if (!forfeited)
        return undefined;
    room.status = 'finished';
    room.winner = forfeited.mark === 'X' ? 'O' : 'X';
    return room;
}
function deleteRoom(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        // Clean up socket mappings
        for (const [token, player] of Object.entries(room.players)) {
            if (player.socketId) {
                socketToRoom.delete(player.socketId);
            }
            const timer = disconnectTimers.get(token);
            if (timer) {
                clearTimeout(timer);
                disconnectTimers.delete(token);
            }
        }
        rooms.delete(roomId);
    }
}
// Cleanup stale rooms every 60 seconds
function startCleanupInterval() {
    (0, logger_1.log)('CLEAN', 'sweep-scheduled', { intervalMs: 60000 });
    return setInterval(() => {
        const now = Date.now();
        let swept = 0;
        for (const [id, room] of rooms) {
            const allDisconnected = Object.values(room.players).every(p => !p.connected);
            const staleFinished = room.status === 'finished' && (now - room.createdAt > 10 * 60 * 1000);
            if (allDisconnected || staleFinished) {
                const reason = allDisconnected ? 'all-disconnected' : 'stale-finished';
                (0, logger_1.log)('CLEAN', 'room-swept', {
                    room: id,
                    reason,
                    status: room.status,
                    moves: room.moveHistory.length,
                    ageMin: Math.round((now - room.createdAt) / 60000),
                });
                deleteRoom(id);
                swept++;
            }
        }
        (0, logger_1.log)('CLEAN', 'sweep-complete', { rooms: rooms.size, swept });
    }, 60000);
}
