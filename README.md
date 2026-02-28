# SCORE IS LIVE CHECK OUT THE WEBSITE!

https://clever-gratitude-production.up.railway.app/

Real-time multiplayer Tic-Tac-Toe with AI-powered intensity scoring, per-player morale tracking, and FIFA-style live commentary. Best-of-5 series format where tension compounds across rounds.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20+ |
| Framework | Next.js | 16.1.6 |
| Frontend | React | 19 |
| Styling | Tailwind CSS | 4.x |
| WebSocket | Socket.IO | 4.8.3 |
| AI Inference | Google Gemini | `@google/genai` (gemini-2.5-flash-lite) |
| TTS | Web Speech API | Native browser |
| Language | TypeScript | 5.x |

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- A [Google AI Studio](https://aistudio.google.com/apikey) API key (free tier)

### Setup

```bash
# Clone and install
git clone <repo-url>
cd retro-space
pnpm install

# Configure environment
cp .env.example .env   # or create .env manually
```

Add your Gemini API key to `.env`:

```env
GEMINI_API_KEY=your_key_here
```

### Run

```bash
# Development (custom server with Socket.IO + Next.js hot reload)
pnpm dev

# Open two browser tabs to http://localhost:3000
# Tab 1: Create Room -> copy room code
# Tab 2: Join Room -> paste code
```

### Build & Deploy

```bash
# Build (Next.js client + compiled server)
pnpm build

# Production
pnpm start
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | **Yes** | -- | Google AI API key for all inference |
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `CLIENT_ORIGIN` | No | `http://localhost:3000` | CORS origin for Socket.IO |
| `INFERENCE_TIMEOUT` | No | `3000` | Gemini timeout for intensity/morale (ms) |
| `NARRATION_TIMEOUT` | No | `5000` | Gemini timeout for narration (ms) |
| `NARRATION_ENABLED` | No | `true` | Kill switch for narration pipeline |
| `RECONNECT_TIMEOUT` | No | `30000` | Disconnect grace period before forfeit (ms) |

---

## Architecture Overview

### Server Design

Single Node.js process serving both Next.js pages and Socket.IO WebSocket connections. This enables real-time gameplay without a separate WebSocket server.

```
server.ts
  |-- http.createServer()
  |-- next() handler  ->  serves pages, static assets
  +-- Socket.IO server  ->  real-time game events
```

> Requires a persistent-process host (Railway, Render, etc). Cannot deploy to Vercel (no WebSocket support in serverless).

### Project Structure

```
retro-space/
|-- server.ts                          # Entry point: Next.js + Socket.IO on one process
|-- src/
|   |-- app/                           # Next.js App Router
|   |   |-- page.tsx                   # Home: Create/Join room
|   |   +-- game/[roomId]/page.tsx     # Game UI: board, meters, narration
|   |-- components/                    # React components (11 files)
|   |   |-- game-board.tsx             # 3x3 grid with click handlers
|   |   |-- intensity-meter.tsx        # Horizontal tension bar
|   |   |-- morale-indicator.tsx       # Per-player morale bars
|   |   |-- narrator-subtitle.tsx      # Commentary text overlay
|   |   |-- crowd-emojis.tsx           # Reactive emoji crowd
|   |   |-- series-scoreboard.tsx      # Round indicator, win dots (best-of-5)
|   |   |-- round-result-overlay.tsx   # Between-round result modal
|   |   |-- series-result.tsx          # Series completion stats
|   |   +-- ...                        # connection-status, game-status, debug panel
|   |-- hooks/
|   |   |-- use-socket.tsx             # Singleton Socket.IO connection
|   |   +-- use-narrator.ts            # TTS speech queue (Web Speech API)
|   |-- game/                          # Server-side domain logic
|   |   |-- types.ts                   # Shared types (Board, GameRoom, Series, Narration)
|   |   |-- engine.ts                  # Pure game logic: validation, win detection
|   |   |-- room-manager.ts            # Room CRUD, series lifecycle, cleanup
|   |   +-- logger.ts                  # Structured ANSI logger
|   |-- inference/                     # AI pipelines
|   |   |-- gemini.ts                  # Gemini API client (intensity + morale)
|   |   |-- intensity.ts               # Heuristic intensity + series pressure
|   |   |-- morale.ts                  # Per-player morale computation (9 functions)
|   |   +-- narrator.ts                # FIFA-style narration generation
|   +-- socket/
|       +-- handlers.ts                # All Socket.IO event handlers
|-- docs/
|   |-- specs/                         # Feature specifications
|   |-- adrs/                          # Architecture Decision Records (ADR-001 to ADR-010)
|   +-- ddd/                           # Domain-Driven Design bounded contexts
+-- tsconfig.server.json               # Server-only TypeScript config
```

---

## Game Flow

### Series Lifecycle (Best-of-5)

```
Create Room -> Join Room -> Series Start
  |
  |-- Round 1 (X starts)
  |     |-- Players alternate moves
  |     |-- Win/Draw detected -> round-over
  |     +-- 3-second pause -> Round 2
  |
  |-- Round 2 (O starts)
  |     +-- ...
  |
  |-- ... Rounds 3-5 (alternating first move)
  |
  +-- First to 3 wins -> Series Over
        |-- Show final stats (peak intensity, morale, rounds)
        +-- "New Series" button (both players must agree)
```

### Within a Round

```
Player clicks cell
  |-- Validate (turn, cell empty, game active)
  |-- Place marker on board
  |-- Compute heuristic intensity + morale (instant, ~0ms)
  |-- Check win/draw
  |-- emit 'move-made' -> UI updates immediately
  |
  +-- Background pipelines (parallel, non-blocking):
      |-- getIntensity()   -> Gemini (~500ms, 3s timeout)
      |     +-- emit 'intensity-update' -> upgrades heuristic value
      +-- getNarration()   -> Gemini (~1-2s, 5s timeout)
            +-- emit 'narration-update' -> subtitle + TTS
```

No AI pipeline ever blocks gameplay. Moves feel instant. AI enrichment arrives asynchronously.

---

## AI Systems

### 1. Intensity (0.0 to 1.0)

Measures objective tension of the game state.

**Dual-mode pipeline:**
- **Primary:** Gemini API analysis of board + series context
- **Fallback:** Deterministic heuristic (board fill, threats, forks, center control)

**Series pressure** amplifies board intensity across rounds:

| Factor | Range | Example |
|--------|-------|---------|
| Round weight | 0.00-0.20 | Round 5 = 0.20 |
| Score closeness | 0.00-0.30 | Tied 2-2 = 0.30 |
| Elimination pressure | 0.00-0.30 | Match point = 0.20-0.30 |

```
finalIntensity = clamp(boardIntensity * (1 + seriesPressure), 0, 1)
```

The same fork in Round 1 reads 0.65. In Round 5 at 2-2, it reads 1.00.

### 2. Morale (-1.0 to +1.0 per player)

Measures each player's subjective emotional state.

```
morale[player] = boardMorale * 0.6 + seriesMorale * 0.4
```

**Board factors (60%):** Threat advantage, turn agency, defensive pressure, position strength.

**Series factors (40%):** Series lead, momentum (last round result), match point, comeback potential.

### 3. Narrator (FIFA-Style Commentary)

Every game event gets a short commentary line (max 15 words), delivered via text subtitle and Web Speech API TTS.

**5 trigger points:**

| Trigger | When | Example |
|---------|------|---------|
| `move` | Every move placed | "X takes the center. Bold opening." |
| `round-over` | Round ends | "X takes the round! Series lead, two to one." |
| `round-start` | New round begins | "Round 4. O to serve. Everything to play for." |
| `series-over` | Series decided | "And that's the series! O wins it three-two!" |
| `match-point` | Player reaches 2 wins | "Match point for X. One round from glory." |

**Tone adapts to intensity:**

| Tone | Intensity | TTS Rate | TTS Pitch | Style |
|------|-----------|----------|-----------|-------|
| `calm` | 0.0-0.3 | 0.9 | 1.0 | Relaxed, measured |
| `building` | 0.3-0.6 | 1.0 | 1.0 | Engaged, normal |
| `tense` | 0.6-0.8 | 1.05 | 1.1 | Faster, higher |
| `explosive` | 0.8-1.0 | 1.1 | 1.2 | Urgent, elevated |

---

## Gemini Prompts

### Intensity + Morale System Prompt

```
You are a game-state analyzer for Tic-Tac-Toe.
Analyze the board and return a JSON object with:
- 'intensity' (float, 0.0 to 1.0): the current tension/drama
- 'morale_X' (float, -1.0 to +1.0): player X's emotional state
- 'morale_O' (float, -1.0 to +1.0): player O's emotional state

Intensity scoring:
- 0.0-0.2: Opening moves, no threats
- 0.2-0.4: Early positioning, center/corner control
- 0.4-0.6: Developing threats, building toward a line
- 0.6-0.8: Imminent threat, must block or lose
- 0.8-1.0: Fork, forced outcome, decisive move

Series amplification:
- Later rounds are more tense
- Tied series (2-2) dramatically increases tension
- Match point raises stakes

Morale factors:
- Threat advantage boosts morale; defending under pressure lowers it
- Turn control gives a slight morale edge
- Series lead increases confidence; being behind lowers it
- Momentum from winning/losing the last round
```

**User prompt includes:** Board array, current turn, move number, round/series score, match point status, threat counts per player, last round winner.

### Narrator System Prompt

```
You are a FIFA-style sports commentator for a Tic-Tac-Toe match.

Rules:
- Maximum 15 words. Shorter is better.
- Professional, neutral, observational tone.
- Never give strategic advice. Only observe and react.
- Reference specific moves ("X takes center", "O blocks the diagonal").
- Vary your language. Don't repeat phrases from recent commentary.

Tone guidance:
- Low (0.0-0.3): "X opens on the corner." "Quiet start."
- Medium (0.3-0.6): "O builds toward the diagonal." "Pressure mounting."
- High (0.6-0.8): "X must block! The diagonal is wide open."
- Critical (0.8-1.0): "A fork! Two paths to victory!" "This is it!"

Return: { "narration": "your line here" }
```

**User prompt includes:** Board, last move, move number, intensity, morale, series score, match point, previous narration (for variety), trigger type.

---

## Socket.IO Event Contract

### Client to Server

| Event | Payload | Description |
|-------|---------|-------------|
| `create-room` | `{}` | Create room, become X |
| `join-room` | `{ roomId }` | Join room, become O |
| `make-move` | `{ roomId, cell }` | Place mark (cell 0-8) |
| `new-series` | `{ roomId }` | Request rematch |
| `rejoin-room` | `{ roomId, playerToken }` | Reconnect after disconnect |

### Server to Client

| Event | Payload | Description |
|-------|---------|-------------|
| `room-created` | `{ roomId, mark, playerToken }` | Room created |
| `game-start` | `{ board, currentTurn, intensity, morale, series }` | Both players joined |
| `move-made` | `{ board, cell, mark, currentTurn, intensity, morale }` | Move placed |
| `intensity-update` | `{ intensity, source, moveNumber, morale }` | Gemini result arrived |
| `narration-update` | `{ text, moveNumber, trigger, intensity, tone }` | Commentary line |
| `round-over` | `{ round, winner, winningCells, finalIntensity, series, nextRoundIn }` | Round ended |
| `round-start` | `{ round, board, currentTurn, series, intensity, morale }` | New round |
| `series-over` | `{ seriesWinner, finalScore, rounds, totalMoves, peakIntensity }` | Series decided |
| `game-state` | `{ board, currentTurn, mark, intensity, morale, status, series }` | Full sync on reconnect |
| `player-disconnected` | `{ disconnectedMark, timeout }` | Opponent dropped |
| `player-reconnected` | `{ reconnectedMark }` | Opponent returned |
| `error` | `{ code, message }` | Error |

---

## Key Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| ADR-001 | Server architecture | Custom `server.ts` (Next.js + Socket.IO) | Single process, single port, WebSocket support |
| ADR-002 | Real-time transport | Socket.IO | Auto-reconnection, room abstraction, fallback polling |
| ADR-003 | Inference pipeline | Non-blocking dual-mode (Gemini + heuristic) | Never blocks gameplay; graceful degradation |
| ADR-004 | Player identity | Session token (not socket ID) | Survives disconnects; 30s reconnection window |
| ADR-005 | State storage | In-memory `Map` | Hackathon scope; no database overhead |
| ADR-006 | Deployment target | Railway | Persistent process for WebSockets |
| ADR-007 | Narration pipeline | Separate Gemini call (parallel) | Independent from intensity; different timeout |
| ADR-008 | TTS engine | Web Speech API (browser native) | Zero deps, instant, swappable to Google Cloud TTS |
| ADR-009 | Narration frequency | Every event (adaptive length) | Silence feels broken; short lines at low intensity |
| ADR-010 | Narrator personality | FIFA-style neutral commentator | Professional, observational, scales with tension |

---

## NPM Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx server.ts` | Development with hot reload |
| `dev:next` | `next dev` | Next.js only (no Socket.IO, for UI work) |
| `build` | `next build && tsc --project tsconfig.server.json` | Production build |
| `start` | `node dist/server.js` | Run production server |
| `lint` | `eslint` | Code quality check |

---

## Deployment (Railway)

```bash
# Railway auto-detects:
# Build: pnpm build
# Start: pnpm start
# Port: $PORT (auto-assigned)

# Required env vars in Railway dashboard:
GEMINI_API_KEY=your_key
CLIENT_ORIGIN=https://your-app.railway.app
```

---

## Codebase Stats

| Category | Lines | Files |
|----------|-------|-------|
| Server domain logic | 643 | 4 (types, engine, room-manager, logger) |
| Inference pipelines | 883 | 4 (gemini, intensity, morale, narrator) |
| Socket handlers | 657 | 1 |
| Client components | 1,024 | 11 |
| Client hooks + pages | 459 | 4 |
| **Total TypeScript** | **~3,500** | **24 files** |
| Documentation | 2,000+ | 16 files (specs, ADRs, DDDs) |
