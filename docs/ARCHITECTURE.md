# Architecture Overview

## System Model
AirSlice is a real-time, multi-client system utilizing a relay-based architecture.

### Components
1. **Display Client (apps/web)**: Next.js + Phaser.js. The authoritative renderer and game logic holder.
2. **Controller Client (apps/web)**: Mobile-optimized Next.js route. Streams sensor data.
3. **Backend Server (apps/server)**: Node.js + Socket.IO. Manages rooms and relays motion packets.
4. **Shared Package (packages/shared)**: TypeScript types, Zod schemas, and constants used by both clients and server.

## Data Flow
- **Pairing**: Display (REST) -> Server (Redis) -> Controller (Socket).
- **Motion**: Controller (Socket) -> Server (Relay) -> Display (Socket).
- **State**: Game state is primarily local to the Display Client in v1.

## Infrastructure
- **Frontend**: Vercel (Edge).
- **Backend**: Railway/Render (Persistent Node.js).
- **Store**: Redis (Transient room state).
