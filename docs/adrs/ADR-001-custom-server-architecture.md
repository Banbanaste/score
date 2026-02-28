# ADR-001: Custom Server Architecture

**Status:** Accepted
**Date:** 2026-02-28

## Context

The game requires bidirectional real-time communication (Socket.IO) alongside standard HTTP page serving (Next.js). By default, Next.js runs as a standalone HTTP server (or serverless functions on Vercel), with no facility for attaching a WebSocket server to the same process.

We need both the Next.js request handler and the Socket.IO WebSocket server to share a single HTTP server on a single port, running as a persistent Node.js process.

## Decision

Create a custom `server.ts` entry point that:

1. Creates an HTTP server via `http.createServer()`
2. Initializes the Next.js app and obtains its request handler
3. Attaches Socket.IO to the same HTTP server instance
4. Registers all Socket.IO event handlers (game logic)
5. Routes all non-WebSocket HTTP requests to the Next.js handler
6. Listens on a single port (default 3000)

The custom server replaces the default `next start` command. A separate `tsconfig.server.json` compiles `server.ts` and its `src/` imports into `dist/` for production.

```
server.ts  →  http.createServer()
                ├── Next.js handler (HTTP requests)
                └── Socket.IO server (WebSocket connections)
```

## Consequences

**Positive:**
- Single process simplifies deployment and debugging
- Shared port eliminates cross-origin WebSocket complexity
- Full control over server lifecycle, middleware ordering, and shutdown hooks
- Socket.IO rooms map naturally to game rooms

**Negative:**
- Cannot deploy to Vercel or any serverless platform (requires persistent process)
- Requires a dedicated `tsconfig.server.json` build step
- Custom server disables some Next.js optimizations (automatic static optimization still works, but middleware runs differently)
- Single point of failure — if the process crashes, all active games are lost
