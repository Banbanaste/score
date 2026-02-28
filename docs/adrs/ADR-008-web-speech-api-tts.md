# ADR-008: Web Speech API for Text-to-Speech

**Status:** Accepted
**Date:** 2026-02-28

## Context

The narrator system generates short text commentary on the server and emits it to clients via WebSocket. The client needs to voice this text aloud to create the sports commentator experience. A text-to-speech engine is required, and the choice affects latency, cost, dependency count, and offline capability.

The hackathon timeline demands a zero-setup, zero-cost solution that works immediately in modern browsers.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Google Cloud TTS** | High-quality voices, multiple languages, SSML support | Requires API key, network round-trip for every utterance, billing setup, adds server-side TTS endpoint or client-side SDK |
| **ElevenLabs** | Best-in-class voice quality, emotional range, streaming | Requires API key, paid service, significant integration effort, network dependency for every utterance |
| **No TTS (text only)** | Zero complexity, works everywhere | Loses the core commentator experience — reading subtitles is fundamentally different from hearing commentary |
| **Web Speech API** (`speechSynthesis`) | Built into all modern browsers, zero cost, zero dependencies, works offline, instant playback (no network round-trip) | Voice quality varies by OS/browser; limited voice selection; no SSML; robotic compared to cloud services |

## Decision

Use the **browser's built-in Web Speech API** (`window.speechSynthesis`) for all text-to-speech playback.

The server emits only text in the `narration-update` event. The client's `useNarrator` hook creates `SpeechSynthesisUtterance` objects, maps tone to rate/pitch parameters, and manages a queue to prevent overlapping speech.

```typescript
const utterance = new SpeechSynthesisUtterance(event.text);
utterance.rate = TONE_RATES[event.tone];    // 0.9–1.1
utterance.pitch = TONE_PITCHES[event.tone]; // 1.0–1.2
utterance.volume = options.volume;
speechSynthesis.speak(utterance);
```

### Why This Works for Hackathon

1. **Zero setup** — no API keys, no billing, no server-side TTS endpoint
2. **Zero latency** — speech starts immediately from local engine (no network round-trip)
3. **Zero cost** — unlimited utterances at no charge
4. **Offline capable** — works without internet after the page loads
5. **Swappable** — the server emits text only, so upgrading to Google Cloud TTS or ElevenLabs requires changes only in the client `useNarrator` hook

### Voice Selection Strategy

Prefer a natural-sounding English voice with commentator feel:

```typescript
function selectVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => v.name.includes('Google US English'))
    || voices.find(v => v.lang.startsWith('en'))
    || voices[0]
    || null;
}
```

## Consequences

**Positive:**
- Zero dependencies — no external service, no API key, no billing
- Instant playback — no network round-trip between receiving narration text and hearing speech
- Works offline after initial page load
- TTS engine is entirely client-side — server remains a pure text emitter
- Drop-in upgradeable — replacing `speechSynthesis.speak()` with a cloud TTS call is a localized change in one hook

**Negative:**
- Voice quality varies significantly across operating systems and browsers (macOS voices are decent, Linux voices are poor, Windows varies)
- Limited control over prosody — no SSML, no fine-grained emphasis or pauses
- Some browsers require a user gesture before first speech (handled by the narrator toggle button)
- No consistent voice across platforms — the same game sounds different on different devices
- `speechSynthesis.getVoices()` loads asynchronously and may return empty on first call (requires `voiceschanged` event listener)
