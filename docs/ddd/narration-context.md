# Bounded Context: Narration

The narrator domain — real-time AI commentary generation, tone mapping, and prompt orchestration. A read-only consumer of the Game, Room, and Inference contexts that observes game state but never modifies it.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Narration** | A single short commentary line (max 15 words) describing a game moment |
| **Narration Event** | Typed payload containing narration text, metadata, and tone information |
| **Trigger** | The game event that caused narration to be generated (move, round-over, round-start, series-over, match-point) |
| **Tone** | Intensity-derived classification guiding TTS delivery parameters (calm, building, tense, explosive) |
| **Narration Context** | Full game state snapshot assembled for the Gemini prompt |
| **Previous Narration** | The last narration text, included in the prompt to prevent phrase repetition |
| **Commentary Line** | Synonym for narration text — the actual spoken/displayed string |

## Entities

### NarrationEvent

The primary output of the narration pipeline. Emitted to clients via the `narration-update` WebSocket event.

```typescript
interface NarrationEvent {
  text: string;              // The commentary line (max 15 words)
  moveNumber: number;        // Which move this narrates (0 for structural events)
  trigger: NarrationTrigger; // What caused this narration
  intensity: number;         // Current intensity when narration was generated
  tone: NarrationTone;       // Guides TTS pitch/rate on the client
}
```

**Invariants:**
- `text` is never empty and never exceeds 15 words
- `moveNumber` is 0 for structural events (round-over, round-start, series-over), positive for move events
- `intensity` is always 0.0–1.0 (clamped)
- `tone` is always derived from `intensity` via `determineTone()`

## Value Objects

### NarrationTrigger (Enum)

Identifies the game event that caused narration to fire.

```typescript
type NarrationTrigger =
  | 'move'           // Regular move placed on the board
  | 'round-over'     // Round just ended (win or draw)
  | 'round-start'    // New round beginning
  | 'series-over'    // Series decided (player won best-of-5)
  | 'match-point';   // A player reached match point (2 wins, needs 1 more)
```

Each trigger maps to different context fields in the prompt:
- `move` — includes cell, mark, board state
- `round-over` — includes winner, round number, updated series score
- `round-start` — includes round number, who goes first, series score
- `series-over` — includes series winner, final score, total rounds played
- `match-point` — includes which player reached match point

### NarrationTone (Enum)

Intensity-derived classification that the client uses to set TTS parameters.

```typescript
type NarrationTone =
  | 'calm'       // intensity < 0.3 — relaxed, measured delivery
  | 'building'   // intensity 0.3–0.6 — normal pace, engaged
  | 'tense'      // intensity 0.6–0.8 — slightly faster, higher pitch
  | 'explosive'; // intensity > 0.8 — urgent, elevated
```

**Tone-to-TTS mapping:**

| Tone | Rate | Pitch |
|------|------|-------|
| `calm` | 0.9 | 1.0 |
| `building` | 1.0 | 1.0 |
| `tense` | 1.05 | 1.1 |
| `explosive` | 1.1 | 1.2 |

## Aggregates

### NarrationContext (Input Aggregate)

The full game state snapshot assembled for the Gemini narration prompt. This is a read-only aggregate — it is constructed from other domain contexts but never persists or mutates.

```typescript
interface NarrationContext {
  board: Board;
  lastMove: { cell: number; mark: Mark };
  moveNumber: number;
  currentTurn: Mark;
  intensity: number;
  morale: MoraleState;
  series: SeriesState;
  previousNarration: string | null;
  trigger: NarrationTrigger;
  // For structural events:
  roundWinner?: Mark | 'draw';
  seriesWinner?: Mark | null;
}
```

**Invariants:**
- `board` is a valid 9-cell array
- `lastMove.cell` is 0–8
- `intensity` is 0.0–1.0
- `previousNarration` is null for the first narration in a round, populated thereafter
- `trigger` determines which optional fields (`roundWinner`, `seriesWinner`) are present

## Domain Services

### getNarration(context: NarrationContext): Promise\<NarrationEvent | null\>

The primary domain service. Builds a prompt from the narration context, calls Gemini with the narrator system prompt, parses the response, determines tone, and returns a `NarrationEvent`. Returns `null` on any failure (timeout, parse error, API error).

**Pipeline:**
1. Build user prompt from `NarrationContext` fields
2. Call Gemini with the FIFA commentator system prompt and 5-second timeout
3. Parse JSON response, extract the `narration` field
4. Determine tone from intensity via `determineTone()`
5. Construct and return `NarrationEvent`

**Failure behavior:** Returns `null`. Never throws. Failures are logged and silently dropped. The game continues without narration for that event.

### determineTone(intensity: number): NarrationTone

Pure function mapping intensity to tone classification:

```typescript
function determineTone(intensity: number): NarrationTone {
  if (intensity >= 0.8) return 'explosive';
  if (intensity >= 0.6) return 'tense';
  if (intensity >= 0.3) return 'building';
  return 'calm';
}
```

### buildNarrationPrompt(context: NarrationContext): string

Pure function that assembles the user prompt from the narration context. Formats board state, move information, intensity, morale, series state, previous narration, and trigger into the prompt template consumed by Gemini.

## Business Rules

1. **Read-only consumer** — the narration domain observes game state but never modifies it. No writes to board, room, or series state.
2. **Fire-and-forget** — narration runs in the background. Failures never block or affect the game loop.
3. **Every move gets narration** — constant frequency, adaptive content. Silence is a bug.
4. **Maximum 15 words** — enforced by the system prompt. Brevity is the primary constraint.
5. **No repetition** — `previousNarration` is included in the prompt to prevent the model from reusing phrases.
6. **Tone derives from intensity** — the mapping is deterministic and applied server-side before emitting the event.
7. **Independent timeout** — 5 seconds, separate from intensity's 3-second timeout.
8. **Kill switch** — `NARRATION_ENABLED=false` disables the entire pipeline with zero side effects.

## Dependencies

- **Game Context** — reads Board, Mark types, win/draw state
- **Room Context** — reads series state, morale, player assignments, `lastNarration` field
- **Inference Context** — reads current intensity value
- **Communication Context** — `narration-update` event is defined in the socket event contract
