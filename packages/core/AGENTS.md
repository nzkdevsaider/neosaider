# AGENTS.md

`@neosaider/core`: Neo (LangGraph agent), memory, scheduler and the MCP module system. Turbo tag `layer-core`.

## Imports

- Allowed: `@neosaider/contracts`, `@neosaider/storage` and third-party packages.
- Forbidden: anything in `apps/`, `modules/` or `packages/module-sdk`. Check with `pnpm turbo boundaries`.
- Persistence goes through `@neosaider/storage`; never write SQL here.

## Commands

```sh
pnpm --filter @neosaider/core build
pnpm --filter @neosaider/core test          # build first: tests run on dist
pnpm --filter @neosaider/core test:docker   # needs Docker and the gym image
pnpm --filter @neosaider/core lint
pnpm --filter @neosaider/core check-types
```

## Key files

- `src/neo.ts`: `createNeo`, the public object used by the harness.
- `src/graph.ts`, `src/self-description.ts`: graph and system prompt.
- `src/memory.ts`, `src/scheduler.ts`, `src/scheduling.ts`, `src/events.ts`.
- `src/modules.ts`, `src/catalog.ts`, `src/module-installer.ts`, `src/module-runtime.ts`.
- `src/fakes.ts`: `ScriptedChatModel`, `structuredReply`, `fakeEmbeddings`, `axis`.

## Pitfalls

- Tests use `node --test` on `dist/**/*.test.js`, the fakes in `src/fakes.ts` and `openDatabase(":memory:")`. No real LLM or Docker in `pnpm test`.
- Every logic change leaves at least one test that fails if it breaks.
- New built-in tools must also be described in `describeNeosaider`, or Neo will not know they exist.
- The graph is rebuilt when modules change; do not cache `neo.graph()` across module changes.
- Timers (`setInterval`, croner jobs) must be stopped in `close()`, or tests hang.
- No comments in code; names must explain it. Format with Prettier.
- Schema changes belong in `@neosaider/contracts`, table changes in a new storage migration.

## Docs

[README.md](./README.md), [docs/AGENT.md](./docs/AGENT.md), [docs/MEMORY.md](./docs/MEMORY.md), [docs/SCHEDULER.md](./docs/SCHEDULER.md), [docs/MODULE-RUNTIME.md](./docs/MODULE-RUNTIME.md), [architecture](../../docs/ARCHITECTURE.md).
