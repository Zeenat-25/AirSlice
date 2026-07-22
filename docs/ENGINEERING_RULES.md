# Engineering Rules

## 1. Code Quality
- **Strict TypeScript**: `noImplicitAny`, `strictNullChecks`, and `strict` must be `true`.
- **Modularity**: Every module must follow the Single Responsibility Principle (SRP).
- **DRY**: No code duplication. Logic shared across apps MUST reside in `packages/shared`.

## 2. Real-time Communication
- Use `volatile` emits for motion data to prevent queue-induced latency.
- Event names must be sourced from `packages/shared/socketEvents`.
- Every socket event must have a corresponding Zod schema for validation.

## 3. Game Engineering (Phaser)
- Use object pooling for frequently spawned items (fruits/particles).
- All movement must be delta-time based (`dt`) for frame-rate independence.
- High-frequency logic (collision) must be optimized to prevent main-thread blocking.

## 4. UI/UX
- The controller must load in < 2 seconds on 3G connections.
- Ensure "Screen Wake Lock" is active during the game session.
