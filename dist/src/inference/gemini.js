"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIntensity = getIntensity;
const genai_1 = require("@google/genai");
const intensity_1 = require("./intensity");
const morale_1 = require("./morale");
const logger_1 = require("../game/logger");
const SYSTEM_PROMPT = `You are a game-state analyzer for Tic-Tac-Toe.
Analyze the board and return a JSON object with the following fields:
- 'intensity' (float, 0.0 to 1.0): the current tension/drama of the game state
- 'morale_X' (float, -1.0 to +1.0): player X's emotional state
- 'morale_O' (float, -1.0 to +1.0): player O's emotional state

Intensity scoring guidelines:
- 0.0-0.2: Opening moves, no threats, no strategic positioning yet
- 0.2-0.4: Early positioning, center or corner control established
- 0.4-0.6: Developing threats, one player building toward a line
- 0.6-0.8: Imminent threat, one player one move from winning, opponent must block
- 0.8-1.0: Critical state. Fork detected (two winning paths), forced outcome, or decisive final move

Morale guidelines (morale_X, morale_O):
- Positive values (+0.1 to +1.0): confident, dominant, in control
- Negative values (-1.0 to -0.1): pressured, desperate, on the back foot
- Near zero: neutral, balanced position
Factors to consider for morale:
- Threat advantage: having more winning paths than the opponent boosts morale
- Turn control: having the current turn gives a slight morale edge
- Series lead: leading the series increases confidence
- Momentum: winning the last round or being on a streak amplifies morale

Series-level amplification:
- Later rounds in the series are more tense than early rounds
- A tied series (e.g. 2-2) dramatically increases tension
- A player facing elimination (opponent at match point) raises stakes
- Consider both board AND series context together`;
function buildPrompt(board, currentTurn, moveNumber, series, lastRoundWinner = null) {
    const boardStr = JSON.stringify(board);
    let prompt = `Board: ${boardStr}\nCurrent turn: ${currentTurn}\nMove number: ${moveNumber}`;
    prompt += `\nRound: ${series.currentRound} of ${series.maxRounds}`;
    prompt += `\nSeries score: X ${series.wins.X} — O ${series.wins.O}`;
    const winsToClinh = 3;
    if (series.wins.X === winsToClinh - 1 && series.wins.O === winsToClinh - 1) {
        prompt += `\nMatch point: Both players (next win clinches the series)`;
    }
    else if (series.wins.X === winsToClinh - 1) {
        prompt += `\nMatch point: X (needs 1 more win)`;
    }
    else if (series.wins.O === winsToClinh - 1) {
        prompt += `\nMatch point: O (needs 1 more win)`;
    }
    if (lastRoundWinner) {
        prompt += `\nLast round winner: ${lastRoundWinner}`;
    }
    // Threat counts for morale context
    const xThreats = (0, intensity_1.countImminentWins)(board, 'X');
    const oThreats = (0, intensity_1.countImminentWins)(board, 'O');
    prompt += `\nX threats: ${xThreats}, O threats: ${oThreats}`;
    return prompt;
}
function createTimeout(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), ms));
}
async function geminiAnalyze(board, currentTurn, moveNumber, series, lastRoundWinner = null) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
        throw new Error('GEMINI_API_KEY not set');
    const elapsed = (0, logger_1.timer)();
    (0, logger_1.log)('INFER', 'gemini-request', { model: 'gemini-2.5-flash-lite', move: moveNumber });
    const ai = new genai_1.GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: buildPrompt(board, currentTurn, moveNumber, series, lastRoundWinner),
        config: {
            responseMimeType: 'application/json',
            systemInstruction: SYSTEM_PROMPT,
        },
    });
    const text = response.text;
    if (!text)
        throw new Error('Empty Gemini response');
    const parsed = JSON.parse(text);
    (0, logger_1.log)('INFER', 'gemini-response', {
        move: moveNumber,
        raw: parsed.intensity,
        ms: elapsed(),
    });
    return parsed;
}
async function getIntensity(board, currentTurn, moveNumber, series, lastRoundWinner = null) {
    const elapsed = (0, logger_1.timer)();
    const timeoutMs = Number(process.env.INFERENCE_TIMEOUT) || 3000;
    try {
        const result = await Promise.race([
            geminiAnalyze(board, currentTurn, moveNumber, series, lastRoundWinner),
            createTimeout(timeoutMs),
        ]);
        const raw = typeof result.intensity === 'number' ? result.intensity : NaN;
        if (isNaN(raw))
            throw new Error('Invalid intensity from Gemini');
        const clamped = Math.max(0, Math.min(1, raw));
        const pressure = (0, intensity_1.computeSeriesPressure)(series);
        // Parse morale from Gemini response; fall back to heuristic computation
        let morale;
        if (typeof result.morale_X === 'number' && !isNaN(result.morale_X) &&
            typeof result.morale_O === 'number' && !isNaN(result.morale_O)) {
            morale = {
                X: Math.max(-1, Math.min(1, result.morale_X)),
                O: Math.max(-1, Math.min(1, result.morale_O)),
            };
        }
        else {
            morale = (0, morale_1.computeMorale)(board, currentTurn, series, lastRoundWinner);
        }
        (0, logger_1.log)('INFER', 'pipeline-complete', {
            source: 'gemini',
            value: clamped.toFixed(2),
            raw: raw.toFixed(2),
            move: moveNumber,
            seriesPressure: pressure.toFixed(2),
            moraleX: morale.X.toFixed(2),
            moraleO: morale.O.toFixed(2),
            ms: elapsed(),
        });
        return { value: clamped, source: 'gemini', seriesPressure: pressure, morale };
    }
    catch (err) {
        const heuristic = (0, intensity_1.analyzeIntensity)(board, currentTurn);
        const pressure = (0, intensity_1.computeSeriesPressure)(series);
        const amplified = Math.min(1, heuristic * (1 + pressure));
        const morale = (0, morale_1.computeMorale)(board, currentTurn, series, lastRoundWinner);
        (0, logger_1.logError)('INFER', 'gemini-fallback', err, {
            source: 'heuristic',
            value: amplified.toFixed(2),
            rawHeuristic: heuristic.toFixed(2),
            seriesPressure: pressure.toFixed(2),
            moraleX: morale.X.toFixed(2),
            moraleO: morale.O.toFixed(2),
            move: moveNumber,
            timeoutMs,
            ms: elapsed(),
        });
        return { value: amplified, source: 'heuristic', seriesPressure: pressure, morale };
    }
}
