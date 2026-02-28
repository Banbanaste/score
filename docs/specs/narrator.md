# Narrator System Specification

**Real-Time AI Commentary with Adaptive Intensity and Text-to-Speech**

Version 1.0 — February 2026 | Hackathon Build Spec | Engineering

---

## 1. Overview

The narrator is a FIFA-style sports commentator that provides real-time, short-form commentary on every game event. It runs as a parallel background pipeline — like intensity and morale, narration never blocks gameplay.

The narrator receives the full game context (board, moves, intensity, morale, series state) and produces a single short line of commentary. The client receives the text via WebSocket and voices it using the Web Speech API.

### 1.1 Design Principles

| Principle | Description |
|-----------|-------------|
| Non-blocking | Narration is fired in the background. Moves emit instantly. |
| Adaptive length | Low intensity = short quip (5-8 words). High intensity = punchy line (10-15 words). |
| Always present | Every move gets narration. Silence feels broken. |
| FIFA-neutral | Professional, observational, clean. Not over-the-top, not boring. |
| TTS-agnostic | Server emits text. Client decides how to voice it. Swappable. |
| Short | Maximum 15 words per line. Brevity is everything. |

### 1.2 Personality

The narrator is a neutral sports commentator in the style of a FIFA match caller:

- Observational, not prescriptive ("X takes center" not "X should take center")
- Builds tension naturally ("O must block... and does!")
- Acknowledges drama without melodrama ("A fork! Two paths to victory.")
- Brief acknowledgment on routine moves ("X opens on the corner.")
- Escalates language with intensity ("Critical block!" vs "O plays edge.")
- Celebrates decisive moments ("That clinches the series!")

### 1.3 Scope

This spec covers the narration text generation pipeline, the WebSocket event contract, client-side speech queue, and the UI subtitle display. It does NOT cover advanced TTS services (ElevenLabs, Google Cloud TTS) — those are drop-in upgrades to the client layer.

---

## 2. Data Model

### 2.1 NarrationEvent

```typescript
interface NarrationEvent {
  text: string;              // The commentary line (max 15 words)
  moveNumber: number;        // Which move this narrates (0 for round/series events)
  trigger: NarrationTrigger; // What caused this narration
  intensity: number;         // Current intensity when narration was generated
  tone: NarrationTone;       // Guides TTS pitch/rate
}

type NarrationTrigger =
  | 'move'           // Regular move narration
  | 'round-over'     // Round just ended
  | 'round-start'    // New round beginning
  | 'series-over'    // Series decided
  | 'match-point';   // A player reached match point this move

type NarrationTone =
  | 'calm'           // intensity < 0.3
  | 'building'       // intensity 0.3–0.6
  | 'tense'          // intensity 0.6–0.8
  | 'explosive';     // intensity > 0.8
```

### 2.2 Tone Mapping

The tone guides client-side TTS parameters:

| Tone | Intensity Range | TTS Rate | TTS Pitch | Description |
|------|----------------|----------|-----------|-------------|
| `calm` | 0.0–0.3 | 0.9 | 1.0 | Relaxed, measured delivery |
| `building` | 0.3–0.6 | 1.0 | 1.0 | Normal pace, engaged |
| `tense` | 0.6–0.8 | 1.05 | 1.1 | Slightly faster, higher |
| `explosive` | 0.8–1.0 | 1.1 | 1.2 | Urgent, elevated |

---

## 3. Narration Generation

### 3.1 Pipeline

Narration is a separate Gemini call that runs in parallel with the intensity call:

```
make-move
  ├── emit move-made (instant, 0ms)
  ├── getIntensity() background (existing, ~500ms)
  └── getNarration() background (NEW, ~1-2s)
          ├── build context prompt
          ├── call Gemini
          └── emit 'narration-update' event
```

### 3.2 Narration Timeout

Narration uses a longer timeout than intensity since it's less urgent:

```typescript
const NARRATION_TIMEOUT = Number(process.env.NARRATION_TIMEOUT) || 5000;
```

If the timeout fires, no narration is emitted for that move. The game continues normally.

### 3.3 System Prompt

```
You are a FIFA-style sports commentator for a Tic-Tac-Toe match.

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

Return a JSON object: { "narration": "your line here" }
```

### 3.4 User Prompt

The narrator receives the richest context of any Gemini call:

```
Board: ["X","O",null,"X",null,null,null,null,null]
Last move: cell 3 by X
Move number: 3 of this round
Current turn: O
Intensity: 0.45
Morale: X +0.30, O -0.10
Round: 3 of 5
Series score: X 1 — O 1
Match point: none
Previous narration: "X opens with a corner. Classic."
Trigger: move
```

The `previous narration` field prevents the model from repeating itself.

