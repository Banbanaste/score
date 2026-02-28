# Multiplayer Game Server Technical Specification

**Next.js | Socket.IO | Google Gemini**

Version 1.0 — February 2026 | Hackathon Build Spec | Engineering

---

## 1. Overview

This document specifies the server-side architecture for a real-time, turn-based multiplayer game built on Next.js with Socket.IO for bidirectional communication and Google Gemini for game-state inference. The server is the single source of truth for all game state, move validation, and intensity computation. Clients are thin renderers that emit user actions and consume server broadcasts.

The inference layer runs after every validated move. It analyzes the current board state and produces an intensity score (0.0–1.0) that clients use to drive adaptive music crossfading. The inference pipeline supports two modes: a synchronous heuristic analyzer for instant response, and an asynchronous Gemini API call for richer contextual analysis.

### 1.1 Design Principles

- **Server-authoritative:** All game logic, validation, and state mutations happen server-side.
- **Single-process deployment:** Next.js HTTP handler and Socket.IO WebSocket server run on the same Node.js process.
- **Stateless clients:** The client renders what the server tells it. No local game logic beyond UI state.
- **Inference as a first-class concern:** Intensity analysis is part of the move-processing pipeline, not an afterthought.
- **Hackathon-scoped:** In-memory state, no database, no authentication. Designed for speed of implementation.

### 1.2 Scope

This spec covers the game server only: the custom server entry point, Socket.IO event contracts, room management, game engine, inference pipeline, and deployment. It does not cover the client-side UI, audio engine, or frontend framework details.

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | **Node.js 20+** | Server runtime, single-threaded event loop |
| Framework | **Next.js 14+ (Pages Router)** | HTTP handler, page serving, API routes for non-realtime endpoints |
| WebSocket | **Socket.IO 4.x** | Bidirectional real-time communication, room management, reconnection handling |
| Inference | **Google Gemini API** | Game-state analysis, intensity scoring via `gemini-3-flash-preview` |
| Inference SDK | **@google/genai** | Official Google GenAI SDK for Node.js (replaces deprecated `@google/generative-ai`) |
| Language | **TypeScript 5.x** | Type safety across server, game engine, and event contracts |
| Process Mgmt | **tsx** | TypeScript execution for custom server entry point |
| Deployment | **Railway** | Single-service deployment with WebSocket support, persistent process |

### 2.1 NPM Dependencies

| Package | Type | Notes |
|---------|------|-------|
| `next` | prod | Framework core |
| `react` / `react-dom` | prod | Required by Next.js |
| `socket.io` | prod | Server-side WebSocket library |
| `socket.io-client` | prod | Client-side connector (used by Next.js pages) |
| `@google/genai` | prod | Gemini inference SDK (official, replaces deprecated `@google/generative-ai`) |
| `nanoid` | prod | Short, URL-safe room code generation (e.g., `A3kX9z`) |
| `typescript` | dev | Type checking |
| `tsx` | dev | Run TypeScript server directly |
| `@types/node` | dev | Node.js type definitions |

---

## 3. Server Architecture

### 3.1 Custom Server Entry Point

The server is a single Node.js process that creates an HTTP server, attaches both the Next.js request handler and the Socket.IO WebSocket server to it, and listens on one port. The entry point is a custom `server.ts` file that replaces the default `next start` command.

#### Process Flow

1. Create HTTP server using Node's `http.createServer()`.
2. Initialize Next.js app and get its request handler.
3. Attach Socket.IO to the same HTTP server instance.
4. Register all Socket.IO event handlers (game logic).
5. Route all non-WebSocket HTTP requests to the Next.js handler.
6. Listen on `PORT` (default 3000).

### 3.2 File Structure

```
project-root/
├── server.ts                    # Custom server entry point
├── src/
│   ├── game/
│   │   ├── engine.ts            # Game logic: validation, win detection
│   │   ├── room-manager.ts      # Room CRUD, player assignment
│   │   └── types.ts             # Shared type definitions
│   ├── inference/
│   │   ├── intensity.ts         # Heuristic intensity analyzer
│   │   └── gemini.ts            # Gemini API client wrapper
│   └── socket/
│       └── handlers.ts          # Socket.IO event handlers
├── pages/                        # Next.js pages (client)
├── package.json
└── tsconfig.json
```

### 3.3 In-Memory State

All game state is held in a `Map<string, GameRoom>` keyed by room ID. No database. If the server restarts, all active games are lost. This is acceptable for hackathon scope.

