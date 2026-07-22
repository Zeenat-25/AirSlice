# Architectural Decision Records (ADR)

## ADR 1: Use of Turborepo and pnpm Workspaces
- **Status**: Accepted
- **Context**: We need a way to manage multiple applications (web, server) and a shared library.
- **Decision**: Use `pnpm` workspaces for dependency management and `Turborepo` for task execution.
- **Consequence**: Provides faster builds via caching and clear dependency boundaries.

## ADR 2: Redis for Room Management
- **Status**: Accepted
- **Context**: Socket.IO needs to scale horizontally and rooms must survive server restarts.
- **Decision**: Use Redis as the transient store for room metadata and the Socket.IO adapter.
