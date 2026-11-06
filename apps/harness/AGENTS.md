# AGENTS.md

`@neosaider/harness` is the headless Hono HTTP server that hosts Neo: REST API with SSE plus the Agent Streaming Protocol v2 under `/agent`. Turbo layer tag: `layer-api`.

## Imports

- Allowed: `@neosaider/contracts`, `@neosaider/core`, `@neosaider/storage`, Hono, LangChain/LangGraph.
- Forbidden: anything from `apps/*` or `modules/*`. Check with `pnpm turbo boundaries`.

## Commands

```sh
pnpm --filter @neosaider/harness build
pnpm --filter @neosaider/harness test          # runs on dist: build first
pnpm --filter @neosaider/harness dev           # build + run with the root .env
pnpm --filter @neosaider/harness lint
pnpm --filter @neosaider/harness check-types
```

## Key files

- `src/server.ts`: entry point; wires database, Docker runtime, Neo and the server.
- `src/app.ts`: every REST route, auth and error handling.
- `src/agent-protocol.ts`: `/agent` sub-app (sessions, `run.start`, state, history).
- `src/config.ts`: environment variables.
- `src/app.test.ts`: tests through `app.request()`.

## Pitfalls

- Every API input (body or query) is a zod schema in `@neosaider/contracts`, applied with `zValidator` from `@hono/zod-validator`. Do not define schemas here.
- Keep `/health` before the `bearerAuth` middleware and `cors()` for `/agent/*` before it too, or preflights break.
- Throw `ModuleInstallError` from core for module errors; `app.onError` maps its `status`.
- Tests use fake models and SQLite in memory; never require an LLM or Docker. Each logic change needs a test that fails if it breaks.
- When a route, env var or protocol behavior changes, update `docs/` here and, if architecture changes, `../../docs/ARCHITECTURE.md`.
- No code comments; names must explain the code. Format with Prettier. No commits or pushes.

## Docs

[README.md](./README.md), [docs/API.md](./docs/API.md), [docs/AGENT-PROTOCOL.md](./docs/AGENT-PROTOCOL.md), [docs/CONFIGURATION.md](./docs/CONFIGURATION.md).
