import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { GameRoom, Mark, createEmptyBoard, toggleTurn } from './types';
import { log } from './logger';

const rooms = new Map<string, GameRoom>();

// Reverse lookup: socketId -> { roomId, playerToken }
const socketToRoom = new Map<string, { roomId: string; playerToken: string }>();

// Disconnect timers: playerToken -> NodeJS.Timeout
const disconnectTimers = new Map<string, NodeJS.Timeout>();

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function generateRoomCode(): string {
  return nanoid(6);
}

export function createRoom(socketId: string): { room: GameRoom; playerToken: string } {
  const roomId = generateRoomCode();
  const playerToken = generateToken();
  const room: GameRoom = {
    id: roomId,
    players: {
      [playerToken]: { mark: 'X', socketId, connected: true },
    },
    board: createEmptyBoard(),
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

export function joinRoom(roomId: string, socketId: string): { room: GameRoom; playerToken: string } | { error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'ROOM_NOT_FOUND' };
  if (room.status !== 'waiting') return { error: 'ROOM_FULL' };

  const playerCount = Object.keys(room.players).length;
  if (playerCount >= 2) return { error: 'ROOM_FULL' };

  const playerToken = generateToken();
  room.players[playerToken] = { mark: 'O', socketId, connected: true };
  room.status = 'active';
  socketToRoom.set(socketId, { roomId, playerToken });
  return { room, playerToken };
}

export function getRoom(roomId: string): GameRoom | undefined {
  return rooms.get(roomId);
}

export function getRoomBySocket(socketId: string): { room: GameRoom; playerToken: string } | undefined {
  const mapping = socketToRoom.get(socketId);
  if (!mapping) return undefined;
  const room = rooms.get(mapping.roomId);
  if (!room) return undefined;
  return { room, playerToken: mapping.playerToken };
}

export function getPlayerMark(room: GameRoom, playerToken: string): Mark | undefined {
  return room.players[playerToken]?.mark;
}

export function disconnectPlayer(socketId: string): { room: GameRoom; disconnectedMark: Mark } | undefined {
  const mapping = socketToRoom.get(socketId);
  if (!mapping) return undefined;
  const room = rooms.get(mapping.roomId);
  if (!room) return undefined;

  const player = room.players[mapping.playerToken];
  if (!player) return undefined;

  player.socketId = null;
  player.connected = false;
  socketToRoom.delete(socketId);

  return { room, disconnectedMark: player.mark };
}

export function reconnectPlayer(
  roomId: string,
  playerToken: string,
  newSocketId: string
): { room: GameRoom; mark: Mark } | { error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'ROOM_NOT_FOUND' };

  const player = room.players[playerToken];
  if (!player) return { error: 'INVALID_TOKEN' };

  // Cancel disconnect timer if active
  const activeTimer = disconnectTimers.get(playerToken);
  if (activeTimer) {
    clearTimeout(activeTimer);
    disconnectTimers.delete(playerToken);
    log('ROOM', 'forfeit-timer-cancelled', { room: roomId, mark: player.mark });
  }

  player.socketId = newSocketId;
  player.connected = true;
  socketToRoom.set(newSocketId, { roomId, playerToken });

  return { room, mark: player.mark };
}

export function setDisconnectTimer(playerToken: string, callback: () => void): void {
  const timeoutMs = Number(process.env.RECONNECT_TIMEOUT) || 30000;
  const timer = setTimeout(() => {
    disconnectTimers.delete(playerToken);
    callback();
  }, timeoutMs);
  disconnectTimers.set(playerToken, timer);
}

export function requestRematch(room: GameRoom, playerToken: string): boolean {
  room.rematchRequests.add(playerToken);

  const playerTokens = Object.keys(room.players);
  if (playerTokens.length === 2 && playerTokens.every(t => room.rematchRequests.has(t))) {
    // Both players requested rematch — reset
    room.board = createEmptyBoard();
    room.currentTurn = toggleTurn(room.currentTurn); // swap starter
    room.status = 'active';
    room.winner = null;
    room.intensity = 0;
    room.moveHistory = [];
    room.rematchRequests.clear();
    return true; // rematch started
  }
  return false; // waiting for other player
}

export function forfeitRoom(roomId: string, forfeitedToken: string): GameRoom | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;

  const forfeited = room.players[forfeitedToken];
  if (!forfeited) return undefined;

  room.status = 'finished';
  room.winner = forfeited.mark === 'X' ? 'O' : 'X';
  return room;
}

export function deleteRoom(roomId: string): void {
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
export function startCleanupInterval(): NodeJS.Timeout {
  log('CLEAN', 'sweep-scheduled', { intervalMs: 60000 });

  return setInterval(() => {
    const now = Date.now();
    let swept = 0;
    for (const [id, room] of rooms) {
      const allDisconnected = Object.values(room.players).every(p => !p.connected);
      const staleFinished = room.status === 'finished' && (now - room.createdAt > 10 * 60 * 1000);
      if (allDisconnected || staleFinished) {
        const reason = allDisconnected ? 'all-disconnected' : 'stale-finished';
        log('CLEAN', 'room-swept', {
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
    log('CLEAN', 'sweep-complete', { rooms: rooms.size, swept });
  }, 60_000);
}
