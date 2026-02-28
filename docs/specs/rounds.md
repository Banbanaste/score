# Series & Rounds System Specification

**Best-of-5 Series with Cumulative Intensity Pressure**

Version 1.0 — February 2026 | Hackathon Build Spec | Engineering

---

## 1. Overview

This document specifies the rounds system that layers a best-of-5 series on top of the existing single-game tic-tac-toe engine. A game room now represents a **series** of up to 5 rounds. The first player to win 3 rounds wins the series. Draws consume a round but award no point to either player.

The key motivation is **intensity compounding**. The existing intensity pipeline scores board-level tension (threats, forks, center control). The rounds system adds a **series pressure** dimension that amplifies board intensity based on how high-stakes the current round is within the series arc. A fork on move 5 of round 1 is interesting. The same fork in a deciding round 5 at 2-2 is electrifying.

### 1.1 Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Format | Best-of-5 (first to 3 wins) | Series can end early — no dead rounds. Creates natural elimination pressure. |
| Draws | Count as played, no point awarded (Option B) | Burns a round without rewarding either player. Adds urgency — "we just wasted a round." |
| Round transition | Auto-start after brief pause | No manual rematch between rounds. Keeps momentum. Rematch moves to the series level. |
| Intensity approach | Dual: feed series context to Gemini + local series multiplier on heuristic | Rich AI reasoning when available, reliable local fallback always. |
| Series reset | Manual "New Series" after series ends | Players opt in to another best-of-5. Room persists. |

### 1.2 Scope

This spec covers the series/rounds layer only: data model additions, lifecycle changes, series pressure intensity formula, updated event contracts, and Gemini prompt changes. The underlying game engine (board, win detection, move validation) is unchanged. The existing server spec (`server.md`) remains the canonical reference for everything not modified here.

---

## 2. Data Model

### 2.1 GameRoom Additions

The `GameRoom` interface gains series-level fields. Existing fields are unchanged.

```typescript
interface GameRoom {
  // ... existing fields (id, players, board, currentTurn, status, winner, intensity, moveHistory, createdAt, rematchRequests) ...

  // ── Series fields (new) ──
  series: SeriesState;
}

interface SeriesState {
  maxRounds: number;              // Always 5
  currentRound: number;           // 1-indexed (1–5)
  roundResults: RoundResult[];    // Completed rounds, ordered
  wins: { X: number; O: number }; // Running series score
  seriesOver: boolean;            // True when a player reaches 3 wins or all rounds played
  seriesWinner: Mark | null;      // Winner of the series, null until decided
}

interface RoundResult {
  round: number;                  // 1-indexed round number
  winner: Mark | 'draw';         // Who won this round
  moves: number;                  // How many moves the round took
  duration: number;               // Round duration in ms
  finalIntensity: number;         // Board intensity at round end
}
```

### 2.2 Room Status Extensions

The existing `status` field gains one new value to handle between-round transitions:

```typescript
type RoomStatus = 'waiting' | 'active' | 'round-over' | 'finished';
```

| Status | Meaning |
|--------|---------|
| `waiting` | Room created, waiting for second player |
| `active` | Round in progress, accepting moves |
| `round-over` | Brief pause between rounds (3 seconds), board frozen |
| `finished` | Series is over (a player won 3, or all rounds played). Awaiting new series or disconnect. |

### 2.3 Initial State

When a room is created, series state is initialized:

```typescript
series: {
  maxRounds: 5,
  currentRound: 1,
  roundResults: [],
  wins: { X: 0, O: 0 },
  seriesOver: false,
  seriesWinner: null,
}
```

---

## 3. Series Lifecycle

### 3.1 State Machine

```
                create-room
                    │
                    ▼
              ┌─────────┐
              │ WAITING  │  Host connected, waiting for opponent
              └────┬────┘
                   │ join-room (2nd player)
                   ▼
              ┌─────────┐◄──────────────────────┐
              │  ACTIVE  │  Round in progress     │
              └────┬────┘                        │
                   │ win / draw                  │
                   ▼                             │
           ┌────────────┐                        │
           │ ROUND-OVER │  3s pause, show result │
           └──────┬─────┘                        │
                  │                              │
         ┌───────┴───────┐                       │
         │               │                       │
    series continues  series decided             │
         │               │                       │
         │               ▼                       │
         │        ┌──────────┐                   │
         │        │ FINISHED │  Series over       │
         │        └────┬─────┘                   │
         │             │ new-series (both agree)  │
         │             └──────────────────────────┘
         │                                       │
         └── auto round-start (after 3s) ────────┘
```