#### GameRoom Type Definition

```typescript
interface GameRoom {
  id: string;                       // Short room code (e.g., "A3kX9z") for easy sharing
  players: {
    [playerToken: string]: {        // Keyed by session token, NOT socket ID
      mark: 'X' | 'O';
      socketId: string | null;      // Current socket ID (null if disconnected)
      connected: boolean;
    };
  };
  board: (null | 'X' | 'O')[];     // 9-cell array, null = empty
  currentTurn: 'X' | 'O';
  status: 'waiting' | 'active' | 'finished';
  winner: null | 'X' | 'O' | 'draw';
  intensity: number;                // 0.0 - 1.0
  moveHistory: Move[];
  createdAt: number;
}

interface Move {
  cell: number;       // 0-8
  mark: 'X' | 'O';
  timestamp: number;
  intensity: number;  // intensity AFTER this move
}
```

**Player identity:** Players are keyed by a server-generated session token (a random string issued on `create-room` / `join-room`), not by Socket.IO socket ID. This allows players to reconnect with a new socket and re-associate with their seat by presenting their token via the `rejoin-room` event. The token is stored client-side in memory (or sessionStorage) for the duration of the game.

---

## 4. Socket.IO Event Contract

All real-time communication flows through Socket.IO events. The following tables define every event, its direction, payload shape, and behavior. These are the complete contracts between client and server.

### 4.1 Client → Server Events

#### `create-room`

Player requests to create a new game room and become the host.

| Property | Value |
|----------|-------|
| **Event Name** | `create-room` |
| **Payload** | `{ playerName?: string }` |
| **Server Action** | Generate short room code (6 chars via nanoid), generate player session token, create GameRoom in Map, assign player as X, join Socket.IO room, emit `room-created` back to sender |
| **Error Cases** | Player already in a room → emit `error` |

#### `join-room`

Player requests to join an existing room using a room code.

| Property | Value |
|----------|-------|
| **Event Name** | `join-room` |
| **Payload** | `{ roomId: string, playerName?: string }` |
| **Server Action** | Validate room exists and has space, generate player session token, assign player as O, join Socket.IO room, set status to `active`, emit `game-start` to both players in room (include `playerToken` in response to joining player) |
| **Error Cases** | Room not found, room full, room already active/finished → emit `error` |

#### `make-move`

Player places their mark on a cell. This is the core gameplay event.

| Property | Value |
|----------|-------|
| **Event Name** | `make-move` |
| **Payload** | `{ roomId: string, cell: number }` |
| **Server Action** | Validate: (1) room exists and is active, (2) it is this player's turn, (3) cell is 0–8 and empty. Place mark, run intensity analysis, check win/draw, emit `move-made` to room. If game over, emit `game-over` to room. |
| **Error Cases** | Invalid room, not player's turn, cell occupied, game not active → emit `error` |

#### `rematch`

Player requests a new game in the same room after a game ends.

| Property | Value |
|----------|-------|
| **Event Name** | `rematch` |
| **Payload** | `{ roomId: string }` |
| **Server Action** | Track rematch request. When both players have requested, reset board, swap starting player, set status to `active`, emit `game-start` to room. |
| **Error Cases** | Room not found, game not finished → emit `error` |

#### `disconnect`

Built-in Socket.IO event fired when a client's connection drops.

| Property | Value |
|----------|-------|
| **Event Name** | `disconnect` |
| **Payload** | (automatic, includes reason string) |
| **Server Action** | Mark player as disconnected in room (set `socketId` to null, `connected` to false). Emit `player-disconnected` to remaining player. Start a 30-second reconnection timer. If timer expires, forfeit game and emit `game-over`. |

#### `rejoin-room`

Player reconnects after a disconnection, presenting their session token to reclaim their seat.

| Property | Value |
|----------|-------|
| **Event Name** | `rejoin-room` |
| **Payload** | `{ roomId: string, playerToken: string }` |
| **Server Action** | Validate token matches a player in the room. Update player's `socketId` to the new socket, set `connected` to true, cancel reconnection timer, join Socket.IO room. Emit `player-reconnected` to opponent. Emit `game-state` to the rejoining player with the full current board, turn, and intensity. |
| **Error Cases** | Room not found, token invalid, reconnection window expired → emit `error` |

---

### 4.2 Server → Client Events

#### `room-created`

