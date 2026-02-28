# Bounded Context: Communication

Socket.IO event contracts — the anti-corruption layer between the transport layer and the domain. Defines every event name, direction, typed payload, and error code.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Event** | Named message with a typed JSON payload sent over Socket.IO |
| **Client-to-Server Event** | Player action emitted from the browser to the server |
| **Server-to-Client Event** | State update or notification broadcast from server to browser |
| **Unicast** | Event sent to a single socket (e.g., `error`, `room-created`) |
| **Room Broadcast** | Event sent to all sockets in a Socket.IO room (e.g., `move-made`) |
| **Anti-Corruption Layer** | The socket handler module that translates events to domain calls and domain results back to events |

## Event Contracts

### Client -> Server Events

#### `create-room`
```typescript
interface CreateRoomPayload {
  playerName?: string;
}
```
**Action:** Generate room code (nanoid, 6 chars) + session token, create GameRoom, assign player as X, join Socket.IO room. Emit `room-created` to sender.

#### `join-room`
```typescript
interface JoinRoomPayload {
  roomId: string;
  playerName?: string;
}
```
**Action:** Validate room exists and has space, generate session token, assign player as O, join Socket.IO room, set status to `active`. Emit `game-start` to room (include `playerToken` in response to joining player).

#### `make-move`
```typescript
interface MakeMovePayload {
  roomId: string;
  cell: number;       // 0–8
}
```
**Action:** Run 6-step validation pipeline. Place mark, compute intensity, check win/draw. Emit `move-made` to room. If game over, emit `game-over` to room.

#### `rematch`
```typescript
interface RematchPayload {
  roomId: string;
}
```
**Action:** Record rematch request. When both players have requested: reset board, swap starting player, status = active. Emit `game-start` to room.

#### `rejoin-room`
```typescript
interface RejoinRoomPayload {
  roomId: string;
  playerToken: string;
}
```
**Action:** Validate token exists in room.players. Update socketId to new socket, set connected = true, cancel disconnect timer. Emit `player-reconnected` to opponent. Emit `game-state` to rejoining player.

#### `disconnect`
Built-in Socket.IO event (automatic on connection drop).

**Action:** Mark player as disconnected (socketId = null). Emit `player-disconnected` to opponent. Start 30-second timer — if expired, forfeit and emit `game-over`.

---

### Server -> Client Events

#### `room-created`
```typescript
interface RoomCreatedPayload {
  roomId: string;
  mark: 'X';
  playerToken: string;
}
```
**Target:** Sender only (unicast).

#### `game-start`
```typescript
interface GameStartPayload {
  roomId: string;
  board: (null | 'X' | 'O')[];
  currentTurn: 'X' | 'O';
  players: Record<string, { mark: 'X' | 'O' }>;
  intensity: 0;
  playerToken?: string;  // included for joining player only
}
```
**Target:** All players in room (broadcast).

#### `move-made`
```typescript
interface MoveMadePayload {
  board: (null | 'X' | 'O')[];
  cell: number;
  mark: 'X' | 'O';
  currentTurn: 'X' | 'O';
  intensity: number;
  moveNumber: number;
}
```
**Target:** All players in room (broadcast).

#### `game-over`
```typescript
interface GameOverPayload {
  winner: 'X' | 'O' | 'draw';
  winningCells?: number[];
  board: (null | 'X' | 'O')[];
  finalIntensity: number;
}
```
**Target:** All players in room (broadcast).

#### `error`
```typescript
interface ErrorPayload {
  code: string;
  message: string;
}
```
**Target:** Sender only (unicast).

#### `player-disconnected`
```typescript
interface PlayerDisconnectedPayload {
  disconnectedMark: 'X' | 'O';
  timeout: number;          // milliseconds until forfeit (default 30000)
}
```
**Target:** Remaining player in room (unicast).

#### `player-reconnected`
```typescript
interface PlayerReconnectedPayload {
  reconnectedMark: 'X' | 'O';
}
```
**Target:** Remaining player in room (unicast).

#### `game-state`
```typescript
interface GameStatePayload {
  roomId: string;
  board: (null | 'X' | 'O')[];
  currentTurn: 'X' | 'O';
  mark: 'X' | 'O';           // the rejoining player's mark
  intensity: number;
  status: 'waiting' | 'active' | 'finished';
  moveHistory: Move[];
}
```
**Target:** Reconnecting player only (unicast). Full state sync for UI rebuild.

## Error Codes

All errors are unicast to the socket that triggered the error.

| Code | Message | Triggered By |
|------|---------|-------------|
| `ROOM_NOT_FOUND` | Room does not exist | `join-room`, `make-move`, `rejoin-room` |
| `ROOM_FULL` | Room already has two players | `join-room` |
| `GAME_NOT_ACTIVE` | Game is not in active state | `make-move` |
| `NOT_YOUR_TURN` | It is not your turn | `make-move` |
| `INVALID_CELL` | Cell index out of range (0–8) | `make-move` |
| `CELL_OCCUPIED` | Cell is already occupied | `make-move` |
| `ALREADY_IN_ROOM` | Player is already in a room | `create-room`, `join-room` |
| `INVALID_TOKEN` | Session token does not match any player in room | `rejoin-room` |
| `RECONNECT_EXPIRED` | Reconnection window has expired | `rejoin-room` |
| `INFERENCE_FAILED` | Intensity analysis failed (non-blocking, internal) | `make-move` |

## Anti-Corruption Layer

The socket handler module (`src/socket/handlers.ts`) is the boundary between the transport layer (Socket.IO) and the domain layer (Game, Room, Inference contexts).

**Responsibilities:**
- Translate incoming Socket.IO events into domain method calls
- Translate domain results into outgoing Socket.IO event payloads
- Handle error mapping (domain errors → error codes → ErrorPayload)
- Manage Socket.IO room joins/leaves

**Rules:**
- Domain modules NEVER import Socket.IO types
- Socket handlers NEVER contain game logic (validation, win detection, intensity calculation)
- All domain calls are synchronous or awaited — handlers manage the async boundary

```
Client Socket  ──event──▶  Handler  ──call──▶  Domain
                           Layer     ◀──result──  Layer
Client Socket  ◀──emit───  Handler
```

## Dependencies

- **Room Context** — room lifecycle events (create, join, disconnect, reconnect)
- **Game Context** — move validation, win detection
- **Inference Context** — intensity scoring (called during move processing)