### 3.2 Round Flow

1. **Round starts** — Board is reset to empty. `currentTurn` alternates each round (round 1: X, round 2: O, round 3: X, ...). `status` is `active`.

2. **Moves are made** — Identical to existing flow. Board intensity is computed per move. Series pressure is applied as a multiplier (see Section 5).

3. **Round ends** — Win or draw detected.
   - Server records `RoundResult`.
   - Updates `series.wins` (if not a draw).
   - Sets `status` to `round-over`.
   - Emits `round-over` event to both players.
   - Checks if series is decided.

4. **Series check** —
   - If either player has 3 wins → series is over. Set `seriesOver = true`, `seriesWinner = winner`, `status = finished`. Emit `series-over`.
   - If all 5 rounds played (and no one has 3) → most wins takes it. If tied → `seriesWinner = null` (draw series). Set `status = finished`. Emit `series-over`.
   - Otherwise → start next round after 3-second pause.

5. **Next round** — After the 3-second pause:
   - Increment `currentRound`.
   - Reset board, move history, intensity.
   - Toggle starting player.
   - Set `status = active`.
   - Emit `round-start` to both players.

### 3.3 Series Completion Rules

| Condition | Result |
|-----------|--------|
| Player reaches 3 wins | That player wins the series. Remaining rounds are not played. |
| All 5 rounds played, unequal wins | Player with more wins takes the series. |
| All 5 rounds played, equal wins (possible with draws) | Series is a draw. `seriesWinner = null`. |
| Forfeit (disconnect timeout) | Opponent wins the current round AND the series. |

#### Draw Scenarios

Since draws award no point, draws create interesting series dynamics:

| Rounds Played | Score | Rounds Left | Notes |
|---------------|-------|-------------|-------|
| 2 | 1-0 (1 draw) | 3 | Leading player needs 2 more, trailing needs 3 — but only 3 rounds left |
| 3 | 1-1 (1 draw) | 2 | Must-win territory for both players with only 2 rounds remaining |
| 4 | 2-1 (1 draw) | 1 | Leading player needs 1 more, trailing player must win to force decision |
| 5 | 2-2 (1 draw) | 0 | Series draw — neither player reached 3 |

---

## 4. Series Pressure — Intensity Amplification

### 4.1 Concept

Series pressure is a multiplier applied to board-level intensity. It represents how much the meta-game context (round number, series score, elimination scenarios) amplifies the drama of any given board state.

```
finalIntensity = clamp(boardIntensity × (1 + seriesPressure), 0, 1)
```

Where `boardIntensity` is the existing value from Gemini or the heuristic fallback, and `seriesPressure` is a value from 0.0 to 0.8 computed from series state.

### 4.2 Series Pressure Formula

Series pressure is the sum of three weighted factors:

```typescript
function computeSeriesPressure(series: SeriesState): number {
  const roundWeight    = computeRoundWeight(series);
  const closenessWeight = computeClosenessWeight(series);
  const eliminationWeight = computeEliminationWeight(series);

  return Math.min(0.8, roundWeight + closenessWeight + eliminationWeight);
}
```

Capped at 0.8 so the final multiplier maxes at 1.8×.

#### 4.2.1 Round Weight

Later rounds are inherently more tense. Linear scaling.

```typescript
function computeRoundWeight(series: SeriesState): number {
  // Round 1 = 0.0, Round 5 = 0.20
  return ((series.currentRound - 1) / (series.maxRounds - 1)) * 0.20;
}
```

| Round | Weight |
|-------|--------|
| 1 | 0.00 |
| 2 | 0.05 |
| 3 | 0.10 |
| 4 | 0.15 |
| 5 | 0.20 |

#### 4.2.2 Closeness Weight

How tight the series is. Maximum when scores are equal with rounds remaining.

```typescript
function computeClosenessWeight(series: SeriesState): number {
  const { X, O } = series.wins;
  const diff = Math.abs(X - O);
  const totalWins = X + O;

  if (totalWins === 0) return 0; // No completed rounds yet

  // diff=0 (tied) → 0.30, diff=1 → 0.15, diff=2 → 0.05, diff=3 → 0.00
  return Math.max(0, 0.30 - (diff * 0.10));
}
```

