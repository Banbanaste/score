import { GoogleGenAI } from '@google/genai';
import type { Board, Mark } from '@/game/types';
import { analyzeIntensity } from './intensity';
import { log, logError, timer } from '@/game/logger';

export interface IntensityResult {
  value: number;
  source: 'gemini' | 'heuristic';
}

const SYSTEM_PROMPT = `You are a game-state analyzer for Tic-Tac-Toe.
Analyze the board and return a JSON object with a single field 'intensity' (0.0 to 1.0) representing the current tension/drama of the game state.

Scoring guidelines:
- 0.0-0.2: Opening moves, no threats, no strategic positioning yet
- 0.2-0.4: Early positioning, center or corner control established
- 0.4-0.6: Developing threats, one player building toward a line
- 0.6-0.8: Imminent threat, one player one move from winning, opponent must block
- 0.8-1.0: Critical state. Fork detected (two winning paths), forced outcome, or decisive final move`;

function buildPrompt(board: Board, currentTurn: Mark, moveNumber: number): string {
  const boardStr = JSON.stringify(board);
  return `Board: ${boardStr}\nCurrent turn: ${currentTurn}\nMove number: ${moveNumber}`;
}

function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini timeout')), ms)
  );
}

async function geminiAnalyze(
  board: Board,
  currentTurn: Mark,
  moveNumber: number
): Promise<{ intensity: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const elapsed = timer();
  log('INFER', 'gemini-request', { model: 'gemini-3-flash-preview', move: moveNumber });

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: buildPrompt(board, currentTurn, moveNumber),
    config: {
      responseMimeType: 'application/json',
      systemInstruction: SYSTEM_PROMPT,
    },
  });

  const text = response.text;
  if (!text) throw new Error('Empty Gemini response');

  const parsed = JSON.parse(text);
  log('INFER', 'gemini-response', {
    move: moveNumber,
    raw: parsed.intensity,
    ms: elapsed(),
  });
  return parsed;
}

export async function getIntensity(
  board: Board,
  currentTurn: Mark,
  moveNumber: number
): Promise<IntensityResult> {
  const elapsed = timer();
  const timeoutMs = Number(process.env.INFERENCE_TIMEOUT) || 3000;

  try {
    const result = await Promise.race([
      geminiAnalyze(board, currentTurn, moveNumber),
      createTimeout(timeoutMs),
    ]);
    const raw = typeof result.intensity === 'number' ? result.intensity : NaN;
    if (isNaN(raw)) throw new Error('Invalid intensity from Gemini');

    const clamped = Math.max(0, Math.min(1, raw));
    log('INFER', 'pipeline-complete', {
      source: 'gemini',
      value: clamped.toFixed(2),
      raw: raw.toFixed(2),
      move: moveNumber,
      ms: elapsed(),
    });
    return { value: clamped, source: 'gemini' };
  } catch (err) {
    const heuristic = analyzeIntensity(board, currentTurn);
    logError('INFER', 'gemini-fallback', err, {
      source: 'heuristic',
      value: heuristic.toFixed(2),
      move: moveNumber,
      timeoutMs,
      ms: elapsed(),
    });
    return { value: heuristic, source: 'heuristic' };
  }
}
