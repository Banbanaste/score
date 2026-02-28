export type Mark = 'X' | 'O';
export type Cell = Mark | null;
export type Board = Cell[];  // length 9

export interface Move {
  cell: number;       // 0–8
  mark: Mark;
  timestamp: number;
  intensity: number;  // intensity AFTER this move
}

export interface PlayerIdentity {
  mark: Mark;
  socketId: string | null;  // null when disconnected
  connected: boolean;
}

export interface GameRoom {
  id: string;                               // 6-char room code (nanoid)
  players: Record<string, PlayerIdentity>;  // keyed by session token
  board: Board;                             // 9-cell array
  currentTurn: Mark;
  status: 'waiting' | 'active' | 'finished';
  winner: Mark | 'draw' | null;
  intensity: number;                        // 0.0–1.0
  moveHistory: Move[];
  createdAt: number;
  rematchRequests: Set<string>;             // player tokens who requested rematch
}

export interface WinResult {
  winner: Mark;
  winningCells: number[];
}

export type GameResult = WinResult | { winner: 'draw'; winningCells?: undefined };

export function createEmptyBoard(): Board {
  return Array(9).fill(null);
}

export function toggleTurn(turn: Mark): Mark {
  return turn === 'X' ? 'O' : 'X';
}