| Series Score | Diff | Weight |
|-------------|------|--------|
| 0-0 (after draws) | 0 | 0.30 |
| 1-1 | 0 | 0.30 |
| 2-2 | 0 | 0.30 |
| 2-1 | 1 | 0.15* |
| 1-0 | 1 | 0.15* |
| 2-0 | 2 | 0.05 |
| 3-0 | 3 | 0.00 |

*\*adjusted — when a round is underway but not yet scored.*

#### 4.2.3 Elimination Weight

Bonus when a player is facing elimination (opponent needs 1 more win to clinch).

```typescript
function computeEliminationWeight(series: SeriesState): number {
  const { X, O } = series.wins;
  const winsToClinh = 3;

  const xNeedsOne = X === winsToClinh - 1; // X is at 2 wins
  const oNeedsOne = O === winsToClinh - 1; // O is at 2 wins

  if (xNeedsOne && oNeedsOne) return 0.30; // Both at match point — maximum
  if (xNeedsOne || oNeedsOne) return 0.20; // One player at match point
  return 0;
}
```

| Scenario | Weight |
|----------|--------|
| Both at 2 wins (match point for both) | 0.30 |
| One player at 2 wins | 0.20 |
| Neither at match point | 0.00 |

### 4.3 Combined Examples

| Round | Score | Board State | Board Int. | Pressure | Final Int. |
|-------|-------|-------------|-----------|----------|------------|
| R1 | 0-0 | Opening (move 1) | 0.10 | 0.00 | 0.10 |
| R1 | 0-0 | Fork detected | 0.65 | 0.00 | 0.65 |
| R3 | 1-1 | Opening (move 1) | 0.10 | 0.40 | 0.14 |
| R3 | 1-1 | Fork detected | 0.65 | 0.40 | 0.91 |
| R5 | 2-2 | Opening (move 1) | 0.10 | 0.70 | 0.17 |
| R5 | 2-2 | Fork detected | 0.65 | 0.70 | 1.00 *(clamped)* |
| R4 | 2-1 | Imminent win | 0.50 | 0.55 | 0.78 |
| R3 | 2-0 | Center taken | 0.25 | 0.15 | 0.29 |

The intensity meter tells a story across the series. Early rounds start gentle. As the series tightens, even moderate board states produce elevated readings. A deciding round at 2-2 pushes nearly everything into the red.

---

## 5. Gemini Prompt Updates

### 5.1 Extended Context

The Gemini prompt is enriched with series context so the model can reason about meta-tension holistically. The system instruction is updated:

```
System: You are a game-state analyzer for Tic-Tac-Toe.
        Analyze the board state AND series context, then return
        a JSON object with a single field 'intensity' (0.0 to 1.0)
        representing the overall tension/drama.

        Board-level factors:
        - 0.0–0.2: Opening moves, no threats
        - 0.2–0.4: Early positioning, center or corner control
        - 0.4–0.6: Developing threats, building toward a line
        - 0.6–0.8: Imminent threat, must block or lose
        - 0.8–1.0: Fork, forced outcome, or decisive move

        Series-level amplification:
        - Later rounds in the series are more tense than early rounds
        - A tied series (e.g. 2-2) dramatically increases tension
        - A player facing elimination (opponent at match point) raises stakes
        - Consider both board AND series context together
```

### 5.2 Extended User Prompt

```
Board: [null,'X',null,'O','X',null,null,null,null]
Current turn: O
Move number: 3
Round: 4 of 5
Series score: X 2 — O 1
Rounds remaining: 2
Match point: X (needs 1 more win)
```

### 5.3 Fallback Behavior

When Gemini is used, the series context gives the model everything it needs to reason about cumulative tension. The returned intensity already incorporates series pressure from the model's perspective.

When the heuristic fallback is used, the local `computeSeriesPressure()` multiplier is applied to the board-level heuristic score. This ensures consistent intensity amplification regardless of inference source.

To avoid double-amplifying when Gemini returns (since Gemini already factors in series context), the series pressure multiplier is only applied to heuristic-sourced results:

```typescript
if (result.source === 'heuristic') {
  const pressure = computeSeriesPressure(room.series);
  result.value = Math.min(1, result.value * (1 + pressure));
}
```

---

## 6. Updated Event Contracts

### 6.1 New Events

