import type { Board, Mark, SeriesState, MoraleState } from '@/game/types';
import { countImminentWins, isDrawForced } from './intensity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function opponent(mark: Mark): Mark {
  return mark === 'X' ? 'O' : 'X';
}

// ---------------------------------------------------------------------------
// Board-Level Morale
// ---------------------------------------------------------------------------

/**
 * Evaluate positional advantage from center and corner control.
 * Returns a value clamped to [-0.10, +0.10].
 */
export function positionStrength(board: Board, mark: Mark): number {
  const opp = opponent(mark);
  let score = 0;

  // Center control
  if (board[4] === mark) score += 0.05;
  else if (board[4] === opp) score -= 0.05;

  // Corner control (cells 0, 2, 6, 8)
  const corners = [0, 2, 6, 8];
  const myCorners = corners.filter(i => board[i] === mark).length;
  const oppCorners = corners.filter(i => board[i] === opp).length;
  score += (myCorners - oppCorners) * 0.025;

  return clamp(score, -0.10, 0.10);
}

/**
 * Compute board-level morale for a single player.
 * Combines threat advantage, turn agency, defensive pressure,
 * position strength, and forced-draw deflation.
 * Clamped to [-1, +1].
 */
export function computePlayerBoardMorale(
  mark: Mark,
  myThreats: number,
  oppThreats: number,
  board: Board,
  currentTurn: Mark,
): number {
  let morale = 0;

  // Threat advantage (dominant factor)
  morale += (myThreats - oppThreats) * 0.35;

  // Turn agency
  morale += currentTurn === mark ? 0.10 : -0.10;

  // Defensive pressure
  if (oppThreats > 0 && myThreats === 0) morale -= 0.30;

  // Position strength
  morale += positionStrength(board, mark);

  // Forced draw deflation
  if (isDrawForced(board)) morale -= 0.15;

  return clamp(morale, -1, 1);
}

/**
 * Compute board-level morale for both players.
 */
export function computeBoardMorale(board: Board, currentTurn: Mark): MoraleState {
  const xThreats = countImminentWins(board, 'X');
  const oThreats = countImminentWins(board, 'O');

  const xMorale = computePlayerBoardMorale('X', xThreats, oThreats, board, currentTurn);
  const oMorale = computePlayerBoardMorale('O', oThreats, xThreats, board, currentTurn);

  return { X: xMorale, O: oMorale };
}

// ---------------------------------------------------------------------------
// Series-Level Morale
// ---------------------------------------------------------------------------

/**
 * Momentum from the last round result, amplified by streaks.
 * Clamped to [-0.25, +0.25].
 */
export function computeMomentum(
  mark: Mark,
  series: SeriesState,
  lastRoundWinner: Mark | 'draw' | null,
): number {
  if (!lastRoundWinner || lastRoundWinner === 'draw') return 0;

  // Base momentum from last round
  let momentum = lastRoundWinner === mark ? 0.15 : -0.15;

  // Streak amplifier: check last 2 results
  const results = series.roundResults;
  if (results.length >= 2) {
    const last2 = results.slice(-2);
    const streak = last2.every(r => r.winner === mark);
    const lossStreak = last2.every(r => r.winner !== mark && r.winner !== 'draw');

    if (streak) momentum += 0.10;
    if (lossStreak) momentum -= 0.10;
  }

  return clamp(momentum, -0.25, 0.25);
}

/**
 * Match-point morale boost or pressure.
 * Returns a value in {-0.30, 0, +0.10, +0.30}.
 */
export function computeMatchPointMorale(mark: Mark, series: SeriesState): number {
  const opp = opponent(mark);
  const myWins = series.wins[mark];
  const oppWins = series.wins[opp];

  if (myWins === 2 && oppWins === 2) return 0.10;  // Both at match point
  if (myWins === 2) return 0.30;                     // I'm at match point
  if (oppWins === 2) return -0.30;                   // They're at match point
  return 0;
}

/**
 * Comeback potential for a player who is behind in the series.
 * Returns 0.00, +0.10, or +0.15.
 */
export function computeComebackPotential(mark: Mark, series: SeriesState): number {
  const opp = opponent(mark);
  const myWins = series.wins[mark];
  const oppWins = series.wins[opp];
  const roundsLeft = series.maxRounds - series.roundResults.length;

  // Behind but can still win
  if (myWins < oppWins && myWins + roundsLeft >= 3) {
    return 0.10;
  }
  // Behind and must win every remaining round (underdog energy)
  if (myWins < oppWins && (3 - myWins) === roundsLeft) {
    return 0.15;
  }
  return 0;
}

/**
 * Compute series-level morale for a single player.
 * Combines series lead, momentum, match point, and comeback potential.
 * Clamped to [-1, +1].
 */
export function computePlayerSeriesMorale(
  mark: Mark,
  series: SeriesState,
  lastRoundWinner: Mark | 'draw' | null,
): number {
  const opp = opponent(mark);
  const myWins = series.wins[mark];
  const oppWins = series.wins[opp];

  // Series lead
  let morale = (myWins - oppWins) * 0.20;

  // Momentum
  morale += computeMomentum(mark, series, lastRoundWinner);

  // Match point
  morale += computeMatchPointMorale(mark, series);

  // Comeback potential
  morale += computeComebackPotential(mark, series);

  return clamp(morale, -1, 1);
}

/**
 * Compute series-level morale for both players.
 */
export function computeSeriesMorale(
  series: SeriesState,
  lastRoundWinner: Mark | 'draw' | null,
): MoraleState {
  const xMorale = computePlayerSeriesMorale('X', series, lastRoundWinner);
  const oMorale = computePlayerSeriesMorale('O', series, lastRoundWinner);
  return { X: xMorale, O: oMorale };
}

// ---------------------------------------------------------------------------
// Combined Morale (main entry point)
// ---------------------------------------------------------------------------

/**
 * Compute final morale for both players by blending
 * board-level (60%) and series-level (40%) morale.
 * Clamped to [-1, +1].
 */
export function computeMorale(
  board: Board,
  currentTurn: Mark,
  series: SeriesState,
  lastRoundWinner: Mark | 'draw' | null,
): MoraleState {
  const boardMorale = computeBoardMorale(board, currentTurn);
  const seriesMorale = computeSeriesMorale(series, lastRoundWinner);

  return {
    X: clamp(boardMorale.X * 0.6 + seriesMorale.X * 0.4, -1, 1),
    O: clamp(boardMorale.O * 0.6 + seriesMorale.O * 0.4, -1, 1),
  };
}
