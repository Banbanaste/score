# Bounded Context: Inference

Intensity analysis domain — Gemini integration, heuristic fallback, scoring rules, and pipeline orchestration.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Intensity** | Numeric score (0.0–1.0) representing the current tension/drama of the game state |
| **Threat** | Two marks in a win line with the third cell empty — one move from winning |
| **Fork** | A player has 2+ simultaneous threats — opponent cannot block both |
| **Heuristic Analysis** | Local, synchronous rule-based scoring (zero external dependencies) |
| **Gemini Analysis** | LLM-based contextual scoring via Google Gemini API |
| **Fallback** | Automatic switch to heuristic when Gemini fails or times out |

## Value Objects

### IntensityScore

```typescript
interface IntensityScore {
  value: number;                       // 0.0–1.0, always clamped
  source: 'gemini' | 'heuristic';     // which analyzer produced the score
  timestamp: number;                   // Date.now()
}
```

The `source` field enables debugging and analytics — allows tracking how often Gemini succeeds vs falls back to heuristic.

### BoardSnapshot (Input)

```typescript
interface BoardSnapshot {
  board: (null | 'X' | 'O')[];
  currentTurn: 'X' | 'O';
  moveNumber: number;
}
```

Immutable snapshot of the board state passed to analyzers.

## Services

### GeminiAnalyzer (Async)

Calls the Google Gemini API for contextual board analysis.

**Configuration:**
- Model: `gemini-3-flash-preview`
- SDK: `@google/genai` (`GoogleGenAI` client)
- Auth: `GEMINI_API_KEY` environment variable
- Response format: `application/json` via `responseMimeType`
- Timeout: 3 seconds (configurable via `INFERENCE_TIMEOUT`)

**Prompt structure:**
```
System: You are a game-state analyzer for Tic-Tac-Toe.
        Analyze the board and return a JSON object with a
        single field 'intensity' (0.0 to 1.0) representing
        the current tension/drama of the game state.

User:   Board: [null,'X',null,'O','X',null,null,null,null]
        Current turn: O
        Move number: 3

Response: { "intensity": 0.65 }
```

**SDK usage:**
```typescript
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function geminiAnalyze(snapshot: BoardSnapshot): Promise<{ intensity: number }> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: buildPrompt(snapshot),
    config: { responseMimeType: "application/json" },
  });
  return JSON.parse(response.text);
}
```

### HeuristicAnalyzer (Sync)

Pure function — no external dependencies, deterministic, zero-latency.

**Factors:**

| Factor | Weight | Logic |
|--------|--------|-------|
| Board Fill | +0.15 | `(filledCells / 9) * 0.15` — tension rises as the board fills |
| Imminent Win | +0.35 | Any player has 2-in-a-line with third cell empty |
| Fork Detection | +0.30 | A player has 2+ simultaneous threats |
| Center Control | +0.10 | Center cell (index 4) is occupied |
| Forced Draw | -0.10 | No winning paths remain for either player |

```typescript
function analyzeIntensity(board: Board, currentTurn: Mark): number {
  let intensity = 0;
  const filled = board.filter(c => c !== null).length;
  intensity += (filled / 9) * 0.15;

  const xThreats = countImminentWins(board, 'X');
  const oThreats = countImminentWins(board, 'O');
  if (xThreats > 0 || oThreats > 0) intensity += 0.35;
  if (xThreats >= 2 || oThreats >= 2) intensity += 0.30;  // fork

  if (board[4] !== null) intensity += 0.10;
  if (isDrawForced(board)) intensity -= 0.10;

  return Math.max(0, Math.min(1, intensity));
}
```

## Intensity Scoring Guidelines

These guidelines are provided to the Gemini model in the system prompt:

| Range | Description |
|-------|-------------|
| 0.0–0.2 | Opening moves, no threats, no strategic positioning yet |
| 0.2–0.4 | Early positioning, center or corner control established |
| 0.4–0.6 | Developing threats, one player building toward a line |
| 0.6–0.8 | Imminent threat — one player one move from winning, opponent must block |
| 0.8–1.0 | Critical state — fork detected, forced outcome, or decisive final move |

## Pipeline Orchestration

The pipeline attempts Gemini first, validates the response, and falls back to heuristic on any failure:

```typescript
async function getIntensity(snapshot: BoardSnapshot): Promise<IntensityScore> {
  try {
    const result = await Promise.race([
      geminiAnalyze(snapshot),
      timeout(Number(process.env.INFERENCE_TIMEOUT) || 3000),
    ]);
    const raw = typeof result.intensity === 'number' ? result.intensity : NaN;
    if (isNaN(raw)) throw new Error('Invalid intensity from Gemini');
    return {
      value: Math.max(0, Math.min(1, raw)),
      source: 'gemini',
      timestamp: Date.now(),
    };
  } catch {
    return {
      value: analyzeIntensity(snapshot.board, snapshot.currentTurn),
      source: 'heuristic',
      timestamp: Date.now(),
    };
  }
}
```

**Key guarantees:**
- Never throws — always returns a valid IntensityScore
- Never blocks longer than the timeout duration
- Validates and clamps Gemini output (may return out-of-range or malformed JSON)

## Business Rules

1. Intensity MUST be available for every move — pipeline never throws, never blocks indefinitely
2. Gemini responses MUST be validated (type check + clamp to 0.0–1.0)
3. Heuristic is the deterministic fallback — same board always produces the same score
4. Intensity is computed AFTER the move is placed but BEFORE win/draw is checked
5. Both the numeric intensity and its source are stored in the move history

## Dependencies

- **Game Context** — reads board state (Board, Mark types)
- No dependency on Room or Communication contexts
