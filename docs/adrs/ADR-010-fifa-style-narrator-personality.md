# ADR-010: FIFA-Style Neutral Commentary Personality

**Status:** Accepted
**Date:** 2026-02-28

## Context

The narrator needs a consistent voice and personality that works across all game states — from quiet openings to dramatic series clinchers. The personality choice affects the system prompt, the expected output style, and the overall player experience. It must feel natural for a tic-tac-toe game while still being engaging.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Dramatic wrestling announcer** ("AND X SLAMS DOWN ON CENTER! THE CROWD GOES WILD!") | High energy, entertaining, memorable | Exhausting over multiple rounds; tone doesn't scale down well for routine moves; feels absurd for tic-tac-toe; hard to produce calm commentary |
| **Retro arcade style** ("PLAYER ONE — EXCELLENT MOVE! BONUS ROUND!") | Fits the retro-space aesthetic; nostalgic | Limited vocabulary; repetitive phrasing; doesn't handle tension arcs well; novelty wears off quickly |
| **Dry chess analysis** ("Knight to e4. A standard Sicilian Defense response.") | Intellectual, precise, authoritative | Too dry for a real-time game experience; no emotional arc; tic-tac-toe lacks the depth to sustain analytical commentary |
| **FIFA-style neutral sports commentator** | Professional, observational, builds tension naturally; scales from "quiet start" to "that clinches it!"; familiar broadcast cadence; works at all intensity levels | Less distinctive than extreme personalities; may feel generic |

## Decision

Adopt a **FIFA-style neutral sports commentator** personality for all narration.

### Personality Traits

| Trait | Description | Example |
|-------|-------------|---------|
| **Observational** | Describes what happened, never prescribes what should happen | "X takes center" not "X should take center" |
| **Tension-aware** | Language intensity matches the game state naturally | "Quiet start." vs "Critical block!" |
| **Drama-acknowledging** | Recognizes dramatic moments without melodrama | "A fork! Two paths to victory." |
| **Concise** | Maximum 15 words per line; shorter is always better | "O blocks the diagonal." |
| **Varied** | Never repeats phrases from recent commentary | Uses `previousNarration` context to avoid repetition |
| **Neutral** | No player favoritism; equal treatment of X and O | Celebrates and acknowledges both players equally |

### Tone Scaling

The commentator naturally adapts language to the four tone levels:

- **Calm** (0.0–0.3): "X opens on the corner." "Quiet start."
- **Building** (0.3–0.6): "O builds toward the diagonal." "Pressure mounting."
- **Tense** (0.6–0.8): "X must block! The diagonal is wide open."
- **Explosive** (0.8–1.0): "A fork! Two paths to victory!" "This is it!"

### System Prompt Enforcement

The personality is encoded in the Gemini system prompt with explicit rules:
- Never give strategic advice
- Only observe and react
- Reference specific moves when relevant
- Acknowledge drama without melodrama
- Vary language across consecutive narrations

## Consequences

**Positive:**
- Scales naturally from calm to explosive — the same voice works at all intensity levels
- Professional tone avoids cringe — players won't mute the narrator after two rounds
- Familiar broadcast cadence makes the experience feel polished
- Observational style prevents the narrator from appearing to favor either player
- Concise style (max 15 words) pairs well with Web Speech API limitations (short utterances sound better than long ones)

**Negative:**
- Less memorable than an extreme personality — won't generate "wow, the announcer is hilarious" moments
- May feel slightly generic for players expecting something more distinctive
- FIFA style assumes familiarity with sports broadcasting conventions — some players may not have that reference frame
- The personality is entirely prompt-dependent — Gemini may occasionally drift from the intended tone (mitigated by the explicit rules in the system prompt)