### 3.5 Context Builder

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
  // For round/series events:
  roundWinner?: Mark | 'draw';
  seriesWinner?: Mark | null;
}
```

### 3.6 Event-Specific Narration

Beyond regular moves, the narrator is invoked for structural game events:

| Event | Trigger | Extra Context |
|-------|---------|---------------|
| Move placed | `'move'` | cell, mark, board |
| Round won/drawn | `'round-over'` | winner, round number, series score after |
| New round starts | `'round-start'` | round number, who goes first, series score |
| Series decided | `'series-over'` | series winner, final score, total rounds |
| Match point reached | `'match-point'` | which player hit match point |

Match point is detected when a player's wins reach 2 (needs 1 more). This triggers a special narration in addition to the move narration.

### 3.7 Gemini Function

```typescript
// src/inference/narrator.ts

export async function getNarration(
  context: NarrationContext
): Promise<NarrationEvent | null> {
  // 1. Build prompt from context
  // 2. Call Gemini with narration system prompt
  // 3. Parse response, extract "narration" field
  // 4. Determine tone from intensity
  // 5. Return NarrationEvent or null on failure
}
```

### 3.8 Tone Determination

```typescript
function determineTone(intensity: number): NarrationTone {
  if (intensity >= 0.8) return 'explosive';
  if (intensity >= 0.6) return 'tense';
  if (intensity >= 0.3) return 'building';
  return 'calm';
}
```

---

## 4. Server Integration

### 4.1 Handler Wiring

In `handlers.ts`, narration fires in the background alongside intensity:

```typescript
// After move is placed and emitted:

// Existing: intensity in background
getIntensity(boardSnapshot, mark, moveNumber, room.series, lastRoundWinner)
  .then(/* ... existing ... */);

// NEW: narration in background
getNarration({
  board: boardSnapshot,
  lastMove: { cell, mark },
  moveNumber,
  currentTurn: room.currentTurn,
  intensity: room.intensity,
  morale: room.morale,
  series: room.series,
  previousNarration: room.lastNarration,
  trigger: 'move',
}).then((narration) => {
  if (narration) {
    room.lastNarration = narration.text;
    io.to(roomId).emit('narration-update', narration);
  }
});
```

### 4.2 GameRoom Addition

```typescript
interface GameRoom {
  // ... existing fields ...
  lastNarration: string | null;  // Previous narration text (for variety)
}
```

Initial value: `null`. Reset on `advanceRound()` and `resetSeries()`.

### 4.3 Event Narration Points

| Game Event | Narration Call | Timing |
|------------|---------------|--------|
| Move placed | `getNarration({ trigger: 'move' })` | In background after emit |
| Round over | `getNarration({ trigger: 'round-over' })` | After `round-over` emit |
| Round start | `getNarration({ trigger: 'round-start' })` | After `round-start` emit |
| Series over | `getNarration({ trigger: 'series-over' })` | After `series-over` emit |
| Match point | `getNarration({ trigger: 'match-point' })` | When `wins[mark] === 2` detected |

Each call is fire-and-forget (`.then()` pattern). Failures are logged and silently dropped.

### 4.4 Match Point Detection

After recording a round result, check if either player just hit match point:

```typescript
if (room.series.wins.X === 2 && previousWinsX < 2) {
  // X just reached match point — fire narration
  getNarration({ ...context, trigger: 'match-point' });
}
// Same for O
```

This fires ONCE when match point is reached, not on every subsequent move.

---

## 5. Socket Event

### 5.1 `narration-update`

Emitted from server to all players in the room:

```typescript
{
  text: string;              // "X takes the center. Bold move."
  moveNumber: number;        // 3 (or 0 for structural events)
  trigger: NarrationTrigger; // 'move' | 'round-over' | etc.
  intensity: number;         // 0.45
  tone: NarrationTone;       // 'building'
}
```

The client uses `moveNumber` to avoid speaking stale narration (if a new move arrives before narration for the previous move, drop the old one).

---

## 6. Client Implementation

### 6.1 Speech Queue

The client maintains a queue to prevent overlapping speech:

```typescript
// src/hooks/use-narrator.ts

interface NarratorOptions {
  enabled: boolean;
  volume: number;       // 0.0 to 1.0
  voice?: string;       // SpeechSynthesis voice name
}

