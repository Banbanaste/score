# Bounded Context: Room

Room lifecycle management — creation, player assignment, status transitions, reconnection, rematch, and cleanup.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Room** | Container for 2 players and their shared game state |
| **Room Code** | 6-character URL-safe identifier (generated via nanoid) for easy sharing |
| **Host** | First player to enter the room — always assigned mark `'X'` |
| **Guest** | Second player to join — always assigned mark `'O'` |
| **Session Token** | Server-generated random string identifying a player across reconnections |
| **Status** | Room lifecycle phase: `waiting`, `active`, or `finished` |
| **Grace Period** | 30-second window after disconnect before forfeit |
| **Rematch** | Both players agree to reset the board and play again in the same room |

## Aggregates

### GameRoom (Aggregate Root)

```typescript
interface GameRoom {
  id: string;                       // 6-char room code (nanoid)
  players: {
    [playerToken: string]: {        // keyed by session token
      mark: 'X' | 'O';
      socketId: string | null;      // null when disconnected
      connected: boolean;
    };
  };
  board: (null | 'X' | 'O')[];     // 9-cell array
  currentTurn: 'X' | 'O';
  status: 'waiting' | 'active' | 'finished';
  winner: null | 'X' | 'O' | 'draw';
  intensity: number;                // 0.0–1.0
  moveHistory: Move[];
  createdAt: number;
}
```

**Invariants:**
- Maximum 2 players per room
- Room code is unique across all active rooms
- Cannot transition to `active` until exactly 2 players are present
- Cannot accept moves unless status is `active`
- Host is always `'X'`, guest is always `'O'`

**Methods:**
- `createRoom()` — generate room code + host token, status = waiting
- `joinRoom(roomId)` — assign guest, generate token, status = active
- `disconnectPlayer(token)` — set socketId to null, start grace timer
- `reconnectPlayer(token, newSocketId)` — restore socketId, cancel timer
- `resetForRematch()` — clear board, swap starting player, status = active

## Value Objects

### PlayerIdentity

```typescript
interface PlayerIdentity {
  mark: 'X' | 'O';
  socketId: string | null;  // current socket (null = disconnected)
  connected: boolean;
}
```

Keyed by session token in the room's players map. Socket ID changes on reconnect; token remains stable.

### RoomStatus (Enum)

| Value | Meaning |
|-------|---------|
| `waiting` | Host connected, waiting for opponent |
| `active` | 2 players present, game in progress |
| `finished` | Game over — awaiting rematch or cleanup |

## State Machine

```
              create-room
                  |
                  v
            +---------+
            | WAITING |  Host connected, room code shared
            +----+----+
                 | join-room (2nd player)
                 v
            +---------+
            |  ACTIVE |  Game in progress
            +----+----+
                 | win / draw / forfeit
                 v
            +----------+
            | FINISHED |  Game over
            +-----+----+
                  | both players rematch
                  v
            +---------+
            |  ACTIVE |  Board reset, new round
            +---------+
```

## Domain Events

| Event | Trigger | Data |
|-------|---------|------|
| `RoomCreated` | Host creates a room | `{ roomId, playerToken, mark: 'X' }` |
| `PlayerJoined` | Guest joins the room | `{ roomId, playerToken, mark: 'O' }` |
| `PlayerDisconnected` | Socket connection lost | `{ roomId, disconnectedMark, timeout: 30000 }` |
| `PlayerReconnected` | Player rejoins within grace period | `{ roomId, reconnectedMark }` |
| `PlayerForfeited` | Grace period expired without reconnect | `{ roomId, forfeitedMark }` |
| `RematchRequested` | One player requests rematch | `{ roomId, requestedBy }` |
| `RematchStarted` | Both players requested rematch | `{ roomId, board, startingPlayer }` |
| `RoomCleaned` | Stale room removed from memory | `{ roomId, reason }` |

## Business Rules

1. **Host = X, Guest = O** — assignment is deterministic by join order
2. **Rematch requires both players** — single request is recorded, game resets only when both have requested
3. **Rematch swaps starting player** — if X started round 1, O starts round 2
4. **Disconnect grace period: 30 seconds** — opponent is notified, timer starts; if player reconnects within window, game resumes; if timer expires, disconnected player forfeits
5. **Reconnection via token** — player sends `{ roomId, playerToken }` on `rejoin-room`; server validates token exists in room, updates socketId, cancels timer, sends full game state to reconnecting player

## Cleanup Rules

Rooms are deleted from the in-memory Map by a 60-second sweep interval:

| Condition | Action |
|-----------|--------|
| Both players disconnected and grace period expired | Delete room |
| Room in `finished` status with no activity for 10 minutes | Delete room |

## Dependencies

- **Game Context** — embeds Board aggregate and Move history
- **Communication Context** — room events are translated to Socket.IO events by the handler layer
