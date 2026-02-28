# ADR-005: In-Memory State Management

**Status:** Accepted
**Date:** 2026-02-28

## Context

The game server needs to store active game rooms including board state, player assignments, move history, and intensity scores. The hackathon timeline constrains how much infrastructure complexity we can take on.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **In-memory Map** | Zero setup, sub-ms latency, no dependencies | Lost on restart, no horizontal scaling, no persistence |
| **Redis** | Fast, supports pub/sub for multi-process, persistent | Requires Redis instance, connection management, serialization |
| **SQLite** | Persistent, file-based, no server needed | Write latency, schema migrations, ORM overhead |
| **PostgreSQL** | Full ACID, scalable, rich queries | Heavy setup, connection pooling, migration tooling, overkill for hackathon |

## Decision

Store all game state in a **`Map<string, GameRoom>`** in the Node.js process memory. No database, no external state store.

```typescript
const rooms = new Map<string, GameRoom>();
```

### Cleanup Strategy

Stale rooms are removed by a periodic sweep interval:

- **Interval:** Every 60 seconds
- **Condition 1:** Both players disconnected and reconnection timeout (30s) has expired
- **Condition 2:** Room in `finished` status with no activity for 10 minutes

```typescript
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    const allDisconnected = Object.values(room.players)
      .every(p => !p.connected);
    const staleFinished = room.status === 'finished' &&
      (now - room.createdAt > 10 * 60 * 1000);
    if (allDisconnected || staleFinished) {
      rooms.delete(id);
    }
  }
}, 60_000);
```

## Consequences

**Positive:**
- Zero infrastructure setup — no database to provision, configure, or pay for
- Sub-millisecond read/write latency (direct memory access)
- No serialization/deserialization overhead
- Simple, debuggable — `rooms.get(id)` returns the full object
- Perfectly adequate for hackathon scope (few concurrent games)

**Negative:**
- All state lost on server restart or crash
- Cannot horizontally scale — state is process-local, not shared between instances
- No game history persistence for analytics or replays
- Memory grows with active rooms (mitigated by cleanup sweep)

### Future Migration Path

If scaling beyond hackathon, replace `Map` with Redis:
- `room-manager.ts` encapsulates all state access behind methods
- Swap the Map for Redis `get`/`set` calls with JSON serialization
- Minimal code changes due to encapsulated access pattern