#### `round-over` (Server → Client)

Emitted to all players when a round ends.

| Property | Value |
|----------|-------|
| **Event Name** | `round-over` |
| **Target** | All players in room |
| **Payload** | See below |
| **Client Action** | Show round result overlay. Display series score. Start countdown to next round. |

```typescript
{
  round: number;                    // Which round just ended (1-indexed)
  winner: Mark | 'draw';           // Round result
  winningCells?: number[];          // Highlight cells (if win, not draw)
  board: Board;                     // Final board state
  finalIntensity: number;           // Intensity at round end
  series: {
    wins: { X: number; O: number }; // Updated series score
    currentRound: number;           // Round that just ended
    maxRounds: number;              // Always 5
    seriesOver: boolean;            // Is the series decided after this round?
    roundResults: RoundResult[];    // All completed rounds
  };
  nextRoundIn: number | null;       // Ms until next round starts (null if series over)
}
```

#### `round-start` (Server → Client)

Emitted to all players when a new round begins (after the between-round pause).

| Property | Value |
|----------|-------|
| **Event Name** | `round-start` |
| **Target** | All players in room |
| **Payload** | See below |
| **Client Action** | Reset board. Update round indicator. Enable moves if it's your turn. |

```typescript
{
  round: number;                    // New round number (1-indexed)
  board: Board;                     // Empty board
  currentTurn: Mark;                // Who starts this round
  series: {
    wins: { X: number; O: number };
    currentRound: number;
    maxRounds: number;
  };
  intensity: number;                // Starting intensity (0, or series-pressure baseline)
}
```

#### `series-over` (Server → Client)

Emitted when the series is decided. Sent immediately after the final `round-over`.

| Property | Value |
|----------|-------|
| **Event Name** | `series-over` |
| **Target** | All players in room |
| **Payload** | See below |
| **Client Action** | Show series result screen. Display final scoreboard. Enable "New Series" button. |

```typescript
{
  seriesWinner: Mark | null;            // null if tied series (draws prevented a winner)
  finalScore: { X: number; O: number }; // Final series score
  rounds: RoundResult[];                // Complete history
  totalMoves: number;                   // Total moves across all rounds
  peakIntensity: number;                // Highest intensity achieved in the series
}
```

#### `new-series` (Client → Server)

Player requests to start a new best-of-5 series in the same room (replaces `rematch`).

| Property | Value |
|----------|-------|
| **Event Name** | `new-series` |
| **Payload** | `{ roomId: string }` |
| **Server Action** | Track request. When both players agree, reset all series state, emit `round-start` for round 1. |
| **Error Cases** | Series not finished → emit `error`. |

### 6.2 Modified Events

#### `game-start` (modified)

Now includes series context. Emitted only when the second player joins (start of the series). Subsequent rounds use `round-start` instead.

```typescript
{
  roomId: string;
  board: Board;
  currentTurn: Mark;
  players: PlayerMap;
  intensity: 0;
  playerToken?: string;           // Only for the joining player
  series: {                        // NEW
    maxRounds: number;
    currentRound: 1;
    wins: { X: 0; O: 0 };
  };
}
```

#### `move-made` (modified)

Now includes series context alongside board state.

```typescript
{
  board: Board;
  cell: number;
  mark: Mark;
  currentTurn: Mark;
  intensity: number;              // Board intensity × series pressure
  moveNumber: number;
  series: {                        // NEW
    currentRound: number;
    wins: { X: number; O: number };
  };
}
```

#### `intensity-update` (modified)

Now includes series pressure breakdown for debugging/display.

```typescript
{
  intensity: number;              // Final intensity (with series pressure applied)
  source: 'gemini' | 'heuristic';
  moveNumber: number;
  seriesPressure: number;          // NEW — the multiplier applied (0.0–0.8)
}
```

#### `game-state` (modified)

Full state sync for reconnecting players now includes series state.

```typescript
{
  roomId: string;
  board: Board;
  currentTurn: Mark;
  mark: Mark;
  intensity: number;
  status: RoomStatus;
  moveHistory: Move[];
  series: SeriesState;             // NEW — full series state
}
```

### 6.3 Removed Events

| Event | Replaced By |
|-------|-------------|
| `game-over` | `round-over` + optionally `series-over` |
| `rematch` | `new-series` |