| Property | Value |
|----------|-------|
| **Event Name** | `room-created` |
| **Target** | Sender only |
| **Payload** | `{ roomId: string, mark: 'X', playerToken: string }` |
| **Client Action** | Display room code for sharing. Show waiting state. |

#### `game-start`

| Property | Value |
|----------|-------|
| **Event Name** | `game-start` |
| **Target** | All players in room |
| **Payload** | `{ roomId: string, board: Board, currentTurn: Mark, players: PlayerMap, intensity: 0 }` |
| **Client Action** | Render game board. Enable input if it's this player's turn. Start calm ambient music. |

#### `move-made`

The primary game-state update event. Broadcast after every validated move.

| Property | Value |
|----------|-------|
| **Event Name** | `move-made` |
| **Target** | All players in room |
| **Payload** | `{ board: Board, cell: number, mark: Mark, currentTurn: Mark, intensity: number, moveNumber: number }` |
| **Client Action** | Update board render. Toggle turn indicator. Crossfade music to match intensity value. |

#### `game-over`

| Property | Value |
|----------|-------|
| **Event Name** | `game-over` |
| **Target** | All players in room |
| **Payload** | `{ winner: Mark \| 'draw', winningCells?: number[], board: Board, finalIntensity: number }` |
| **Client Action** | Highlight winning cells (if any). Show result modal. Transition music to resolution. Enable rematch button. |

#### `error`

| Property | Value |
|----------|-------|
| **Event Name** | `error` |
| **Target** | Sender only |
| **Payload** | `{ code: string, message: string }` |
| **Client Action** | Display error toast/notification. |

#### `player-disconnected`

| Property | Value |
|----------|-------|
| **Event Name** | `player-disconnected` |
| **Target** | Remaining player in room |
| **Payload** | `{ disconnectedMark: Mark, timeout: number }` |
| **Client Action** | Show "opponent disconnected" overlay with countdown timer. |

#### `player-reconnected`

| Property | Value |
|----------|-------|
| **Event Name** | `player-reconnected` |
| **Target** | Remaining player in room |
| **Payload** | `{ reconnectedMark: Mark }` |
| **Client Action** | Dismiss "opponent disconnected" overlay. Resume game. |

#### `game-state`

Full state sync sent to a reconnecting player so they can rebuild their UI.

| Property | Value |
|----------|-------|
| **Event Name** | `game-state` |
| **Target** | Reconnecting player only |
| **Payload** | `{ roomId: string, board: Board, currentTurn: Mark, mark: Mark, intensity: number, status: Status, moveHistory: Move[] }` |
| **Client Action** | Rebuild board, turn indicator, and music intensity from the synced state. |

---

## 5. Error Codes

All server-to-client error events include a machine-readable code and a human-readable message.

| Code | Message | Trigger |
|------|---------|---------|
| `ROOM_NOT_FOUND` | Room does not exist | join-room / make-move |
| `ROOM_FULL` | Room already has two players | join-room |
| `GAME_NOT_ACTIVE` | Game is not in active state | make-move |
| `NOT_YOUR_TURN` | It is not your turn | make-move |
| `INVALID_CELL` | Cell index out of range (0–8) | make-move |
| `CELL_OCCUPIED` | Cell is already occupied | make-move |
| `ALREADY_IN_ROOM` | Player is already in a room | create-room / join-room |
| `INVALID_TOKEN` | Session token does not match any player in room | rejoin-room |
| `RECONNECT_EXPIRED` | Reconnection window has expired | rejoin-room |
| `INFERENCE_FAILED` | Intensity analysis failed (non-blocking) | make-move (internal) |

---

## 6. Game Engine

### 6.1 Board Representation

The board is a flat array of 9 cells indexed 0–8, mapping to a 3×3 grid:

```
Index Layout:       Grid Mapping:
 0 | 1 | 2          (0,0) | (0,1) | (0,2)
-----------         ----------------------
 3 | 4 | 5          (1,0) | (1,1) | (1,2)
-----------         ----------------------
 6 | 7 | 8          (2,0) | (2,1) | (2,2)
```

### 6.2 Win Detection

Win checking evaluates 8 possible winning lines (3 rows, 3 columns, 2 diagonals) against the current board. The win-condition array is a static constant:

```typescript
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],  // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],  // columns
  [0, 4, 8], [2, 4, 6],             // diagonals
];
```

The engine returns the winning line indices (for client highlighting) along with the winner mark. A draw is detected when all 9 cells are filled with no winning line.

### 6.3 Move Validation Pipeline

