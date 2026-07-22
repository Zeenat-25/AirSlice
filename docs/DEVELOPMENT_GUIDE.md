# Development Guide

## Prerequisites
- Node.js v20+ 
- pnpm v9+
- Docker (optional, for local Redis)

## Setup
1. Clone the repository.
2. Run `pnpm install`.
3. Run `pnpm dev` to start the backend and frontend concurrently.

## Commands
- `pnpm build`: Build all apps and packages.
- `pnpm dev`: Start development servers.
- `pnpm lint`: Run ESLint across the monorepo.
- `pnpm typecheck`: Run `tsc` across all modules.

## Branching Strategy
- `main`: Production-ready code only.
- `feature/*`: Development of specific milestones.