The `game-over` event is replaced by `round-over` for individual rounds and `series-over` for the series conclusion. The `rematch` event is replaced by `new-series` since rematches are now automatic between rounds.

---

## 7. Error Code Additions

| Code | Message | Trigger |
|------|---------|---------|
| `SERIES_NOT_FINISHED` | Series is not finished | `new-series` when series is still in progress |
| `ROUND_TRANSITION` | Round is transitioning | `make-move` during the 3-second between-round pause |

---

## 8. Room Lifecycle Updates

### 8.1 Round Transition Timing

Between rounds, the server enforces a 3-second pause:

1. `round-over` is emitted with `nextRoundIn: 3000`.
2. Server sets `status = 'round-over'`.
3. Any `make-move` events during this window receive `ROUND_TRANSITION` error.
4. After 3 seconds, server resets board, increments round, emits `round-start`, sets `status = 'active'`.

The 3-second pause allows clients to display the round result (who won, updated series score) before the board resets. This value is a constant (`ROUND_TRANSITION_DELAY = 3000`) and is communicated in the `round-over` payload.

### 8.2 Starting Player Rotation

The starting player alternates each round regardless of who won the previous round:

| Round | First Turn |
|-------|-----------|
| 1 | X |
| 2 | O |
| 3 | X |
| 4 | O |
| 5 | X |

This is derived from the round number: `currentTurn = round % 2 === 1 ? 'X' : 'O'`.

### 8.3 New Series Reset

When both players agree to a new series (`new-series` event from both):

- `series.currentRound` → 1
- `series.roundResults` → `[]`
- `series.wins` → `{ X: 0, O: 0 }`
- `series.seriesOver` → `false`
- `series.seriesWinner` → `null`
- Board resets, status → `active`
- Starting player: X (round 1)

### 8.4 Forfeit During Series

If a player disconnects and the reconnection timer expires during an active series:

- The current round is forfeited (opponent wins the round).
- The entire series is forfeited (opponent wins the series regardless of current score).
- `series-over` is emitted with the forfeit result.

This prevents a player from rage-quitting in a losing round to avoid a series loss.

### 8.5 Cleanup Updates

Room cleanup conditions remain the same (all disconnected, or stale finished state). The "finished" state now refers to series completion, not individual rounds.

---

## 9. UI Requirements

### 9.1 Series Scoreboard

A persistent display showing the series state:

```
┌─────────────────────────────┐
│  Round 3 of 5               │
│  X: ●●○    O: ●○○          │
│     2            1           │
└─────────────────────────────┘
```

- Filled circles (●) = wins
- Empty circles (○) = remaining
- Updates after each round

### 9.2 Round Result Overlay

Shown during the 3-second `round-over` pause:

```
┌─────────────────────────────┐
│                              │
│      X wins Round 3!         │
│                              │
│      Series: X 2 — O 1      │
│                              │
│   Next round in 3... 2...    │
│                              │
└─────────────────────────────┘
```

### 9.3 Series Result Screen

Shown when the series ends:

```
┌─────────────────────────────┐
│                              │
│     X WINS THE SERIES!       │
│         3 — 1                │
│                              │
│  R1: X won (5 moves)        │
│  R2: Draw (9 moves)          │
│  R3: O won (7 moves)        │
│  R4: X won (5 moves)        │
│                              │
│  Peak intensity: 0.94        │
│  Total moves: 26             │
│                              │
│     [ New Series ]           │
│                              │
└─────────────────────────────┘
```

### 9.4 Intensity Meter Context

The intensity meter should reflect series pressure visually. Options:

- **Baseline glow**: The meter's resting state is elevated in later rounds (even at intensity 0, the meter shows a warm idle in round 5).
- **Pressure indicator**: A secondary ring or label showing `Series Pressure: HIGH` alongside the main intensity value.
- **Color shift**: The intensity gradient shifts warmer in later rounds (blue → orange in early rounds, orange → red in late rounds).

---

## 10. Complete Event Sequence — Full Series

