# ADR-009: Adaptive Narration with Constant Frequency

**Status:** Accepted
**Date:** 2026-02-28

## Context

The narrator system must decide how often to generate commentary. In a tic-tac-toe match with at most 9 moves per round and 5 rounds per series, there are relatively few game events. The question is whether every move deserves narration or whether the system should selectively narrate only significant moments.

A sports broadcast with unpredictable silence feels broken. Viewers expect continuous commentary — even if the commentator only says "quiet passage of play" during lulls. The commentary should always be present but should scale its energy to match the game state.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Key-moments-only** (narrate only when intensity > threshold or structural events occur) | Fewer API calls; narration carries more weight when it appears | Silence between narrations feels like a bug; players wonder if the narrator is broken; hard to pick the right threshold |
| **Probability-based skip** (narrate with probability proportional to intensity — low intensity = low chance) | Reduces API calls during calm phases; still narrates some routine moves | Non-deterministic — same board state may or may not produce narration; confusing UX; silence still feels broken when it occurs |
| **Constant frequency, adaptive content** (narrate every move, vary commentary length and intensity) | No silence gaps — commentary is always present; matches sports broadcast expectations; length naturally adapts to game tension | More API calls (one per move); requires the model to produce both short quips and longer lines |

## Decision

Narrate **every move** (constant frequency) but vary the commentary length and intensity based on the current game state.

### Length Adaptation

| Intensity Range | Tone | Target Length | Example |
|----------------|------|--------------|---------|
| 0.0–0.3 | `calm` | 5–8 words | "X opens on the corner." |
| 0.3–0.6 | `building` | 8–12 words | "O builds toward the diagonal. Pressure mounting." |
| 0.6–0.8 | `tense` | 10–15 words | "X must block! The diagonal is wide open." |
| 0.8–1.0 | `explosive` | 10–15 words | "A fork! Two paths to victory! This is it!" |

The system prompt instructs Gemini to adjust verbosity based on the intensity value provided in the user prompt. Low-intensity moves get brief, relaxed acknowledgments. High-intensity moves get urgent, punchy lines. The maximum is always 15 words — brevity is enforced regardless of intensity.

### Structural Events

Beyond regular moves, the narrator also fires for structural game events (round-over, round-start, series-over, match-point). These always produce narration regardless of intensity because they are inherently significant moments.

## Consequences

**Positive:**
- No awkward silence — the commentary stream is continuous, matching sports broadcast conventions
- Low-intensity moves still get acknowledged, confirming the narrator is active and engaged
- Intensity-driven length creates a natural arc — calm openings build to tense finales
- Simple mental model — every move produces exactly one narration event

**Negative:**
- One Gemini API call per move (max 9 per round, 45 per series) — cost is acceptable for `gemini-3-flash-preview`
- Low-intensity narration may feel repetitive ("X plays corner." "O takes edge.") — mitigated by the `previousNarration` field in the prompt, which instructs the model to avoid repeating phrases
- Rapid moves can queue up narration faster than TTS can speak — mitigated by the client-side speech queue with stale narration dropping