Every `make-move` event passes through this validation sequence before any state mutation occurs:

1. **Room exists** → Lookup room in Map by roomId.
2. **Game is active** → Room status must be `active`.
3. **Player belongs to room** → Socket ID exists in room's players map.
4. **It's this player's turn** → Player's mark matches `currentTurn`.
5. **Cell is valid** → Cell index is integer 0–8.
6. **Cell is empty** → `board[cell]` is `null`.

Only after all checks pass does the server mutate state, run inference, check for game-over, and broadcast.

### 6.4 Move Processing Sequence

After validation passes, the server executes these steps in order:

```
1. board[cell] = currentPlayer.mark
2. intensity = analyzeIntensity(board, currentTurn)
3. moveHistory.push({ cell, mark, timestamp, intensity })
4. result = checkWinOrDraw(board)
5. if (result) {
     room.status = 'finished'
     room.winner = result.winner
     emit('game-over', { winner, winningCells, board, finalIntensity })
   } else {
     room.currentTurn = toggle(currentTurn)
     emit('move-made', { board, cell, mark, currentTurn, intensity, moveNumber })
   }
```

---

## 7. Inference Pipeline

The inference pipeline produces an intensity score between 0.0 and 1.0 that represents the tension level of the current game state. This score is computed after every validated move and broadcast to both clients alongside the board update.

### 7.1 Gemini Integration

The primary inference mode calls the Google Gemini API to analyze the board state and return a structured intensity score. This provides richer contextual analysis than pure heuristics.

#### Configuration

```
Model:            gemini-3-flash-preview
SDK:              @google/genai (GoogleGenAI client)
Auth:             GEMINI_API_KEY environment variable
Response Format:  application/json (structured output via responseMimeType)
Timeout:          3 seconds (fallback to heuristic on timeout)
```

#### SDK Usage

```typescript
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const response = await ai.models.generateContent({
  model: "gemini-3-flash-preview",
  contents: promptString,
  config: {
    responseMimeType: "application/json",
  },
});
const parsed = JSON.parse(response.text);
```

#### Prompt Structure

The Gemini call sends the board state as a structured prompt and requests a JSON response with an intensity field. The system instruction constrains the model to output only the numeric score:

```
System: You are a game-state analyzer for Tic-Tac-Toe.
        Analyze the board and return a JSON object with a
        single field 'intensity' (0.0 to 1.0) representing
        the current tension/drama of the game state.

User:   Board: [null,'X',null,'O','X',null,null,null,null]
        Current turn: O
        Move number: 3

Response: { "intensity": 0.65 }
```

#### Intensity Scoring Guidelines (provided to model)

- **0.0–0.2:** Opening moves, no threats, no strategic positioning yet.
- **0.2–0.4:** Early positioning, center or corner control established.
- **0.4–0.6:** Developing threats, one player building toward a line.
- **0.6–0.8:** Imminent threat, one player one move from winning, opponent must block.
- **0.8–1.0:** Critical state. Fork detected (two winning paths), forced outcome, or decisive final move.

### 7.2 Heuristic Fallback

If the Gemini API call fails, times out, or is disabled, a synchronous heuristic function computes intensity locally. This ensures the game never blocks on an external service.

#### Heuristic Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| Board Fill | 0.15 | `filledCells / 9`. Tension naturally rises as the board fills. |
| Imminent Win | 0.35 | Either player has two in a line with the third cell empty. Boolean, highest impact. |
| Fork Detection | 0.30 | A player has two separate imminent-win lines simultaneously. Peak tension. |
| Center Control | 0.10 | Center cell (index 4) is occupied. Signals strategic intent. |
| Forced Draw | 0.10 | No winning paths remain for either player. Tension deflates. |

#### Heuristic Computation

```typescript
function analyzeIntensity(board: Board, currentTurn: Mark): number {
  let intensity = 0;
  const filled = board.filter(c => c !== null).length;
  intensity += (filled / 9) * 0.15;

  const xThreats = countImminentWins(board, 'X');
  const oThreats = countImminentWins(board, 'O');
  if (xThreats > 0 || oThreats > 0) intensity += 0.35;
  if (xThreats >= 2 || oThreats >= 2) intensity += 0.30;  // fork

  if (board[4] !== null) intensity += 0.10;
  if (isDrawForced(board)) intensity -= 0.10;

  return Math.max(0, Math.min(1, intensity));
}
```

### 7.3 Pipeline Orchestration

