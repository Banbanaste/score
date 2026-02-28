# ADR-002: Real-Time Communication via Socket.IO

**Status:** Accepted
**Date:** 2026-02-28

## Context

The game requires low-latency bidirectional communication for player moves, turn changes, intensity updates, disconnect/reconnect handling, and room management. Several transport options exist for real-time browser-to-server communication.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Raw WebSockets** | Minimal overhead, native browser API | No reconnection logic, no room abstraction, no transport fallback, manual message framing |
| **Server-Sent Events (SSE)** | Simple, HTTP-native, auto-reconnect | Unidirectional (server→client only); client→server requires separate HTTP requests |
| **HTTP Polling** | Works everywhere, stateless | High latency (100ms+), inefficient for real-time gameplay, wastes bandwidth |
| **Socket.IO** | Reconnection, rooms, fallback transports, typed events | ~15KB client bundle, requires persistent server process |

## Decision

Use **Socket.IO 4.x** as the WebSocket abstraction layer.

Key capabilities used:
- **Rooms** — `io.to(roomId).emit(...)` broadcasts to all players in a game room
- **Reconnection** — automatic reconnect with exponential backoff when connection drops
- **Transport fallback** — degrades from WebSocket to HTTP long-polling if WebSocket is blocked
- **Typed events** — TypeScript event maps enforce payload shapes at compile time
- **Disconnect detection** — built-in `disconnect` event with reason codes

## Consequences

**Positive:**
- Built-in reconnection with exponential backoff (critical for mobile/flaky networks)
- Room-based broadcasting maps directly to game rooms (no manual socket tracking)
- Transport fallback ensures connectivity behind corporate proxies
- Mature ecosystem with extensive documentation

**Negative:**
- ~15KB client bundle overhead vs raw WebSockets (~0KB)
- Requires persistent server process (see ADR-001)
- Socket.IO protocol is not plain WebSocket — cannot use generic WS clients for testing
- Slightly higher latency than raw WebSockets due to protocol framing (~1-2ms)
