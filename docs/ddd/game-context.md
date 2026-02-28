# Bounded Context: Game

The core game domain — board state, moves, win detection, and turn management. Pure logic with no external dependencies.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Board** | 3x3 grid represented as a flat 9-element array |
| **Cell** | Single position on the board (index 0–8) |
| **Mark** | Player symbol: `'X'` or `'O'` |
| **Win Line** | Set of 3 aligned cells that constitute a win (8 possible) |
| **Turn** | Which mark can currently be placed |
| **Draw** | All 9 cells filled with no winning line |
| **Move** | A player placing their mark on an empty cell |

## Aggregates

### Board (Aggregate Root)

The board is the central aggregate. All game state mutations flow through it.

```typescript
type Board = (null | 'X' | 'O')[];  // length 9, null = empty
```

**Invariants:**
- Always exactly 9 cells
- Each cell is `null`, `'X'`, or `'O'`
- X and O counts differ by at most 1 (alternating turns)

**Cell index layout:**
```
 0 | 1 | 2
-----------
 3 | 4 | 5
-----------
 6 | 7 | 8
```

**Methods:**
- `placeMarker(board, cell, mark)` — returns new board with mark placed at cell
- `checkWin(board)` — returns `{ winner, winningCells }` or null
- `checkDraw(board)` — returns true if all cells filled with no winner
- `isValidMove(board, cell)` — returns true if cell is 0–8 and board[cell] is null

## Value Objects

### Move (Immutable)

```typescript
interface Move {
  cell: number;       // 0–8
  mark: 'X' | 'O';
  timestamp: number;  // Date.now() at time of move
  intensity: number;  // intensity score AFTER this move was placed
}
```

Represents a single player action. The `intensity` field captures the game tension at the moment of the move, enabling replay analysis.

### WinResult (Immutable)

```typescript
interface WinResult {
  winner: 'X' | 'O' | 'draw';
  winningCells?: number[];  // indices of the 3 winning cells (absent for draw)
}
```

## Domain Constants

### Win Lines

8 static winning combinations — checked after every move:

```typescript
const WIN_LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],  // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],  // columns
  [0, 4, 8], [2, 4, 6],             // diagonals
];
```

## Domain Events

| Event | Trigger | Data |
|-------|---------|------|
| `MoveMade` | Valid move placed on board | `{ cell, mark, board, intensity }` |
| `GameWon` | Win condition detected after move | `{ winner, winningCells, board }` |
| `GameDrawn` | All 9 cells filled, no winner | `{ board }` |

## Business Rules

1. Win detection checks all 8 lines — first match wins (no need to check further)
2. Draw is only checked after confirming no win (win takes precedence)
3. Turn alternates: X always moves first, then O, then X, etc.
4. Move history preserves intensity at time of move (for analysis/replay)
5. The game engine is a pure module — no I/O, no side effects, no socket awareness

## Move Validation Pipeline

Every move passes through 6 sequential checks before state mutation:

1. **Room exists** — roomId maps to a GameRoom
2. **Game is active** — status === 'active'
3. **Player belongs to room** — token exists in room.players
4. **Correct turn** — player's mark === currentTurn
5. **Valid cell** — integer 0–8
6. **Cell empty** — board[cell] === null

Validation is fail-fast: first failing check returns an error code, no further checks run.

## Dependencies

None. This is a pure domain module with no imports from Room, Inference, or Communication contexts.
