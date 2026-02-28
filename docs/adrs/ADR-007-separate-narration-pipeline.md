# ADR-007: Separate Narration Pipeline

**Status:** Accepted
**Date:** 2026-02-28

## Context

The server already runs two independent background pipelines after each move: intensity scoring (Gemini + heuristic fallback) and morale calculation. The new narrator system needs to call Gemini with a different system prompt and richer context to produce short-form commentary text. The question is whether narration should be combined with an existing pipeline or run independently.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Combined single Gemini call** (intensity + narration in one prompt) | One API call instead of two; lower cost per move | Conflates two concerns in one prompt — harder to tune independently; single failure kills both outputs; response parsing becomes fragile (two fields instead of one); different timeout requirements (intensity needs 3s, narration can tolerate 5s) |
| **Post-processing from intensity result** (derive narration from the intensity score and board state locally) | No additional API call; deterministic | Narration quality would be poor — heuristic text generation cannot match LLM commentary; loses the contextual awareness that makes narration feel alive |
| **Separate parallel Gemini call** (independent pipeline with own prompt, timeout, and failure handling) | Each pipeline has its own system prompt optimized for its task; independent failure isolation — narration failure never affects intensity; different timeouts (3s vs 5s); can be disabled independently via `NARRATION_ENABLED` | Additional Gemini API call per move (cost increase); slightly higher total server load |

## Decision

Run narration as an **independent parallel Gemini call** with its own system prompt, 5-second timeout, and failure isolation.

```
make-move
  ├── emit move-made (instant, 0ms)
  ├── getIntensity()   background (existing, ~500ms, 3s timeout)
  └── getNarration()   background (NEW, ~1-2s, 5s timeout)
```

Each pipeline is fire-and-forget (`.then()` pattern). A narration failure is logged and silently dropped — the game continues with no commentary for that move. An intensity failure falls back to heuristic scoring as before. Neither pipeline blocks the other.

The narration pipeline has its own:
- **System prompt** — FIFA-style commentator personality (distinct from the intensity analyzer prompt)
- **Timeout** — 5 seconds (configurable via `NARRATION_TIMEOUT`), longer than intensity's 3 seconds because narration is less urgent
- **Kill switch** — `NARRATION_ENABLED=false` disables the entire pipeline without touching intensity

## Consequences

**Positive:**
- Failure isolation — a narration timeout or error never degrades intensity scoring or game flow
- Independent tuning — narration prompt can evolve without risking intensity accuracy
- Independent timeouts — narration tolerates longer latency since it is purely cosmetic
- Clean kill switch — narration can be disabled entirely for debugging or cost control
- Consistent pattern — follows the same fire-and-forget background call pattern as intensity and morale

**Negative:**
- Two Gemini API calls per move instead of one (max 9 moves per round, cost is still minimal with `gemini-3-flash-preview`)
- Narration receives a stale intensity value (the intensity from the previous move, since the current move's intensity is computed in parallel) — acceptable because the tone mapping only needs an approximate range
- Slightly higher server load per move due to the additional outbound API call