The inference pipeline attempts Gemini first, falls back to heuristic on failure, and never blocks the game loop:

```typescript
async function getIntensity(board, currentTurn, moveNumber): Promise<number> {
  try {
    const result = await Promise.race([
      geminiAnalyze(board, currentTurn, moveNumber),
      timeout(3000),
    ]);
    // Validate and clamp — Gemini may return out-of-range or malformed values
    const raw = typeof result.intensity === 'number' ? result.intensity : NaN;
    if (isNaN(raw)) throw new Error('Invalid intensity from Gemini');
    return Math.max(0, Math.min(1, raw));
  } catch {
    return analyzeIntensity(board, currentTurn);  // heuristic fallback
  }
}
```

---

## 8. Room Lifecycle

Each game room follows a deterministic lifecycle managed entirely by the server.

### 8.1 State Machine

```
                create-room
                    │
                    ▼
              ┌─────────┐
              │ WAITING │  ← Only host connected, waiting for opponent
              └────┬────┘
                   │ join-room (2nd player)
                   ▼
              ┌─────────┐
              │  ACTIVE │  ← Game in progress, accepting moves
              └────┬────┘
                   │ win / draw / forfeit
                   ▼
             ┌──────────┐
             │ FINISHED │  ← Game over, awaiting rematch or cleanup
             └─────┬────┘
                   │ both players rematch
                   ▼
              ┌─────────┐
              │  ACTIVE │  ← New round, board reset
              └─────────┘
```

### 8.2 Cleanup

Rooms are cleaned up from the in-memory Map under two conditions: both players disconnect without reconnecting within the timeout window, or the room has been in a finished state for more than 10 minutes with no rematch request. A periodic cleanup interval (every 60 seconds) sweeps for stale rooms.

---

## 9. Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `GEMINI_API_KEY` | **Yes** | — | Google AI API key |
| `NODE_ENV` | No | `development` | Env mode |
| `INFERENCE_TIMEOUT` | No | `3000` | Gemini timeout (ms) |
| `RECONNECT_TIMEOUT` | No | `30000` | Disconnect grace period (ms) |
| `CLIENT_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin for Socket.IO |

---

## 10. Deployment

### 10.1 Why Not Vercel

Vercel deploys Next.js as serverless functions. Serverless functions are stateless and short-lived, which means they cannot hold WebSocket connections or in-memory game state. Socket.IO requires a persistent, long-running Node.js process. This rules out Vercel for this architecture.

### 10.2 Railway Configuration

Railway supports persistent Node.js processes with WebSocket traffic out of the box.

```json
// package.json scripts
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "next build && tsc --project tsconfig.server.json",
    "start": "node dist/server.js"
  }
}
```

A separate `tsconfig.server.json` extends the base config and compiles `server.ts` + its `src/` imports into a `dist/` directory. This avoids the fragile single-file `tsc server.ts` approach that cannot resolve project imports.

```
# Railway build settings
Build Command:   npm run build
Start Command:   npm run start
```

### 10.3 CORS Configuration

Socket.IO must be configured with appropriate CORS settings to accept connections from the Next.js client origin:

```typescript
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});
```

---

## 11. Complete Event Sequence

The following sequence traces a complete game from room creation through game-over, showing every event and the server's internal actions:

```
Player A (Client)           Server                    Player B (Client)
     │                         │                              │
     │── create-room ────────▶│                              │
     │                         │ Create room, assign X       │
     │◀── room-created ───────│                              │
     │                         │                              │
     │  (shares room code)     │                              │
     │                         │◀── join-room ─────────────── │
     │                         │ Assign O, set active         │
     │◀── game-start ─────────│── game-start ──────────────▶│
     │                         │                              │
     │── make-move {cell:4} ─▶│                              │
     │                         │ Validate → Place X → Infer  │
     │◀─ move-made {i:0.15} ──│── move-made {i:0.15} ─────▶│
     │                         │                              │
     │                         │◀─ make-move {cell:0} ──────│
     │                         │ Validate → Place O → Infer  │
     │◀─ move-made {i:0.30} ──│── move-made {i:0.30} ─────▶│
     │                         │                              │
     │         ...more moves with rising intensity...         │
     │                         │                              │
     │── make-move {cell:8} ─▶│                              │
     │                         │ Validate → Place X → WIN!   │
     │◀─ game-over {X wins} ──│── game-over {X wins} ─────▶│
     │                         │                              │
```

---

*— End of Specification —*
