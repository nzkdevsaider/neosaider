# AGENTS.md

`@neosaider/storage`: the single SQLite database, its migrations, repository functions and the LangGraph checkpointer. Turbo tag `layer-storage`.

## Imports

- Allowed: `@neosaider/contracts` and third-party packages (`better-sqlite3`, `sqlite-vec`, LangGraph checkpoint packages).
- Forbidden: `@neosaider/core`, anything in `apps/` or `modules/`. Check with `pnpm turbo boundaries`.

## Commands

```sh
pnpm --filter @neosaider/storage build
pnpm --filter @neosaider/storage test   # build first: tests run on dist
pnpm --filter @neosaider/storage lint
pnpm --filter @neosaider/storage check-types
```

## Key files

- `src/database.ts`: `openDatabase` (sqlite-vec, WAL, foreign keys, migrations).
- `src/migrations.ts`: the migrations array.
- `src/memories.ts`: memories plus the lazily created `memory_vectors` table.
- `src/modules.ts`, `src/installations.ts`, `src/triggers.ts`, `src/notifications.ts`, `src/extractions.ts`, `src/checkpointer.ts`.
- `src/index.ts`: the public exports.

## Pitfalls

- Migrations: only append new entries to the array. Never edit, remove or reorder an existing one.
- Repository functions are synchronous and take `db` first; keep them small and SQL-only, with no business logic.
- JSON columns are parsed with contracts schemas; a schema change can break reading old rows, so add a migration if needed.
- Tests use `node --test` on `dist` with `openDatabase(":memory:")`. Every logic change leaves a test that fails if it breaks.
- No comments in code; names must explain it. Format with Prettier.

## Docs

[README.md](./README.md), [docs/DATA-MODEL.md](./docs/DATA-MODEL.md), [architecture](../../docs/ARCHITECTURE.md).
