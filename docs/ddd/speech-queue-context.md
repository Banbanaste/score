# Bounded Context: Speech Queue

Client-side TTS playback management — speech queuing, stale narration handling, tone-mapped delivery, and voice selection. Decoupled from the narration source: accepts `NarrationEvent` objects regardless of how they were generated.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Speech Queue** | Ordered list of pending narration events waiting to be spoken |
| **Utterance** | A single `SpeechSynthesisUtterance` object being spoken or queued by the Web Speech API |
| **Stale Narration** | A queued narration event whose `moveNumber` is older than the most recently received event — should be dropped |
| **Speaking** | The queue is currently voicing an utterance — no new utterance should start until it finishes |
| **Tone Mapping** | Converting a `NarrationTone` value into TTS rate and pitch parameters |
| **Voice** | A `SpeechSynthesisVoice` selected from the browser's available voices |

## Entities

### SpeechQueue

The central entity managing TTS playback. Maintains an ordered list of pending narration events and a speaking flag to prevent overlap.

```typescript
// Implemented as refs in the useNarrator hook
interface SpeechQueueState {
  queue: NarrationEvent[];   // Ordered pending narrations
  speaking: boolean;         // True when an utterance is in progress
  enabled: boolean;          // User preference — TTS on/off
  volume: number;            // 0.0–1.0
  voice: SpeechSynthesisVoice | null;  // Selected browser voice
}
```

**Invariants:**
- At most one utterance is speaking at any time (`speaking` flag)
- Queue items are ordered by arrival time (FIFO)
- No item in the queue has a `moveNumber` older than the most recently enqueued event
- Volume is always 0.0–1.0

**Operations:**
- `enqueue(event)` — drop stale items, push event, trigger processing
- `processNext()` — if not speaking and queue is non-empty, dequeue and speak
- `cancel()` — clear queue, stop current utterance via `speechSynthesis.cancel()`

## Value Objects

### ToneParameters (Immutable)

Rate and pitch values derived from a `NarrationTone`. Applied to each `SpeechSynthesisUtterance`.

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

### NarratorOptions (Immutable)

User-facing configuration for the narrator feature.

```typescript
interface NarratorOptions {
  enabled: boolean;    // TTS audio on/off
  volume: number;      // 0.0–1.0
  voice?: string;      // Preferred SpeechSynthesis voice name
}
```

Persisted in `localStorage`. The toggle button cycles through states: narration enabled (text + audio), narration muted (text only, no audio), narration disabled (no text, no audio).

## Domain Services

### useNarrator(options: NarratorOptions)

React hook that owns the speech queue lifecycle. Returns `speak` and `cancel` functions.

**Responsibilities:**
- Maintain the speech queue as a ref
- Accept incoming `NarrationEvent` objects via `speak(event)`
- Filter stale narrations on enqueue
- Create `SpeechSynthesisUtterance` with tone-mapped rate/pitch
- Process queue items sequentially (one utterance at a time)
- Handle `onend` and `onerror` callbacks to advance the queue

### selectVoice(): SpeechSynthesisVoice | null

Pure function that selects the best available TTS voice from the browser's voice list.

**Priority order:**
1. Google US English (best quality on Chrome)
2. Any English-language voice
3. First available voice
4. `null` (speech will use browser default)

```typescript
function selectVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => v.name.includes('Google US English'))
    || voices.find(v => v.lang.startsWith('en'))
    || voices[0]
    || null;
}
```

## Stale Narration Rules

When a new `NarrationEvent` is enqueued:

1. **Filter the queue** — remove all queued (not yet speaking) events with `moveNumber` less than the new event's `moveNumber`
2. **Currently speaking utterance** — let it finish. Interrupting mid-speech sounds bad.
3. **New event is queued** — plays after the current utterance (if any) completes

This ensures that if the game advances faster than TTS can speak, old narration is silently dropped rather than creating a growing backlog of stale commentary.

## Business Rules

1. **No overlapping speech** — at most one utterance speaks at any time. The queue serializes playback.
2. **Stale narration is dropped** — queued events with `moveNumber` older than the newest arrival are removed before they speak.
3. **Current speech is never interrupted** — even if stale, a currently-speaking utterance plays to completion. Cutting off mid-word sounds broken.
4. **Tone maps to rate and pitch** — every utterance has its TTS parameters set from the tone before speaking.
5. **Errors advance the queue** — if `onerror` fires on an utterance, the queue moves to the next item instead of stalling.
6. **User gesture required** — browsers require a user interaction before allowing `speechSynthesis.speak()`. The narrator toggle button provides this gesture.
7. **Decoupled from source** — the speech queue accepts `NarrationEvent` objects and does not know or care whether they came from Gemini, a fallback, or a mock. This enables drop-in TTS engine replacement.

## Dependencies

- **Narration Context** — consumes `NarrationEvent`, `NarrationTone` types
- **Web Speech API** — browser-provided `speechSynthesis` and `SpeechSynthesisUtterance` globals
- No dependency on Game, Room, Inference, or Communication contexts (fully decoupled via the `NarrationEvent` interface)
