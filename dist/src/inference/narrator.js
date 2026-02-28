"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineTone = determineTone;
exports.buildNarrationPrompt = buildNarrationPrompt;
exports.getNarration = getNarration;
const genai_1 = require("@google/genai");
const logger_1 = require("../game/logger");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const NARRATION_TIMEOUT = Number(process.env.NARRATION_TIMEOUT) || 5000;
const NARRATION_SYSTEM_PROMPT = `You are a FIFA-style sports commentator for a Tic-Tac-Toe match.

Your job: produce ONE short commentary line for the current game moment.

Rules:
- Maximum 15 words. Shorter is better.
- Professional, neutral, observational tone.
- Build tension naturally as the game intensifies.
- Never give strategic advice ("X should..."). Only observe and react.
- Reference the specific move when relevant ("X takes center", "O blocks the diagonal").
- Acknowledge drama: forks, forced blocks, match point, series clinchers.
- Vary your language. Don't repeat phrases from recent commentary.

Tone guidance based on intensity:
- Low (0.0-0.3): Brief, relaxed. "X opens on the corner." "Quiet start."
- Medium (0.3-0.6): Engaged. "O builds toward the diagonal." "Pressure mounting."
- High (0.6-0.8): Urgent. "X must block! The diagonal is wide open."
- Critical (0.8-1.0): Electric. "A fork! Two paths to victory!" "This is it!"

For round/series events, be dramatic but concise:
- Round win: "X takes the round! Series lead, two to one."
- Series clinch: "And that's the series! O wins it three-two!"
- Match point: "Match point for X. One round from glory."

Return a JSON object: { "narration": "your line here" }`;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function determineTone(intensity) {
    if (intensity >= 0.8)
        return 'explosive';
    if (intensity >= 0.6)
        return 'tense';
    if (intensity >= 0.3)
        return 'building';
    return 'calm';
}
function buildNarrationPrompt(context) {
    const { board, lastMove, moveNumber, currentTurn, intensity, morale, series, previousNarration, trigger, roundWinner, seriesWinner, } = context;
    let prompt = `Board: ${JSON.stringify(board)}`;
    prompt += `\nLast move: cell ${lastMove.cell} by ${lastMove.mark}`;
    prompt += `\nMove number: ${moveNumber} of this round`;
    prompt += `\nCurrent turn: ${currentTurn}`;
    prompt += `\nIntensity: ${intensity.toFixed(2)}`;
    prompt += `\nMorale: X ${morale.X >= 0 ? '+' : ''}${morale.X.toFixed(2)}, O ${morale.O >= 0 ? '+' : ''}${morale.O.toFixed(2)}`;
    prompt += `\nRound: ${series.currentRound} of ${series.maxRounds}`;
    prompt += `\nSeries score: X ${series.wins.X} — O ${series.wins.O}`;
    // Match point detection
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
    else {
        prompt += `\nMatch point: none`;
    }
    prompt += `\nPrevious narration: ${previousNarration ? `"${previousNarration}"` : 'none'}`;
    prompt += `\nTrigger: ${trigger}`;
    // Event-specific context
    if (roundWinner !== undefined) {
        prompt += `\nRound winner: ${roundWinner}`;
    }
    if (seriesWinner !== undefined && seriesWinner !== null) {
        prompt += `\nSeries winner: ${seriesWinner}`;
    }
    return prompt;
}
function createTimeout(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Narration timeout')), ms));
}
// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function getNarration(context) {
    // Kill switch
    if (process.env.NARRATION_ENABLED === 'false') {
        return null;
    }
    const elapsed = (0, logger_1.timer)();
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey)
            throw new Error('GEMINI_API_KEY not set');
        const userPrompt = buildNarrationPrompt(context);
        (0, logger_1.log)('NARR', 'request', {
            model: 'gemini-2.5-flash-lite',
            move: context.moveNumber,
            trigger: context.trigger,
            intensity: context.intensity.toFixed(2),
        });
        const ai = new genai_1.GoogleGenAI({ apiKey });
        const response = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: userPrompt,
                config: {
                    responseMimeType: 'application/json',
                    systemInstruction: NARRATION_SYSTEM_PROMPT,
                },
            }),
            createTimeout(NARRATION_TIMEOUT),
        ]);
        const text = response.text;
        if (!text)
            throw new Error('Empty Gemini narration response');
        const parsed = JSON.parse(text);
        const narration = parsed.narration;
        if (typeof narration !== 'string' || narration.trim().length === 0) {
            throw new Error('Invalid narration: expected non-empty string');
        }
        const tone = determineTone(context.intensity);
        const event = {
            text: narration.trim(),
            moveNumber: context.moveNumber,
            trigger: context.trigger,
            intensity: context.intensity,
            tone,
        };
        (0, logger_1.log)('NARR', 'response', {
            move: context.moveNumber,
            trigger: context.trigger,
            tone,
            text: event.text,
            ms: elapsed(),
        });
        return event;
    }
    catch (err) {
        (0, logger_1.logError)('NARR', 'failed', err, {
            move: context.moveNumber,
            trigger: context.trigger,
            ms: elapsed(),
        });
        return null;
    }
}
