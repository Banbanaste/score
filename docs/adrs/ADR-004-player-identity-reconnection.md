# ADR-004: Player Identity via Session Tokens

**Status:** Accepted
**Date:** 2026-02-28

## Context

Socket.IO assigns a new socket ID on every connection. When a player's connection drops and they reconnect, they get a different socket ID. If players are keyed by socket ID in the game room, a reconnecting player cannot reclaim their seat — they appear as a new, unknown socket.

The game needs stable player identity that survives connection drops within a grace period.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Socket ID as key** | Zero setup, built-in | Breaks on reconnect — new socket = new identity |
| **Cookie-based session** | Automatic browser persistence | Requires cookie middleware, CORS cookie config, server-side session store |
| **JWT authentication** | Cryptographic verification, standard pattern | Over-engineered for hackathon; no user accounts to authenticate |
| **Server-generated token** | Simple, stateless, survives reconnect | Must be stored client-side; no cryptographic guarantee (acceptable for hackathon) |

## Decision

Use **server-generated session tokens** as the primary player key:

1. On `create-room`: server generates a random token, returns it in `room-created` payload
2. On `join-room`: server generates a token, returns it in the response
3. Client stores token in `sessionStorage` (cleared when tab closes)
4. `GameRoom.players` is keyed by token, not socket ID
5. Each player record stores `socketId: string | null` (null when disconnected)
6. On `rejoin-room`: client sends `{ roomId, playerToken }`, server validates token, updates `socketId` to new socket

### Reconnection Flow

```
1. Player disconnects (network drop, page refresh)
2. Server: set player.socketId = null, player.connected = false
3. Server: start 30-second timer, notify opponent via player-disconnected
4. Player reconnects, emits rejoin-room { roomId, playerToken }
5. Server: validate token exists in room.players
6. Server: update socketId to new socket, connected = true
7. Server: cancel timer, emit player-reconnected to opponent
8. Server: emit game-state to rejoining player (full board sync)
```

### Token Generation

```typescript
import { randomBytes } from 'crypto';
const token = randomBytes(16).toString('hex'); // 32-char hex string
```

## Consequences

**Positive:**
- Players can reconnect after network drops without losing their seat
- Decouples player identity from Socket.IO socket lifecycle
- Simple implementation — no session store, no cookies, no JWT verification
- 30-second grace period covers brief network interruptions

**Negative:**
- Token is lost on page refresh if sessionStorage is cleared (acceptable for hackathon)
- No cryptographic guarantee — a leaked token allows seat hijacking (acceptable given no auth)
- Token is in-memory only on the server — lost on server restart (see ADR-005)