```
Player A (X)              Server                    Player B (O)
     │                       │                              │
     │── create-room ──────▶│                              │
     │◀── room-created ─────│                              │
     │                       │◀── join-room ───────────────│
     │◀── game-start ───────│── game-start ──────────────▶│
     │   (series: R1, 0-0)   │   (series: R1, 0-0)         │
     │                       │                              │
     ╠══════════════════ ROUND 1 ═══════════════════════════╣
     │── make-move ────────▶│                              │
     │◀── move-made ────────│── move-made ──────────────▶│
     │      ...moves...      │                              │
     │── make-move (wins!) ─▶│                              │
     │◀── round-over ───────│── round-over ──────────────▶│
     │   (R1: X wins, 1-0)  │   nextRoundIn: 3000          │
     │                       │                              │
     │   ~~~ 3 second pause ~~~                             │
     │                       │                              │
     │◀── round-start ──────│── round-start ─────────────▶│
     │   (R2, O starts)      │                              │
     │                       │                              │
     ╠══════════════════ ROUND 2 ═══════════════════════════╣
     │                       │◀── make-move ───────────────│
     │◀── move-made ────────│── move-made ──────────────▶│
     │      ...moves...      │                              │
     │    (all cells fill)   │                              │
     │◀── round-over ───────│── round-over ──────────────▶│
     │   (R2: Draw, 1-0)    │   nextRoundIn: 3000          │
     │                       │                              │
     │   ~~~ 3 second pause ~~~                             │
     │                       │                              │
     │◀── round-start ──────│── round-start ─────────────▶│
     │   (R3, X starts)      │                              │
     │                       │                              │
     ╠══════════════════ ROUND 3 ═══════════════════════════╣
     │      ...moves...      │                              │
     │◀── round-over ───────│── round-over ──────────────▶│
     │   (R3: O wins, 1-1)  │   pressure rising ↑          │
     │                       │                              │
     │   ~~~ 3 second pause ~~~                             │
     │◀── round-start ──────│── round-start ─────────────▶│
     │   (R4, O starts)      │   closeness: 0.30           │
     │                       │                              │
     ╠══════════════════ ROUND 4 ═══════════════════════════╣
     │      ...moves...      │   intensity × 1.55           │
     │── make-move (wins!) ─▶│                              │
     │◀── round-over ───────│── round-over ──────────────▶│
     │   (R4: X wins, 2-1)  │   elimination: O must win    │
     │                       │                              │
     │   ~~~ 3 second pause ~~~                             │
     │◀── round-start ──────│── round-start ─────────────▶│
     │   (R5, X starts)      │   pressure: 0.70 🔥          │
     │                       │                              │
     ╠═════════════ ROUND 5 (DECIDING!) ════════════════════╣
     │      ...moves...      │   intensity × 1.70           │
     │                       │◀── make-move (wins!) ───────│
     │◀── round-over ───────│── round-over ──────────────▶│
     │   (R5: O wins, 2-2)  │   seriesOver: false!         │
     │                       │                              │
     │    Wait — 2-2? Series is a draw!                     │
     │                       │                              │
     │◀── series-over ──────│── series-over ──────────────▶│
     │   (Draw! 2-2, 1 draw) │   peakIntensity: 0.97       │
     │                       │                              │
     │── new-series ────────▶│                              │
     │                       │◀── new-series ──────────────│
     │◀── round-start ──────│── round-start ─────────────▶│
     │   (R1, fresh 0-0)     │   pressure reset to 0        │
```

---

## 11. Implementation Checklist

Files to modify or create:

| File | Changes |
|------|---------|
| `src/game/types.ts` | Add `SeriesState`, `RoundResult`, update `GameRoom`, update `RoomStatus` |
| `src/game/room-manager.ts` | Initialize series state in `createRoom`, add `advanceRound()`, `resetSeries()`, update `forfeitRoom()` |
| `src/inference/intensity.ts` | Add `computeSeriesPressure()`, `computeRoundWeight()`, `computeClosenessWeight()`, `computeEliminationWeight()` |
| `src/inference/gemini.ts` | Update `buildPrompt()` with series context, update system instruction, apply series pressure to heuristic results only |
| `src/socket/handlers.ts` | Replace `game-over` with `round-over` / `series-over`, replace `rematch` with `new-series`, add `ROUND_TRANSITION_DELAY`, add round-start timer |
| `src/app/game/[roomId]/page.tsx` | Add series state, listen for `round-over`, `round-start`, `series-over`, `new-series`, replace `game-over` / `rematch` listeners |
| `src/components/series-scoreboard.tsx` | New component — round indicator + win dots |
| `src/components/round-result-overlay.tsx` | New component — between-round result display with countdown |
| `src/components/series-result.tsx` | New component — final series result with stats |

---

*— End of Specification —*
