import { Board, Mark, SeriesState } from '@/game/types';

const WIN_LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function countImminentWins(board: Board, mark: Mark): number {
  // Count lines where mark has 2 cells and the third is empty (null)
  let count = 0;
  for (const line of WIN_LINES) {
    const marks = line.filter(i => board[i] === mark).length;
    const empties = line.filter(i => board[i] === null).length;
    if (marks === 2 && empties === 1) count++;
  }
  return count;
}

export function isDrawForced(board: Board): boolean {
  // No winning paths remain for either player
  // A line is "dead" if it contains both X and O
  for (const line of WIN_LINES) {
    const hasX = line.some(i => board[i] === 'X');
    const hasO = line.some(i => board[i] === 'O');
    if (!hasX || !hasO) return false; // at least one line still viable
  }
  return true;
}

export function analyzeIntensity(board: Board, currentTurn: Mark): number {
  let intensity = 0;
  const filled = board.filter(c => c !== null).length;
  intensity += (filled / 9) * 0.15;

  const xThreats = countImminentWins(board, 'X');
  const oThreats = countImminentWins(board, 'O');
  if (xThreats > 0 || oThreats > 0) intensity += 0.35;
  if (xThreats >= 2 || oThreats >= 2) intensity += 0.30; // fork

  if (board[4] !== null) intensity += 0.10;
  if (isDrawForced(board)) intensity -= 0.10;

  return Math.max(0, Math.min(1, intensity));
}

export function computeRoundWeight(series: SeriesState): number {
  // Round 1 = 0.00, Round 5 = 0.20
  return ((series.currentRound - 1) / (series.maxRounds - 1)) * 0.20;
}

export function computeClosenessWeight(series: SeriesState): number {
  const diff = Math.abs(series.wins.X - series.wins.O);
  const totalWins = series.wins.X + series.wins.O;

  if (totalWins === 0) return 0;

  return Math.max(0, 0.30 - (diff * 0.10));
}

export function computeEliminationWeight(series: SeriesState): number {
  const winsToClinh = 3;

  const xNeedsOne = series.wins.X === winsToClinh - 1; // X is at 2 wins
  const oNeedsOne = series.wins.O === winsToClinh - 1; // O is at 2 wins

  if (xNeedsOne && oNeedsOne) return 0.30; // Both at match point
  if (xNeedsOne || oNeedsOne) return 0.20; // One player at match point
  return 0;
}

export function computeSeriesPressure(series: SeriesState): number {
  const roundWeight = computeRoundWeight(series);
  const closenessWeight = computeClosenessWeight(series);
  const eliminationWeight = computeEliminationWeight(series);

  return Math.min(0.80, roundWeight + closenessWeight + eliminationWeight);
}
