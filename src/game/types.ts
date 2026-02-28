export type Mark = 'X' | 'O';
export type Cell = Mark | null;
export type Board = Cell[];  // length 9

export type RoomStatus = 'waiting' | 'active' | 'round-over' | 'finished';

export interface MoraleState {
  X: number;   // -1.0 to +1.0
  O: number;   // -1.0 to +1.0
}

export interface Move {
  cell: number;       // 0–8
  mark: Mark;
  timestamp: number;
  intensity: number;  // intensity AFTER this move
  morale: MoraleState; // per-player morale AFTER this move
}

export interface PlayerIdentity {
  mark: Mark;
  socketId: string | null;  // null when disconnected
  connected: boolean;
}

export interface RoundResult {
  round: number;           // 1-indexed
  winner: Mark | 'draw';
  moves: number;
  duration: number;        // ms
  finalIntensity: number;
  finalMorale: MoraleState;
}

export interface SeriesState {
  maxRounds: number;              // Always 5
  currentRound: number;           // 1-indexed (1–5)
  roundResults: RoundResult[];
  wins: { X: number; O: number };
  seriesOver: boolean;
  seriesWinner: Mark | null;
}

export interface GameRoom {
  id: string;                               // 6-char room code (nanoid)
  players: Record<string, PlayerIdentity>;  // keyed by session token
  board: Board;                             // 9-cell array
  currentTurn: Mark;
  status: RoomStatus;
  winner: Mark | 'draw' | null;
  intensity: number;                        // 0.0–1.0
  morale: MoraleState;                      // per-player morale (-1.0 to +1.0)
  moveHistory: Move[];
  createdAt: number;
  roundStartedAt: number;                   // timestamp when current round began
  rematchRequests: Set<string>;             // player tokens who requested new series
  series: SeriesState;
  lastNarration: string | null;       // previous narration text (for variety)
}

// --- Narrator types ---

export type NarrationTrigger =
  | 'move'
  | 'round-over'
  | 'round-start'
  | 'series-over'
  | 'match-point';

export type NarrationTone =
  | 'calm'
  | 'building'
  | 'tense'
  | 'explosive';

export interface NarrationEvent {
  text: string;
  moveNumber: number;
  trigger: NarrationTrigger;
  intensity: number;
  tone: NarrationTone;
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

export function createInitialSeries(): SeriesState {
  return {
    maxRounds: 5,
    currentRound: 1,
    roundResults: [],
    wins: { X: 0, O: 0 },
    seriesOver: false,
    seriesWinner: null,
  };
}

export function roundStartingTurn(round: number): Mark {
  return round % 2 === 1 ? 'X' : 'O';
}