function useNarrator(options: NarratorOptions) {
  const queueRef = useRef<NarrationEvent[]>([]);
  const speakingRef = useRef(false);

  const speak = useCallback((event: NarrationEvent) => {
    if (!options.enabled) return;

    // Drop stale narration (older than current move)
    queueRef.current = queueRef.current.filter(
      e => e.moveNumber >= event.moveNumber
    );

    queueRef.current.push(event);
    processQueue();
  }, [options]);

  const processQueue = useCallback(() => {
    if (speakingRef.current || queueRef.current.length === 0) return;

    const event = queueRef.current.shift()!;
    speakingRef.current = true;

    const utterance = new SpeechSynthesisUtterance(event.text);
    utterance.rate = TONE_RATES[event.tone];
    utterance.pitch = TONE_PITCHES[event.tone];
    utterance.volume = options.volume;

    utterance.onend = () => {
      speakingRef.current = false;
      processQueue();
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      processQueue();
    };

    speechSynthesis.speak(utterance);
  }, [options]);

  return { speak, cancel: () => speechSynthesis.cancel() };
}
```

### 6.2 Stale Narration Handling

If a new move arrives before the previous narration:
1. If the old narration hasn't started speaking yet → **drop it** from the queue
2. If the old narration is currently speaking → **let it finish** (interrupting sounds bad)
3. New narration is queued and plays after

### 6.3 TTS Rate/Pitch Constants

```typescript
const TONE_RATES: Record<NarrationTone, number> = {
  calm: 0.9,
  building: 1.0,
  tense: 1.05,
  explosive: 1.1,
};

const TONE_PITCHES: Record<NarrationTone, number> = {
  calm: 1.0,
  building: 1.0,
  tense: 1.1,
  explosive: 1.2,
};
```

### 6.4 Voice Selection

The Web Speech API provides system voices. Prefer:
1. A male English voice (commentator feel)
2. Fall back to the default system voice
3. Allow user override via settings

```typescript
function selectVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  // Prefer Google US English or similar
  return voices.find(v => v.name.includes('Google US English'))
    || voices.find(v => v.lang.startsWith('en'))
    || voices[0]
    || null;
}
```

---

## 7. UI Requirements

### 7.1 Subtitle Display

Narration text appears as a subtitle overlay at the bottom of the game area:

```
┌────────────────────────────────┐
│                                │
│         [Game Board]           │
│                                │
│   [Intensity] [Morale]         │
│                                │
│  ┌──────────────────────────┐  │
│  │  "X takes the center."   │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

- Text fades in when narration arrives
- Text fades out after 3 seconds or when replaced by new narration
- Font: monospace, slightly smaller than game text
- Color: `text-gray-300` for calm, `text-yellow-300` for tense, `text-red-300` for explosive

### 7.2 Narrator Toggle

A small mute/unmute button for the narrator:
- Default: **on** (narration enabled, TTS enabled)
- Click: toggles TTS audio only (text subtitles always show)
- Long-press or second click: disables narration entirely (no text, no audio)
- Persist preference in `localStorage`

### 7.3 Visual Tone Indicators

The subtitle container subtly reflects the tone:
- `calm`: no border, plain text
- `building`: faint border glow
- `tense`: pulsing border
- `explosive`: bright border flash on arrival

---

## 8. Environment Variables

```env
NARRATION_TIMEOUT=5000     # ms before giving up on Gemini narration
NARRATION_ENABLED=true     # Kill switch for narration pipeline
```

When `NARRATION_ENABLED=false`, no Gemini calls are made for narration. The feature is completely inert.

---

## 9. Implementation Checklist

| File | Changes |
|------|---------|
| `src/game/types.ts` | Add `NarrationEvent`, `NarrationTrigger`, `NarrationTone` types. Add `lastNarration: string \| null` to `GameRoom`. |
| `src/inference/narrator.ts` | **New file** — `getNarration()`, `buildNarrationPrompt()`, `determineTone()`, narration system prompt constant |
| `src/socket/handlers.ts` | Fire `getNarration()` in background on move, round-over, round-start, series-over. Emit `narration-update`. Match point detection. |
| `src/game/room-manager.ts` | Initialize `lastNarration: null` in `createRoom()`. Reset in `advanceRound()` and `resetSeries()`. |
| `src/hooks/use-narrator.ts` | **New file** — `useNarrator()` hook with speech queue, stale handling, voice selection |
| `src/components/narrator-subtitle.tsx` | **New component** — subtitle display with fade, tone coloring |
| `src/app/game/[roomId]/page.tsx` | Add `narration-update` listener, wire `useNarrator` hook, add `<NarratorSubtitle>` component, add toggle button |

---

## 10. Future Upgrades (Out of Scope)

These are NOT part of the hackathon build but the architecture supports them:

| Upgrade | Change Required |
|---------|-----------------|
| Google Cloud TTS | Replace `speechSynthesis.speak()` with API call in `useNarrator` |
| ElevenLabs streaming | Same — swap TTS engine in the hook |
| Two commentators (play-by-play + color) | Add second system prompt, alternate between them |
| Narration history/replay | Store `NarrationEvent[]` on `GameRoom`, emit with `game-state` |
| Player-specific narration | Emit different text per player socket instead of room-wide |
| Streaming text | Use Gemini streaming API, emit partial text chunks |

---

*— End of Specification —*
