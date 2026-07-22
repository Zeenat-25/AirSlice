# AirSlice — Technical Design Document (TDD)

**Version:** 1.0
**Status:** Draft for review
**Based on:** AirSlice PDD v1.0
**Author:** Engineering Design

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Overall System Architecture](#2-overall-system-architecture)
3. [Tech Stack & Rationale](#3-tech-stack--rationale)
4. [Folder Structure](#4-folder-structure)
5. [Database Requirements](#5-database-requirements)
6. [Real-Time Communication Architecture](#6-real-time-communication-architecture)
7. [Device Pairing Flow (QR + Room Management)](#7-device-pairing-flow-qr--room-management)
8. [Motion Sensor Data Flow](#8-motion-sensor-data-flow)
9. [Sword Movement & Motion-Mapping Logic](#9-sword-movement--motion-mapping-logic)
10. [Fruit Spawning, Collision Detection & Game Loop](#10-fruit-spawning-collision-detection--game-loop)
11. [State Management](#11-state-management)
12. [API Endpoints](#12-api-endpoints)
13. [Socket.IO Event Structure](#13-socketio-event-structure)
14. [Security Considerations](#14-security-considerations)
15. [Performance Optimization](#15-performance-optimization)
16. [Deployment Architecture](#16-deployment-architecture)
17. [Development Roadmap & Milestones](#17-development-roadmap--milestones)
18. [Future Scalability](#18-future-scalability)

---

## 1. System Overview

AirSlice consists of **two logical clients sharing one game session**, coordinated through a **stateful backend**:

- **Display Client** — runs the actual game (Phaser.js canvas) on a laptop/desktop/TV browser.
- **Controller Client** — a lightweight mobile web page that reads phone motion sensors and streams orientation data.
- **Backend Server** — owns room lifecycle, relays motion data with minimal latency, and (in later milestones) can own authoritative game state for anti-cheat/multiplayer.

The two browser tabs never talk to each other directly (no WebRTC in v1, see §18) — everything is relayed through a single Socket.IO server, which keeps the pairing model simple, works behind NATs/firewalls without STUN/TURN, and matches the <100ms latency target for same-network or low-hop scenarios.

---

## 2. Overall System Architecture

```
┌────────────────────────┐                        ┌────────────────────────┐
│   DISPLAY CLIENT        │                        │   CONTROLLER CLIENT     │
│   (Laptop / TV Browser) │                        │   (Phone Browser)       │
│                          │                        │                         │
│  Next.js + Phaser.js     │                        │  Next.js (mobile view)  │
│  - Renders game canvas   │                        │  - Requests motion      │
│  - Displays QR code      │                        │    permission           │
│  - Subscribes to         │                        │  - Reads Accelerometer/ │
│    controller:motion     │                        │    Gyroscope            │
│  - Runs game loop         │                        │  - Emits motion deltas  │
└────────────┬─────────────┘                        └────────────┬────────────┘
             │  Socket.IO (WSS)                                  │  Socket.IO (WSS)
             │  room:join, sword:update                          │  motion:stream
             ▼                                                    ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                     BACKEND (Node.js)                          │
        │  ┌───────────────┐  ┌────────────────┐  ┌────────────────────┐│
        │  │ Express (HTTP) │  │ Socket.IO Server│  │ Room Manager (Redis│
        │  │ - /api/room    │  │ - namespaces    │  │  or in-memory)      ││
        │  │ - /api/health  │  │ - event routing │  │ - room TTL          ││
        │  └───────────────┘  └────────────────┘  └────────────────────┘│
        └───────────────────────────────────────────────────────────────┘
```

**Key architectural decision:** the backend is a **relay + room authority**, not (in v1) a full authoritative game server. Fruit spawning, physics, and scoring run **client-side on the Display Client** for simplicity and to hit the 60 FPS / low-latency target. The backend's only real-time job is forwarding motion packets from Controller → Display with minimal processing. This keeps v1 lean; §18 covers migrating scoring/physics server-side for competitive multiplayer.

---

## 3. Tech Stack & Rationale

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | **Next.js 14 (App Router)** | File-based routing gives us `/` (display) and `/controller/[roomId]` as distinct, independently optimized routes; SSR for fast first paint on the landing page; easy Vercel deployment matching PDD §10. |
| Game rendering | **Phaser.js 3** | Purpose-built 2D game engine with scene management, physics (Arcade Physics is enough for fruit trajectories), sprite/particle systems, and a proven track record for browser slicing games. Avoids reinventing a render loop. |
| Styling | **Tailwind CSS** | Fast to build a clean, modern UI for landing/pairing/game-over screens without a separate design system; keeps controller UI lightweight (important — controller page must load instantly from a QR scan on possibly-slow mobile data). |
| Real-time transport | **Socket.IO (client + server)** | Automatic fallback to long-polling if WebSocket is blocked (important for varied network/firewall conditions at events/exhibitions), built-in room support, reconnection handling, and acknowledgement callbacks — all reduce custom infra work vs raw `ws`. |
| Backend runtime | **Node.js + Express** | Express only serves a couple of REST endpoints (room creation, health checks) and hosts the Socket.IO server; minimal footprint, huge ecosystem, same language as frontend (shared types possible via a `shared/` package). |
| Room state store | **Redis (production) / in-memory Map (local dev)** | Rooms are short-lived and small, but production needs a store that survives a single backend process restart and — critically — **supports horizontal scaling** of the Socket.IO server (Redis adapter for Socket.IO enables multi-instance pub/sub). In-memory is fine for local dev and small deployments. |
| QR generation | **`qrcode` npm package (server or client-side)** | Generates a QR code from the room-join URL entirely in-browser/in-request, no third-party API dependency or rate limits. |
| Audio | **Howler.js** | Reliable cross-browser audio playback with sprite support (one audio file, multiple sound effects), better mobile Safari behavior than raw `<audio>`. |
| Motion sensing API | **`DeviceOrientationEvent` / `DeviceMotionEvent`** (native browser APIs) | No SDK needed; requires explicit permission flow on iOS 13+ (handled in §8). |
| Deployment (frontend) | **Vercel** | Matches PDD; native Next.js support, edge caching for static assets, automatic HTTPS (required for motion sensor APIs, which only work on secure contexts). |
| Deployment (backend) | **Railway or Render** | Persistent Node process required for Socket.IO (unlike serverless functions, which don't hold long-lived WebSocket connections well); both offer easy Redis add-ons. |
| Monitoring/errors | **Sentry (frontend + backend)** | Needed to catch real-world device/browser motion-API quirks post-launch. |

---

## 4. Folder Structure

### Monorepo layout (recommended)

Using a monorepo keeps shared types (Socket.IO event contracts, game constants) in sync between frontend and backend — critical since motion payload shape and event names must match exactly.

```
airslice/
├── apps/
│   ├── web/                          # Next.js app (Display + Controller clients)
│   │   ├── app/
│   │   │   ├── page.tsx              # Landing page ("Play" button)
│   │   │   ├── layout.tsx
│   │   │   ├── globals.css
│   │   │   ├── room/
│   │   │   │   └── [roomId]/
│   │   │   │       └── page.tsx      # Display client: pairing screen → game screen
│   │   │   └── controller/
│   │   │       └── [roomId]/
│   │   │           └── page.tsx      # Controller client (mobile)
│   │   │
│   │   ├── components/
│   │   │   ├── display/
│   │   │   │   ├── QRPairing.tsx
│   │   │   │   ├── GameCanvas.tsx    # Mounts Phaser instance
│   │   │   │   ├── HUD.tsx           # Score, lives, combo overlay
│   │   │   │   └── GameOverScreen.tsx
│   │   │   ├── controller/
│   │   │   │   ├── PermissionGate.tsx
│   │   │   │   ├── CalibrationButton.tsx
│   │   │   │   └── ConnectionStatus.tsx
│   │   │   └── shared/
│   │   │       ├── Button.tsx
│   │   │       └── Loader.tsx
│   │   │
│   │   ├── game/                     # Phaser-specific code (framework-agnostic core)
│   │   │   ├── scenes/
│   │   │   │   ├── BootScene.ts
│   │   │   │   ├── GameScene.ts
│   │   │   │   └── GameOverScene.ts
│   │   │   ├── entities/
│   │   │   │   ├── Fruit.ts
│   │   │   │   ├── Bomb.ts
│   │   │   │   └── Sword.ts
│   │   │   ├── systems/
│   │   │   │   ├── SpawnSystem.ts
│   │   │   │   ├── CollisionSystem.ts
│   │   │   │   ├── ComboSystem.ts
│   │   │   │   └── MotionMapper.ts   # Converts raw motion → sword screen coords
│   │   │   └── config/
│   │   │       └── gameConfig.ts
│   │   │
│   │   ├── hooks/
│   │   │   ├── useSocket.ts
│   │   │   ├── useRoom.ts
│   │   │   ├── useMotionSensor.ts
│   │   │   └── useGameState.ts
│   │   │
│   │   ├── lib/
│   │   │   ├── socketClient.ts
│   │   │   ├── api.ts                # fetch wrapper for REST calls
│   │   │   └── motionSmoothing.ts    # low-pass filter utils
│   │   │
│   │   ├── store/                    # Zustand stores
│   │   │   ├── gameStore.ts
│   │   │   ├── roomStore.ts
│   │   │   └── controllerStore.ts
│   │   │
│   │   ├── public/
│   │   │   ├── audio/
│   │   │   └── sprites/
│   │   │
│   │   ├── next.config.js
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   └── server/                       # Node.js backend
│       ├── src/
│       │   ├── index.ts              # Entry point: HTTP + Socket.IO bootstrap
│       │   ├── app.ts                # Express app (REST routes)
│       │   ├── socket/
│       │   │   ├── index.ts          # Socket.IO server init + Redis adapter
│       │   │   ├── handlers/
│       │   │   │   ├── roomHandlers.ts
│       │   │   │   ├── motionHandlers.ts
│       │   │   │   └── gameHandlers.ts
│       │   │   └── middleware/
│       │   │       └── socketAuth.ts # room-token validation
│       │   ├── rooms/
│       │   │   ├── RoomManager.ts
│       │   │   ├── Room.ts
│       │   │   └── roomStore.ts      # Redis or in-memory adapter
│       │   ├── routes/
│       │   │   ├── roomRoutes.ts     # POST /api/room, GET /api/room/:id
│       │   │   └── healthRoutes.ts
│       │   ├── utils/
│       │   │   ├── qrGenerator.ts
│       │   │   ├── roomCodeGenerator.ts
│       │   │   └── logger.ts
│       │   └── config/
│       │       └── env.ts
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── shared/                       # Shared between web and server
│       ├── src/
│       │   ├── socketEvents.ts       # Typed event name constants + payload types
│       │   ├── gameTypes.ts          # Fruit, Room, Player, ScoreEvent types
│       │   └── constants.ts          # ROOM_CODE_LENGTH, TICK_RATE, etc.
│       └── package.json
│
├── package.json                      # workspaces root
├── turbo.json                        # Turborepo pipeline (optional but recommended)
└── README.md
```

**Why a shared package:** Socket.IO event names and payload shapes are the contract between two independently deployed apps. Without a shared `socketEvents.ts`, it's easy for frontend and backend to silently drift (e.g., renaming `motion:update` to `motion:stream` on one side only). TypeScript + a shared package catches this at compile time.

---

## 5. Database Requirements

### v1 (MVP) — No persistent database required

Game rooms are ephemeral (minutes-long sessions), so v1 uses:

- **Redis** (or in-memory store for local/small deployments) as a **transient room store**, not a database:
  - Key: `room:{roomCode}` → `{ roomId, displaySocketId, controllerSocketId, createdAt, status }`
  - TTL: auto-expire rooms after e.g. 10 minutes of inactivity to avoid leaks.
  - Reason for Redis over in-memory in production: enables **multi-instance backend scaling** — any server instance can look up any room via Redis instead of requiring sticky sessions tied to one process's memory.

### v2+ (once leaderboard / accounts / multiplayer land — see PDD §7)

A persistent database becomes necessary for:

| Feature | Data | Suggested store |
|---|---|---|
| Online leaderboard | `players`, `scores` (score, combo, timestamp, room type) | **PostgreSQL** (relational, good for ranked queries: `ORDER BY score DESC LIMIT 100`) |
| Sword skins / cosmetics | `items`, `player_inventory` | PostgreSQL |
| Player accounts (optional, future) | `users`, `sessions` | PostgreSQL + an auth provider (e.g., Clerk/Auth.js) rather than hand-rolled auth |
| Match history (multiplayer) | `matches`, `match_players` | PostgreSQL |

**Recommendation:** don't introduce a persistent DB in v1 — it adds deployment/ops complexity with no v1 feature that needs it. Introduce PostgreSQL when the first persistence-requiring feature (leaderboard) is scheduled.

---

## 6. Real-Time Communication Architecture

### Why Socket.IO over raw WebSocket or WebRTC

- **vs. raw WebSocket:** Socket.IO gives us rooms, automatic reconnection with configurable backoff, transport fallback (polling if WS is blocked by a restrictive network — realistic at events/exhibitions), and acknowledgement callbacks (useful for pairing confirmation).
- **vs. WebRTC DataChannel (phone-to-laptop direct):** WebRTC would reduce one server hop and could lower latency further, but requires STUN/TURN infrastructure for NAT traversal, is meaningfully more complex to implement and debug, and is overkill for v1's latency budget (<100ms is achievable via a relay server on the same LAN/region). **Decision: defer WebRTC to a future optimization** (see §18) — it's the right answer for large-scale production, not for MVP velocity.

### Transport-level flow

```
Controller Phone                Backend (Socket.IO)              Display Laptop
      │                                │                                │
      │  motion:stream (30-60Hz)       │                                │
      ├───────────────────────────────>│                                │
      │                                │  relay to room, minimal        │
      │                                │  transform (see §8)            │
      │                                ├───────────────────────────────>│
      │                                │        sword:position          │
      │                                │                                │
```

- Motion packets are emitted at a **throttled rate (30–60Hz)**, not on every raw sensor event (which can fire at 60-200Hz depending on device) — see §15 for throttling strategy.
- The backend does **not** run business logic on motion packets in v1 beyond validating the sender belongs to the room and forwarding — this keeps the relay hop cheap (sub-millisecond server processing time).
- Socket.IO **namespaces** are not needed (single game type); **rooms** are used for isolating each game session (`socket.join(roomCode)`).

### Scaling the real-time layer

- Single Node process handles a large number of concurrent rooms comfortably for MVP/demo scale.
- For horizontal scaling: **`@socket.io/redis-adapter`** lets multiple Socket.IO server instances share room membership and broadcast across instances — required once traffic exceeds a single instance's capacity (see §18).

---

## 7. Device Pairing Flow (QR Code + Room Management)

### Sequence

```
1. Display client: user clicks "Play"
     → POST /api/room  (REST call, not socket — room must exist before QR renders)
     → Backend generates roomCode (e.g., 6-char alphanumeric, unambiguous charset)
     → Backend stores room in Redis with status "waiting", TTL 10 min
     → Backend returns { roomCode, roomId, joinUrl }

2. Display client:
     → Renders QR code encoding joinUrl (e.g., https://airslice.app/controller/{roomCode})
     → Opens Socket.IO connection, emits room:join { roomCode, role: "display" }
     → Backend binds this socket.id as the room's display client
     → Display shows "waiting for controller..." animation

3. Phone: user scans QR
     → Opens /controller/{roomCode} directly (plain URL, no app needed)
     → Page requests DeviceMotionEvent permission (iOS 13+ requires explicit user gesture — see §8)
     → User taps "Start Controller"
     → Controller opens Socket.IO connection, emits room:join { roomCode, role: "controller" }

4. Backend:
     → Validates roomCode exists and status is "waiting"
     → Validates room doesn't already have a controller bound (1 controller per room in v1)
     → Binds controller socket.id to room, sets status "paired"
     → Emits room:paired to BOTH sockets in the room

5. Display client:
     → Receives room:paired → transitions from Pairing Screen to Game Screen
     → Starts Phaser game scene, begins listening for sword:position events

6. Controller client:
     → Receives room:paired → shows "Connected ✅", starts streaming motion:stream events
```

### Room code design

- 6 characters, drawn from a charset excluding visually ambiguous characters (`0/O`, `1/I/l`) — matters if a room code is ever displayed as a fallback for manual entry (no camera / QR scan failure).
- QR code encodes the **full URL**, not just the code, so scanning "just works" without the user typing anything. The room code is a fallback shown as text under the QR for manual entry.

### Room lifecycle states

`waiting → paired → in_progress → finished → expired`

- `waiting`: display created, no controller yet.
- `paired`: both sockets connected.
- `in_progress`: gameplay started.
- `finished`: game over screen shown; room kept briefly for "Restart" (FR-9) without regenerating a QR.
- `expired`: TTL hit or both sockets disconnected — room purged from store.

### Reconnection handling

- If the controller's socket disconnects mid-game (e.g., phone screen lock, network blip), the Display shows a "Controller disconnected — reconnecting..." overlay and pauses spawning, rather than ending the game immediately. The controller page attempts automatic Socket.IO reconnection using the same roomCode for a grace period (e.g., 30s) before the room is marked `expired`.

---

## 8. Motion Sensor Data Flow

### Step-by-step

```
Phone Sensors (hardware)
   │  DeviceMotionEvent (acceleration, rotationRate)
   │  DeviceOrientationEvent (alpha, beta, gamma)
   ▼
Controller Client (browser JS)
   │  1. Permission request (iOS 13+: requires
   │     DeviceMotionEvent.requestPermission() from a user gesture)
   │  2. Raw event listener (fires up to ~60-200Hz depending on device)
   │  3. Throttle to fixed rate (e.g. 40Hz) via requestAnimationFrame gate
   │     or setInterval-based sampling
   │  4. Apply low-pass filter (exponential smoothing) to reduce jitter
   │  5. Normalize to a device-independent range (see §9)
   │  6. Package into a compact payload:
   │     { t: timestamp, x, y, z, alpha, beta, gamma, seq }
   ▼
Socket.IO emit: motion:stream (throttled, volatile* )
   ▼
Backend (thin relay)
   │  - Validates socket belongs to an active room as its controller
   │  - Forwards payload unchanged to the room's display socket
   ▼
Socket.IO event: sword:motion (received by Display)
   ▼
Display Client — MotionMapper system
   │  - Converts normalized motion → 2D (or 2.5D) screen coordinates
   │  - Feeds into Phaser Sword entity's position/velocity
   ▼
Phaser Sword sprite updates on canvas
```

\* **`volatile` emit:** Socket.IO's `socket.volatile.emit()` drops a packet if the connection is congested rather than queueing it — correct behavior for real-time motion data, where a stale position is worse than a dropped frame. Using this for `motion:stream` prevents latency buildup on flaky connections.

### iOS permission flow specifics

iOS 13+ Safari requires `DeviceMotionEvent.requestPermission()` to be called synchronously inside a user-initiated event (a tap), and only works over HTTPS. This directly shapes the Controller UI: the "Start Controller" button in PDD §11 Screen 3 is not cosmetic — it's the required permission trigger. Android generally doesn't gate this, but the UI treats both platforms identically (request-on-tap) for consistency and to avoid divergent code paths.

### Calibration

- On "Start Controller" (or a dedicated "Calibrate" button), the app captures the current orientation as a **zero reference**. All subsequent readings are expressed as deltas from this reference, so the player's natural resting phone angle becomes "neutral," regardless of how they're holding the phone.

---

## 9. Sword Movement & Motion-Mapping Logic

### Design goal
Map phone motion to a sword that feels **responsive and swing-like** (Fruit Ninja style), not a 1:1 cursor — pure 1:1 mapping from small phone movements feels twitchy and unsatisfying on a large screen.

### Mapping pipeline (`MotionMapper.ts`)

1. **Input:** smoothed `{ alpha, beta, gamma }` (orientation) deltas from calibrated zero, plus raw acceleration magnitude for swing "force."
2. **Velocity-based mapping (primary approach):** rather than mapping orientation directly to an absolute screen position, treat rotation-rate as a **velocity input** — the sword's on-screen position integrates this velocity over time, similar to a mouse with acceleration curves. This produces the "swing" feel and lets the game amplify fast motions (a real swing) more than slow tilts.
3. **Sensitivity curve:** apply a non-linear response curve (e.g., quadratic ease on magnitude) so small tremors don't move the sword much, but a real swing produces a large, fast on-screen arc.
4. **Clamping:** sword position clamped to canvas bounds with a soft edge (slight resistance near edges) so the sword never flies off-screen.
5. **Trail rendering:** the last N sword positions (e.g., 8–12 frames) are kept in a ring buffer and rendered as a fading trail (Phaser Graphics or a particle emitter) — this is what makes swings visually readable and satisfying, and is also what collision detection uses (see §10) since a fast swing can "tunnel" past a fruit between two discrete frames.
6. **Deadzone:** a small deadzone around zero velocity to prevent visual jitter when the phone is held still.

### Why velocity-based over absolute-position mapping
Absolute orientation → absolute screen position was considered, but rejected as the primary mode because: (a) it requires the player to physically tilt toward screen edges to reach them, which is uncomfortable and inconsistent across phone sizes/arm lengths, and (b) it doesn't naturally produce the fast "slice" motion the game is about. Velocity-based mapping (this is fundamentally what motion-controller games like Wii Sports use) better matches the intended feel and is more forgiving of individual player posture/grip.

---

## 10. Fruit Spawning, Collision Detection & Game Loop

### Game loop (Phaser `GameScene.update(time, delta)`)

```
update(time, delta):
  1. MotionMapper.tick(delta)         → update sword trail position
  2. SpawnSystem.tick(time, delta)    → maybe spawn new fruit/bomb
  3. Physics step (Phaser Arcade)     → apply gravity/velocity to fruits
  4. CollisionSystem.tick()           → sword-trail vs fruit hit testing
  5. Cleanup                          → despawn fruits past bottom bound,
                                         deduct life if fruit (not bomb) missed
  6. HUD.sync(gameStore)              → score/lives/combo UI update
```

### Spawn System

- Fruits (and bombs) spawn from the bottom of the screen with an upward velocity + slight horizontal randomization + gravity, following a parabolic arc — same core mechanic as classic fruit-slicing games.
- Spawn rate and fruit/bomb ratio increase over time (difficulty curve), driven by a simple function of elapsed game time or score milestones, defined in `gameConfig.ts` so it's tunable without touching logic code.
- Spawn timing uses a randomized interval within a min/max band (not fixed) to avoid predictable rhythm.

### Collision Detection

- **Not** simple point-in-sprite testing, because a fast sword swing can move many pixels between two animation frames, "tunneling" past a fruit without ever overlapping it in a single frame.
- **Approach:** treat the sword's recent trail (§9) as a **line segment (or short polyline)** each frame, and test **segment-vs-circle intersection** against each active fruit's hitbox (fruits use circular hitboxes for cheap, good-enough collision). This is standard practice for slicing games and correctly catches fast swings.
- On hit: trigger slice animation/particles, play sound, increment score/combo, remove fruit (or split into two half-sprites for juice, optional polish item).
- Bombs use the same collision path but trigger a different outcome (lose life / game over depending on difficulty design) and a distinct explosion effect.

### Combo System

- Tracks fruits sliced within a short rolling time window (e.g., 800ms); consecutive hits within the window increase a combo multiplier applied to score gains, reset on window expiry or a miss.

### Game loop ownership

- The entire loop above runs **client-side on the Display** at v1 (see §2's architecture note). The server does not simulate physics or validate hits in v1 — acceptable because AirSlice v1 is single-player-per-room with no competitive leaderboard integrity requirement yet. This is explicitly revisited in §18 for multiplayer/leaderboard trust.

---

## 11. State Management

| Concern | Tool | Scope |
|---|---|---|
| Game entities (fruit positions, sword state, physics) | **Phaser's internal scene state** | Lives entirely inside the Phaser scene graph; not mirrored into React state (would cause unnecessary re-renders at 60fps). |
| Cross-cutting UI state (score, lives, combo, game phase) | **Zustand** (`gameStore.ts`) | Phaser scenes push updates into the store (via a thin bridge) whenever score/lives change — not every frame — and React HUD components subscribe to just those slices. Zustand chosen over Redux/Context for minimal boilerplate and because updates need to be cheap and granular (avoid whole-tree re-renders during gameplay). |
| Room/connection state (roomCode, pairing status, socket connection) | **Zustand** (`roomStore.ts`) | Shared shape used by both Display and Controller pages. |
| Controller-local state (permission granted, calibration offset) | **Zustand** (`controllerStore.ts`) or local component state | Small enough to keep local; doesn't need to be global. |
| Server-side room state | **Redis-backed `RoomManager`** | Source of truth for which sockets belong to which room; not duplicated into a client store beyond what's needed for UI. |

**Bridge pattern:** Phaser and React don't share a state system natively, so a small `EventBus` (simple `EventEmitter` or Phaser's own event emitter) is used for Phaser scenes to notify the outside world of score/life/game-over changes, which a React hook (`useGameState`) subscribes to and writes into the Zustand store. This keeps the 60fps game loop fast (no React render cost per frame) while keeping HUD/menus reactive.

---

## 12. API Endpoints

REST is intentionally minimal — most gameplay communication is over Socket.IO. REST handles only what must exist *before* a socket connection makes sense (you need a room to join before you can open a room-scoped socket).

| Method | Endpoint | Purpose | Request | Response |
|---|---|---|---|---|
| `POST` | `/api/room` | Create a new game room | — | `{ roomCode, roomId, joinUrl, expiresAt }` |
| `GET` | `/api/room/:roomCode` | Validate a room exists before controller page tries to connect (fast fail with a friendly "expired" screen instead of a raw socket error) | — | `{ status: "waiting" \| "paired" \| "expired" \| "not_found" }` |
| `GET` | `/api/health` | Uptime/monitoring check (Railway/Render health checks) | — | `{ status: "ok", uptime }` |
| `GET` | `/api/qrcode/:roomCode` *(optional)* | Server-rendered QR image if not generated client-side | — | `image/png` |

**v2+ endpoints (leaderboard, once DB exists):**

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/scores` | Submit a completed run's score |
| `GET` | `/api/leaderboard` | Fetch top scores (paginated) |

No authentication endpoints in v1 (PDD explicitly states "no login required").

---

## 13. Socket.IO Event Structure

All event names and payloads are defined once in `packages/shared/src/socketEvents.ts` and imported by both apps, so client and server can never drift.

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `room:join` | `{ roomCode: string, role: "display" \| "controller" }` | Either client joining a room's socket channel. |
| `motion:stream` | `{ t: number, x: number, y: number, z: number, alpha: number, beta: number, gamma: number, seq: number }` | Controller → server, throttled, `volatile` emit. |
| `controller:calibrate` | `{}` | Controller signals it has re-zeroed (informational, optional display feedback). |
| `game:start` | `{}` | Display signals gameplay has begun (after pairing screen → game screen transition). |
| `game:restart` | `{}` | Display requests a fresh round without regenerating the room (FR-9). |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `room:paired` | `{ roomCode, pairedAt }` | Sent to both sockets once display + controller are bound. |
| `room:controller_disconnected` | `{}` | Sent to display if controller socket drops. |
| `room:controller_reconnected` | `{}` | Sent to display when controller reconnects within grace period. |
| `room:expired` | `{ reason }` | Sent to remaining socket(s) if the room TTL lapses or grace period is exceeded. |
| `sword:motion` | *(same shape as `motion:stream`, relayed)* | Server → display, forwarded motion payload. |
| `error` | `{ code, message }` | Generic error channel (e.g., `ROOM_NOT_FOUND`, `ROOM_ALREADY_PAIRED`). |

### Connection-level

- `connect` / `disconnect` / `connect_error` handled by Socket.IO client defaults, with custom reconnection UI hooked to `disconnect` and `reconnect` events per client type.

---

## 14. Security Considerations

| Concern | Mitigation |
|---|---|
| **Anyone guessing a room code joins a stranger's game** | Room codes are short-lived (TTL) and single-use per role (one display + one controller max per room in v1); once `paired`, the server rejects further `room:join` attempts for that room with `ROOM_ALREADY_PAIRED`. Codes are random enough (6 chars, ~1.7B combinations with a 32-char safe alphabet) that blind guessing during a room's short life is impractical, but this is **not** treated as a strong security boundary — see below. |
| **Malicious/spoofed motion payloads** | Backend validates the sender's `socket.id` matches the room's registered controller before relaying — an arbitrary client can't inject motion into someone else's room without first successfully joining as its controller (which requires a valid, unpaired room code). |
| **HTTPS requirement** | Motion sensor APIs (`DeviceMotionEvent`) only function in secure contexts; enforced naturally by deploying both frontend and backend behind HTTPS/WSS (Vercel + Railway/Render both provide this by default). |
| **CORS** | Backend Socket.IO/Express CORS config restricts allowed origins to the deployed frontend domain(s) in production (wildcarded only in local dev). |
| **Rate limiting** | REST `POST /api/room` is rate-limited per IP (e.g., via `express-rate-limit`) to prevent room-creation spam/DoS. Socket `motion:stream` is inherently self-limiting via client-side throttling (§8), but the server also enforces a max-rate guard per socket as defense-in-depth against a modified client. |
| **Input validation** | All socket payloads validated against a schema (e.g., `zod`) server-side before processing — never trust client-supplied `roomCode`, numeric ranges, etc. |
| **No PII collected in v1** | No accounts, no login, matches PDD explicitly — meaningfully reduces the security surface (no passwords/sessions to protect). Revisit if v2 adds accounts (§5). |
| **XSS** | Standard React/Next.js output encoding; no `dangerouslySetInnerHTML` usage planned. Room codes are alphanumeric-only, never rendered as raw HTML. |
| **Score integrity (future)** | Flagged in §10/§18: v1's client-authoritative game loop means scores are not tamper-proof. Acceptable for MVP (no leaderboard yet); must move scoring logic server-side before shipping a competitive leaderboard, or a modified client could submit arbitrary scores. |

---

## 15. Performance Optimization

### Latency budget (<100ms target)

| Segment | Approach |
|---|---|
| Phone sensor → JS event | Unavoidable OS-level latency (~ms), not controllable. |
| JS event → throttled emit | Throttle to 30-60Hz (not every raw event) using a `requestAnimationFrame`-driven sampler rather than naive `setInterval`, to stay aligned with actual frame budget and avoid oversending. |
| Network hop (phone → server → laptop) | Minimize server-side processing per packet (pure relay, no heavy validation logic in the hot path — schema validation kept cheap); deploy backend in a region close to expected users; use `volatile` emits so congestion drops old data instead of queueing/delaying it. |
| Render → screen | Phaser targets 60 FPS; sword rendering uses GPU-accelerated canvas/WebGL renderer (Phaser auto-selects WebGL when available). |

### Client-side (Display) optimizations

- **Object pooling** for fruit/bomb sprites and particle effects — avoid `new`/garbage-collection churn every spawn/despawn, which causes frame stutter in JS games.
- **Sprite atlases** (Texture packer output) instead of individual image files — fewer draw calls, faster load.
- **Delta-time-based movement** (not frame-count-based) so gameplay speed is consistent across variable frame rates/devices.
- **Culling**: fruits/particles far off-screen are skipped from update logic, not just rendering.

### Client-side (Controller) optimizations

- Controller page is intentionally minimal — no Phaser, no heavy assets — to load instantly from a cold QR scan on mobile data and to leave CPU headroom for high-frequency sensor sampling.
- Smoothing/filtering (§8) implemented with simple exponential moving average, not a heavier filter (e.g., Kalman) — sufficient for the game-feel requirement and cheap enough to run every sensor tick without draining battery.

### Backend optimizations

- Socket.IO configured with `perMessageDeflate` tuned or disabled for the motion stream — compression overhead on small, frequent packets can *add* latency; raw small JSON (or a packed binary format if profiling shows JSON parsing as a bottleneck) is faster here.
- Redis used with connection pooling; room lookups are O(1) key access, never a scan.

### Measuring success

- Instrument round-trip latency by embedding a client timestamp in each motion packet and comparing against receipt time on the Display (clock skew caveat noted, but useful as a relative/trend metric); surfaced in a dev-only debug overlay during development, matching PDD §12 success metrics.

---

## 16. Deployment Architecture

```
                     ┌─────────────────────────┐
                     │        Vercel            │
                     │  Next.js (apps/web)       │
                     │  - Display client pages   │
                     │  - Controller client pages│
                     │  - Static assets/CDN edge │
                     └────────────┬─────────────┘
                                  │ WSS / HTTPS
                                  ▼
                     ┌─────────────────────────┐
                     │   Railway / Render        │
                     │   Node.js (apps/server)   │
                     │   - Express REST API      │
                     │   - Socket.IO server      │
                     │   - Persistent process     │
                     │     (required for WS)      │
                     └────────────┬─────────────┘
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │   Redis (managed add-on)  │
                     │   - Room state             │
                     │   - Socket.IO adapter      │
                     │     (multi-instance pub/sub)│
                     └─────────────────────────┘
```

- **Frontend on Vercel:** static/SSR pages benefit from edge caching; Vercel's serverless functions are **not** used for anything Socket.IO-related (serverless functions can't hold persistent WebSocket connections) — all real-time traffic goes directly from the browser to the Railway/Render backend's public WSS endpoint.
- **Backend on Railway/Render:** chosen over serverless specifically because Socket.IO needs a long-lived process. Both platforms support: persistent processes, easy environment variable management, managed Redis add-ons, and zero-downtime deploys.
- **Environment separation:** `staging` and `production` environments on both Vercel and Railway/Render, with separate Redis instances, to allow testing pairing/latency changes without affecting live demos.
- **CI/CD:** GitHub Actions running lint + typecheck + build on every PR; auto-deploy `main` → production, feature branches → preview deployments (Vercel does this natively; Railway/Render support preview environments too).
- **Custom domain + HTTPS:** required (not optional) since motion sensor APIs need a secure context — both platforms provide free managed TLS.

---

## 17. Development Roadmap & Milestones

### Milestone 0 — Project Scaffolding (Foundation)
- Monorepo setup (workspaces/Turborepo), shared package skeleton, lint/format/typecheck config, CI pipeline skeleton.
- Basic Express + Socket.IO server boots locally; basic Next.js app boots locally.
- **Exit criteria:** `pnpm dev` runs both apps locally with hot reload.

### Milestone 1 — Room & Pairing
- `POST /api/room`, Redis (or in-memory) `RoomManager`, QR code rendering on Display, `room:join`/`room:paired` socket flow, Controller permission-request UI.
- **Exit criteria:** scanning a QR from a phone visibly pairs with the laptop screen (status changes, no gameplay yet).

### Milestone 2 — Motion Streaming
- `motion:stream` emission from Controller (throttled, smoothed), relay through backend, raw payload visualized on Display (e.g., a debug dot following phone tilt) — **no Phaser/game yet**, just prove the pipe works end-to-end within latency budget.
- **Exit criteria:** moving the phone visibly and responsively moves a marker on the laptop screen with acceptable latency.

### Milestone 3 — Core Game Loop (Phaser)
- Phaser integration into Next.js, `GameScene` with sword sprite driven by `MotionMapper` (§9), basic fruit spawning + gravity arcs (no collision yet).
- **Exit criteria:** fruits fly up and fall down convincingly; sword swings feel responsive to real phone motion.

### Milestone 4 — Collision, Scoring, Lives
- Segment-vs-circle collision detection (§10), slice animations/particles, score/combo system, lives system, game-over condition.
- HUD wired to `gameStore` via the EventBus bridge (§11).
- **Exit criteria:** a full playable round from pairing → slicing → game over works end-to-end.

### Milestone 5 — Audio & Polish
- Howler.js integration for all PDD §6 sound effects, background music, victory/game-over stingers.
- Visual polish: particle effects, screen shake on bomb hit, combo popups.
- **Exit criteria:** matches PDD's full "Core Features" list for audio and gameplay juice.

### Milestone 6 — Game Over / Restart Flow
- Game Over screen (final score, highest combo, restart without refresh per FR-9, share score).
- Room "restart" flow reusing the same paired room/socket instead of regenerating a QR.
- **Exit criteria:** a player can play multiple rounds back-to-back without re-scanning.

### Milestone 7 — Hardening & Cross-Device QA
- Test across iOS Safari, Android Chrome, various laptop browsers (Chrome/Firefox/Edge/Safari) per NFR "cross-browser compatibility."
- Reconnection edge cases (phone lock screen, backgrounding, Wi-Fi drop), error states, rate limiting, input validation (§14).
- Latency measurement/tuning against the <100ms target (§15).
- **Exit criteria:** success metrics from PDD §12 are met and verified with real devices.

### Milestone 8 — Production Deployment
- Full deployment pipeline (§16) live on custom domain with HTTPS, Sentry monitoring wired up, staging environment validated.
- **Exit criteria:** a stranger can go from a fresh QR scan to playing a full round on the production URL.

### Post-launch backlog (maps to PDD §7 Future Features)
- Difficulty levels, sword skins (needs persistent DB), online leaderboard (needs persistent DB + server-authoritative scoring), multiplayer battle mode (needs architecture changes, see §18), mobile vibration feedback, Smart TV support validation.

---

## 18. Future Scalability

### Multiplayer battle mode
The current architecture (one display + one controller per room, client-authoritative game loop) does not directly extend to competitive multiplayer, where two players' actions must be judged fairly and simultaneously. Moving to multiplayer requires:
- **Server-authoritative game state**: fruit spawning, physics, and collision resolution move from the Display client into the backend, with the backend broadcasting authoritative state at a fixed tick rate to all display clients in a match (both players' screens, or a shared screen with two swords). This also closes the score-integrity gap noted in §14.
- Both players' controllers stream motion to the server; the server, not any single client, decides hit outcomes.

### Online leaderboard
- Requires the persistent database introduced in §5 (v2), plus moving score computation server-side (a client-reported score cannot be trusted for a public leaderboard) — this naturally follows from the server-authoritative shift above.

### Horizontal scaling of real-time infra
- `@socket.io/redis-adapter` (already planned as the room store in §5/§6) allows running multiple backend instances behind a load balancer, with Redis pub/sub keeping room broadcasts consistent across instances — enables scaling beyond a single server's connection/CPU capacity for high-traffic events.

### WebRTC data channel (direct phone↔laptop)
- Once the relay architecture is proven and if latency profiling shows the server hop is a meaningful bottleneck at scale, motion data specifically (not room management, which stays on Socket.IO) could move to a WebRTC DataChannel between the two paired browsers, using the existing Socket.IO connection purely for signaling/pairing. This removes one network hop for the highest-frequency data. Deferred from v1 due to added complexity (STUN/TURN, NAT traversal edge cases) relative to its benefit at MVP scale.

### Smart TV support
- Since the Display client is "just a browser page," Smart TV support is primarily a testing/UX-scaling exercise (larger canvas, remote-control-free UI since pairing is QR-based, TV browser engine quirks) rather than a new architecture — validated in Milestone 7/post-launch rather than requiring structural changes.

### Custom fruit themes / cosmetics
- Asset-loading layer already abstracts sprites via atlases (§15); theming becomes a matter of swapping atlas configs per theme, optionally tied to the player-inventory model introduced alongside the leaderboard DB (§5 v2).

---

## Open Questions for Approval

1. **Monorepo tooling:** Turborepo vs. plain npm/pnpm workspaces — either works; Turborepo adds caching benefits as the codebase grows. Confirm preference.
2. **Redis from day one, or defer to Milestone 7?** In-memory room store is sufficient through Milestones 1–6 for local/single-instance development; recommend introducing Redis at Milestone 7 (hardening) once multi-instance deployment is actually being tested, rather than day one, to reduce early setup friction.
3. **TypeScript strictness:** recommend `strict: true` across all packages from the start, given the shared-types contract between frontend/backend is central to this architecture.
4. **Sentry (or an alternative/no error monitoring) for v1** — recommended but confirm before adding as a dependency.

---

*End of Technical Design Document. Once approved, implementation will proceed milestone-by-milestone per §17, starting with Milestone 0.*
