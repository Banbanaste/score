# ADR-003: Dual-Mode Inference Pipeline

**Status:** Accepted
**Date:** 2026-02-28

## Context

After every validated move, the server computes an intensity score (0.0–1.0) representing the tension level of the current game state. Clients use this score to drive adaptive music crossfading. The score must be available for every move without exception — the game loop cannot block on an external API failure.

Google Gemini provides richer contextual analysis than pure heuristics, but introduces latency, cost, and failure modes (network errors, rate limits, malformed responses).

## Decision

Implement a **race-based dual-mode pipeline**:

1. **Primary:** Call Gemini API (`gemini-3-flash-preview` via `@google/genai` SDK) with a 3-second timeout
2. **Fallback:** If Gemini fails or times out, use a synchronous heuristic analyzer
3. **Validation:** Clamp and type-check Gemini responses before using them

```typescript
async function getIntensity(board, currentTurn, moveNumber): Promise<number> {
  try {
    const result = await Promise.race([
      geminiAnalyze(board, currentTurn, moveNumber),
      timeout(3000),
    ]);
    const raw = typeof result.intensity === 'number' ? result.intensity : NaN;
    if (isNaN(raw)) throw new Error('Invalid intensity');
    return Math.max(0, Math.min(1, raw));
  } catch {
    return analyzeIntensity(board, currentTurn); // heuristic fallback
  }
}
```

### Heuristic Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| Board Fill | 0.15 | `filledCells / 9` — tension rises as board fills |
| Imminent Win | 0.35 | Two-in-a-line with third cell empty |
| Fork Detection | 0.30 | Player has 2+ simultaneous threats |
| Center Control | 0.10 | Center cell (index 4) occupied |
| Forced Draw | -0.10 | No winning paths remain for either player |

## Consequences

**Positive:**
- Game loop never blocks on external service failure
- Gemini provides nuanced contextual scores when available
- Heuristic is deterministic and zero-latency (same board = same score)
- Response validation prevents out-of-range values from reaching clients

**Negative:**
- Intensity may differ between Gemini and heuristic for the same board state (non-deterministic across modes)
- Requires `GEMINI_API_KEY` environment variable
- API costs (minimal for tic-tac-toe: max 9 calls per game, `gemini-3-flash-preview` is low-cost)
- 3-second timeout adds latency when Gemini is slow but would eventually respond
