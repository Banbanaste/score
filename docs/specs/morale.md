# Morale System Specification

**Per-Player Emotional State Tracking with Asymmetric Intensity**

Version 1.0 — February 2026 | Hackathon Build Spec | Engineering

---

## 1. Overview

Morale is a per-player score (-1.0 to +1.0) representing the emotional state of each player at any point in a game. While intensity measures how dramatic the game state is objectively, morale captures the subjective experience — the same board position feels completely different depending on which side of it you're on.

Morale is computed after every move alongside intensity. Both players receive both morale values (no privacy — seeing your opponent's confidence or despair is part of the experience).

### 1.1 Intensity vs Morale

| | Intensity | Morale |
|---|---|---|
| Perspective | Objective — the game state | Subjective — each player's feeling |
| Symmetry | Same for both players | Different per player, often inverse |
| Range | 0.0 to 1.0 (calm → chaotic) | -1.0 to +1.0 (despair → elation) |
| Question | "How dramatic is this moment?" | "How is this player feeling?" |
| Drives | Shared visual effects, music tempo | Per-player visual energy, music tone |

### 1.2 Morale Scale

| Range | Label | Description |
|-------|-------|-------------|
| -1.0 to -0.7 | Despair | About to lose, behind in series, on losing streak |
| -0.7 to -0.3 | Pressured | Defending, behind, forced to react |
| -0.3 to +0.3 | Neutral | Even position, balanced game, early moves |
| +0.3 to +0.7 | Confident | Ahead, building threats, controlling the board |
| +0.7 to +1.0 | Dominant | Fork created, series lead, winning streak |

### 1.3 Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Range | -1.0 to +1.0 | Sign naturally encodes winning/losing. Zero is neutral. |
| Symmetry | Not strictly inverse | A drawn position can have both near zero. A clinch can have both at extremes. |
| Board vs series weight | 60% board, 40% series | Board is immediate and visceral. Series is background hum. |
| Privacy | None — both players see both morale values | Seeing opponent's despair or confidence adds to the experience. |
| Gemini integration | Ask for both morale values in response | Gemini reasons about asymmetry holistically. Heuristic computes locally. |

### 1.4 Scope

This spec covers the morale computation pipeline, data model additions, updated event payloads, Gemini prompt changes, and UI requirements. It builds on top of the existing intensity system and the series/rounds system defined in `rounds.md`.

---

## 2. Data Model

### 2.1 New Types

```typescript
interface MoraleState {
  X: number;   // -1.0 to +1.0
  O: number;   // -1.0 to +1.0
}

interface MoraleResult {
  morale: MoraleState;
  source: 'gemini' | 'heuristic';
}
```

### 2.2 GameRoom Additions

```typescript
interface GameRoom {
  // ... existing fields ...
  morale: MoraleState;              // Current morale for both players
}
```

Initial value: `{ X: 0, O: 0 }`.

### 2.3 Move Record Addition

```typescript
interface Move {
  cell: number;
  mark: Mark;
  timestamp: number;
  intensity: number;
  morale: MoraleState;             // Morale snapshot AFTER this move
}
```

### 2.4 RoundResult Addition

```typescript
interface RoundResult {
  round: number;
  winner: Mark | 'draw';
  moves: number;
  duration: number;
  finalIntensity: number;
  finalMorale: MoraleState;        // Morale at round end
}
```

---

## 3. Morale Computation

Morale is the sum of board-level factors (60% weight) and series-level factors (40% weight), clamped to [-1.0, +1.0].

```typescript
function computeMorale(
  board: Board,
  currentTurn: Mark,
  series: SeriesState,
  lastRoundWinner: Mark | 'draw' | null
): MoraleState {
  const boardMorale = computeBoardMorale(board, currentTurn);
  const seriesMorale = computeSeriesMorale(series, lastRoundWinner);

  return {
    X: clamp(boardMorale.X * 0.6 + seriesMorale.X * 0.4, -1, 1),
    O: clamp(boardMorale.O * 0.6 + seriesMorale.O * 0.4, -1, 1),
  };
}
```

### 3.1 Board-Level Morale

Board morale captures the immediate tactical situation. It's computed from the perspective of each player.

```typescript
function computeBoardMorale(board: Board, currentTurn: Mark): MoraleState {
  const xThreats = countImminentWins(board, 'X');
  const oThreats = countImminentWins(board, 'O');

  const xMorale = computePlayerBoardMorale('X', xThreats, oThreats, board, currentTurn);
  const oMorale = computePlayerBoardMorale('O', oThreats, xThreats, board, currentTurn);

  return { X: xMorale, O: oMorale };
}
```

#### 3.1.1 Per-Player Board Factors

For a given player with mark `M`, opponent mark `Opp`:

| Factor | Range | Calculation | Description |
|--------|-------|-------------|-------------|
| Threat advantage | -0.70 to +0.70 | `(myThreats - oppThreats) * 0.35` | Each imminent win is worth 0.35. Having a fork (+2) vs opponent having nothing = +0.70. |
| Turn agency | -0.10 to +0.10 | `currentTurn === M ? +0.10 : -0.10` | It's your turn = you have control. Opponent's turn = you're waiting. |
| Defensive pressure | -0.30 to 0.00 | `oppThreats > 0 && myThreats === 0 ? -0.30 : 0` | You must block with no counter-threat = pure defensive pressure. |
| Position strength | -0.10 to +0.10 | See below | Center and corner control advantage. |
| Forced draw | -0.15 to -0.15 | `isDrawForced(board) ? -0.15 : 0` | No winning paths for either player. Both players feel deflated. |

**Position strength calculation:**

```typescript
function positionStrength(board: Board, mark: Mark): number {
  const opp = mark === 'X' ? 'O' : 'X';
  let score = 0;

  // Center control
  if (board[4] === mark) score += 0.05;
  else if (board[4] === opp) score -= 0.05;

  // Corner control (0, 2, 6, 8)
  const corners = [0, 2, 6, 8];
  const myCorners = corners.filter(i => board[i] === mark).length;
  const oppCorners = corners.filter(i => board[i] === opp).length;
  score += (myCorners - oppCorners) * 0.025;

  return Math.max(-0.10, Math.min(0.10, score));
}
```

#### 3.1.2 Board Morale Bounds

The sum of all board factors is clamped to [-1.0, +1.0]:

```typescript
function computePlayerBoardMorale(
  mark: Mark,
  myThreats: number,
  oppThreats: number,
  board: Board,
  currentTurn: Mark
): number {
  let morale = 0;

  // Threat advantage (dominant factor)
  morale += (myThreats - oppThreats) * 0.35;

  // Turn agency
  morale += currentTurn === mark ? 0.10 : -0.10;

  // Defensive pressure
  if (oppThreats > 0 && myThreats === 0) morale -= 0.30;

  // Position strength
  morale += positionStrength(board, mark);

  // Forced draw deflation
  if (isDrawForced(board)) morale -= 0.15;

  return Math.max(-1, Math.min(1, morale));
}
```

#### 3.1.3 Board Morale Examples

| Board State | X Threats | O Threats | X Board Morale | O Board Morale |
|-------------|-----------|-----------|----------------|----------------|
| Empty board, X's turn | 0 | 0 | +0.10 | -0.10 |
| X controls center | 0 | 0 | +0.15 | -0.15 |
| X has 1 threat, O's turn | 1 | 0 | +0.25 | -0.55 |
| X has fork (2 threats) | 2 | 0 | +0.60 | -0.90 |
| Both have 1 threat, X's turn | 1 | 1 | +0.10 | -0.10 |
| Forced draw | 0 | 0 | -0.15 | -0.15 |

### 3.2 Series-Level Morale

Series morale captures the meta-game emotional state. It shifts based on series standing, recent results, and momentum.

```typescript
function computeSeriesMorale(
  series: SeriesState,
  lastRoundWinner: Mark | 'draw' | null
): MoraleState {
  const xMorale = computePlayerSeriesMorale('X', series, lastRoundWinner);
  const oMorale = computePlayerSeriesMorale('O', series, lastRoundWinner);
  return { X: xMorale, O: oMorale };
}
```

#### 3.2.1 Per-Player Series Factors

| Factor | Range | Calculation | Description |
|--------|-------|-------------|-------------|
| Series lead | -0.40 to +0.40 | `(myWins - oppWins) * 0.20` | Each win lead is worth 0.20 morale. Up 2-0 = +0.40. Down 0-2 = -0.40. |
| Momentum | -0.25 to +0.25 | See below | Won last round = boost, lost = deflation. Streak amplifies. |
| Match point | -0.30 to +0.30 | See below | You're at match point = hungry. Opponent is = pressure. |
| Comeback potential | 0.00 to +0.15 | See below | Behind but still mathematically alive = hope. |

**Momentum calculation:**

```typescript
function computeMomentum(mark: Mark, series: SeriesState, lastRoundWinner: Mark | 'draw' | null): number {
  if (!lastRoundWinner || lastRoundWinner === 'draw') return 0;

  // Base momentum from last round
  let momentum = lastRoundWinner === mark ? 0.15 : -0.15;

  // Streak amplifier: check last 2 results
  const results = series.roundResults;
  if (results.length >= 2) {
    const last2 = results.slice(-2);
    const streak = last2.every(r => r.winner === mark);
    const lossStreak = last2.every(r => r.winner !== mark && r.winner !== 'draw');

    if (streak) momentum += 0.10;       // On a 2+ win streak
    if (lossStreak) momentum -= 0.10;   // On a 2+ loss streak
  }

  return Math.max(-0.25, Math.min(0.25, momentum));
}
```

**Match point calculation:**

```typescript
function computeMatchPointMorale(mark: Mark, series: SeriesState): number {
  const opp = mark === 'X' ? 'O' : 'X';
  const myWins = series.wins[mark];
  const oppWins = series.wins[opp];

  if (myWins === 2 && oppWins === 2) return 0.10;  // Both at match point — tense but even
  if (myWins === 2) return 0.30;                     // I'm at match point — hungry
  if (oppWins === 2) return -0.30;                   // They're at match point — pressure
  return 0;
}
```

**Comeback potential:**

```typescript
function computeComebackPotential(mark: Mark, series: SeriesState): number {
  const opp = mark === 'X' ? 'O' : 'X';
  const myWins = series.wins[mark];
  const oppWins = series.wins[opp];
  const roundsLeft = series.maxRounds - series.roundResults.length;

  // Behind but can still win
  if (myWins < oppWins && myWins + roundsLeft >= 3) {
    return 0.10;
  }
  // Behind and it's getting desperate (need to win every remaining round)
  if (myWins < oppWins && (3 - myWins) === roundsLeft) {
    return 0.15;  // Underdog energy
  }
  return 0;
}
```

#### 3.2.2 Series Morale Examples

| Series State | Last Round | X Series Morale | O Series Morale |
|-------------|------------|-----------------|-----------------|
| R1, 0-0 | — | 0.00 | 0.00 |
| R2, X won R1 (1-0) | X won | +0.35 | -0.35 |
| R3, 1-1 (each won 1) | O won | -0.15 | +0.15 |
| R4, X won last 2 (2-0) | X won | +0.65 | -0.55 |
| R5, 2-2 | O won | -0.05 | +0.25 |
| R4, 2-1 X leads, X won last | X won | +0.55 | -0.45 |

### 3.3 Combined Morale Examples

Board morale (60%) + Series morale (40%):

| Scenario | Board X | Board O | Series X | Series O | **Final X** | **Final O** |
|----------|---------|---------|----------|----------|-------------|-------------|
| R1, opening, X's turn | +0.10 | -0.10 | 0.00 | 0.00 | **+0.06** | **-0.06** |
| R1, X has fork | +0.60 | -0.90 | 0.00 | 0.00 | **+0.36** | **-0.54** |
| R3, 1-1, X must block | -0.55 | +0.25 | -0.15 | +0.15 | **-0.39** | **+0.21** |
| R5, 2-2, X creates fork | +0.60 | -0.90 | -0.05 | +0.25 | **+0.34** | **-0.44** |
| R4, X up 2-0, cruising | +0.15 | -0.15 | +0.65 | -0.55 | **+0.35** | **-0.31** |
| R5, 2-2, O wins! | — | — | -0.05 | +0.25 | — | — |

---

## 4. Gemini Integration

### 4.1 Updated Response Format

Gemini now returns morale alongside intensity:

```json
{
  "intensity": 0.75,
  "morale_X": 0.45,
  "morale_O": -0.30
}
```

### 4.2 Updated System Prompt

Append to the existing system prompt:

```
Additionally, return 'morale_X' and 'morale_O' fields (-1.0 to 1.0) representing
each player's emotional state. Morale is subjective and asymmetric:

Morale scale:
- -1.0 to -0.7: Despair — about to lose, behind in series, spiraling
- -0.7 to -0.3: Pressured — forced to defend, behind, reactive
- -0.3 to +0.3: Neutral — even position, balanced, early game
- +0.3 to +0.7: Confident — building threats, ahead, in control
- +0.7 to +1.0: Dominant — fork created, series lead, unstoppable

Consider:
- Who has threats vs who must defend
- Whose turn it is (agency vs waiting)
- Series standing, momentum, and match point scenarios
- A player can be losing the board but winning the series (mixed feelings)

Return: { "intensity": number, "morale_X": number, "morale_O": number }
```

### 4.3 Extended User Prompt

Add morale-relevant context to the prompt:

```
Board: [null,'X',null,'O','X',null,null,null,null]
Current turn: O
Move number: 3
Round: 4 of 5
Series score: X 2 — O 1
Match point: X (needs 1 more win)
Last round winner: X
X threats: 1, O threats: 0
```

The threat count gives Gemini explicit tactical context to reason about asymmetry.

### 4.4 Validation and Fallback

- Validate `morale_X` and `morale_O` are numbers in [-1, 1]
- Clamp out-of-range values
- If either field is missing or invalid, fall back to heuristic morale
- Series pressure multiplier is NOT applied to morale (it's already factored into the series morale component)

### 4.5 Heuristic Fallback

When Gemini is unavailable, compute morale locally using the `computeMorale()` function from Section 3. This ensures morale is always available regardless of API status.

---

## 5. Updated IntensityResult

The combined result type now includes morale:

```typescript
interface IntensityResult {
  value: number;                   // 0.0–1.0 (intensity)
  source: 'gemini' | 'heuristic';
  seriesPressure: number;
  morale: MoraleState;             // NEW — per-player morale
}
```

---

## 6. Updated Event Payloads

### 6.1 `move-made` — add morale

```typescript
{
  board: Board;
  cell: number;
  mark: Mark;
  currentTurn: Mark;
  intensity: number;
  moveNumber: number;
  morale: MoraleState;             // NEW
  series: { currentRound: number; wins: { X: number; O: number } };
}
```

### 6.2 `intensity-update` — add morale

```typescript
{
  intensity: number;
  source: 'gemini' | 'heuristic';
  moveNumber: number;
  seriesPressure: number;
  morale: MoraleState;             // NEW
}
```

### 6.3 `round-over` — add final morale

```typescript
{
  round: number;
  winner: Mark | 'draw';
  winningCells?: number[];
  board: Board;
  finalIntensity: number;
  finalMorale: MoraleState;        // NEW
  series: { ... };
  nextRoundIn: number | null;
}
```

### 6.4 `round-start` — add starting morale

```typescript
{
  round: number;
  board: Board;
  currentTurn: Mark;
  series: { ... };
  intensity: number;
  morale: MoraleState;             // NEW — series-only morale (board is empty)
}
```

At the start of a round, board morale is near zero (empty board). Series morale carries forward — a player who just lost round 4 to go down 1-2 starts round 5 feeling the pressure before any move is made.

### 6.5 `series-over` — add final morale

```typescript
{
  seriesWinner: Mark | null;
  finalScore: { X: number; O: number };
  rounds: RoundResult[];           // Each round now includes finalMorale
  totalMoves: number;
  peakIntensity: number;
  peakMorale: MoraleState;         // NEW — highest morale each player achieved
  finalMorale: MoraleState;        // NEW — morale at series end
}
```

### 6.6 `game-state` — add morale for reconnecting players

```typescript
{
  roomId: string;
  board: Board;
  currentTurn: Mark;
  mark: Mark;
  intensity: number;
  morale: MoraleState;             // NEW
  status: RoomStatus;
  moveHistory: Move[];
  series: SeriesState;
}
```

---

## 7. UI Requirements

### 7.1 Morale Display

Each player should see a morale indicator reflecting their current state. Options:

**Option A — Dual morale bars:**
```
X  [████████░░]  +0.65    Your morale
O  [███░░░░░░░]  -0.40    Opponent morale
```

**Option B — Single contextual indicator (recommended):**
A morale ring or aura around each player's mark indicator. Positive morale = warm glow (gold → green), negative = cool fade (blue → purple → red for despair). The intensity of the glow scales with the absolute morale value.

### 7.2 Morale in Series Scoreboard

The series scoreboard can incorporate morale as visual energy:
- Win dots for a confident player pulse gently
- Win dots for a pressured player dim slightly
- The round indicator could shift color based on morale differential

### 7.3 Round Start Morale

When a new round begins, display a brief morale snapshot:
```
Round 4 of 5
X: Confident (+0.55)   O: Pressured (-0.45)
```
This sets the emotional tone before the first move.

### 7.4 Series Result Morale

The series result screen shows the morale journey:
```
Morale arc:
  R1: X +0.35 / O -0.20  (X confident after win)
  R2: X +0.60 / O -0.55  (X streak, O spiraling)
  R3: X +0.20 / O +0.15  (O clawed back, momentum shift)
  R4: X -0.30 / O +0.45  (O surging, X on defense)
  R5: X -0.80 / O +0.90  (O dominant in clincher)
```

---

## 8. Implementation Checklist

| File | Changes |
|------|---------|
| `src/game/types.ts` | Add `MoraleState` interface, add `morale: MoraleState` to `GameRoom`, `Move`, `RoundResult` |
| `src/inference/morale.ts` | **New file** — `computeMorale()`, `computeBoardMorale()`, `computeSeriesMorale()` and all sub-functions |
| `src/inference/gemini.ts` | Update response parsing to extract `morale_X`/`morale_O`, update `IntensityResult` to include morale, update prompt and system instruction |
| `src/socket/handlers.ts` | Pass morale through all event payloads (`move-made`, `intensity-update`, `round-over`, `round-start`, `series-over`, `game-state`), compute heuristic morale for immediate emit |
| `src/game/room-manager.ts` | Initialize `morale: { X: 0, O: 0 }` in `createRoom()`, reset in `advanceRound()` and `resetSeries()`, store in `recordRoundResult()` |
| `src/app/game/[roomId]/page.tsx` | Add morale state, update all event listeners to read morale, pass to components |
| `src/components/morale-indicator.tsx` | **New component** — per-player morale display |
| `src/components/series-scoreboard.tsx` | Add morale-driven visual energy to win dots |
| `src/components/round-result-overlay.tsx` | Show morale snapshot at round end |
| `src/components/series-result.tsx` | Add morale arc to series summary |

---

*— End of Specification —*
