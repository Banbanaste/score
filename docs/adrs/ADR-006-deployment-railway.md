# ADR-006: Deployment on Railway

**Status:** Accepted
**Date:** 2026-02-28

## Context

The server architecture (ADR-001) requires a persistent, long-running Node.js process that holds WebSocket connections (ADR-002) and in-memory game state (ADR-005). This rules out serverless platforms.

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Vercel** | Free tier, automatic CI/CD, global CDN, Next.js-native | Serverless functions are stateless and short-lived — cannot hold WebSocket connections or in-memory state |
| **Railway** | Persistent processes, WebSocket support, simple env vars, reasonable free tier | Single-region, no automatic global CDN, less generous free tier than Vercel |
| **Fly.io** | Global edge deployment, persistent VMs, WebSocket support | More complex config (Dockerfile, fly.toml), overkill for hackathon |
| **Render** | Persistent processes, WebSocket support | Slower cold starts on free tier, limited build minutes |

## Decision

Deploy to **Railway.app** with persistent process hosting.

### Configuration

```json
// package.json scripts
{
  "dev": "tsx server.ts",
  "build": "next build && tsc --project tsconfig.server.json",
  "start": "node dist/server.js"
}
```

```
Railway settings:
  Build Command:   npm run build
  Start Command:   npm run start
```

### Environment Variables (set in Railway dashboard)

| Variable | Required | Value |
|----------|----------|-------|
| `GEMINI_API_KEY` | Yes | Google AI API key |
| `PORT` | No | Railway auto-assigns |
| `NODE_ENV` | No | `production` |
| `CLIENT_ORIGIN` | No | Railway-assigned domain URL |

### Why Not Vercel

Vercel deploys Next.js as serverless functions:
- Functions spin up per-request and shut down after ~10s idle
- No persistent memory between invocations (Map is empty each time)
- No long-lived WebSocket connections (Socket.IO requires persistent socket)
- No custom server entry point support in serverless mode

## Consequences

**Positive:**
- Railway supports persistent Node.js processes natively
- WebSocket traffic works out of the box (no special proxy config)
- Simple environment variable management via dashboard
- Automatic HTTPS with custom domains
- GitHub integration for automatic deploys on push

**Negative:**
- Single-region deployment (latency for geographically distant players)
- No automatic global CDN edge deployment for static assets
- Less generous free tier than Vercel ($5/month hobby plan after trial)
- Requires `tsconfig.server.json` for server compilation (see ADR-001)
