# AGENTS.md

`@neosaider/module-gym`: example module that logs workouts in SQLite and exposes `log_workout` and `list_workouts` to Neo. Turbo tag `layer-module`.

## Boundaries

- Depends only on `@neosaider/module-sdk`, `@neosaider/contracts` and external libraries (`better-sqlite3`, `zod`, `@modelcontextprotocol/server`). Never `core` or `storage`.
- `neosaider.module.json` is validated with `moduleManifestSchema`. If you change that schema, regenerate `docs/schemas/module-manifest.schema.json` with `pnpm --filter @neosaider/contracts schema`.
- Keep `version` equal in `package.json`, the manifest, the `image` tag, `modules/catalog.json` and the `module-gym` service in `docker-compose.yml`.

## Commands

```sh
pnpm --filter @neosaider/module-gym build
pnpm --filter @neosaider/module-gym test
NEOSAIDER_DATA_DIR=./data PORT=3102 pnpm --filter @neosaider/module-gym start
docker compose --profile modules build module-gym
pnpm --filter @neosaider/core test:docker
```

## Key files

- `neosaider.module.json`: manifest.
- `src/gym.ts`: database, tools and `gymModule`.
- `src/server.ts`: entry point.
- `src/gym.test.ts`: tools through `MCPAdapter`, `/manifest`, `/readme`.
- `README.md`: shown by the store and served at `/readme`; the test expects it to start with `# Gym`.

## Pitfalls

- Tests run with `node --test` on `dist/`: build first.
- Data only under `dataDir`; a new data format needs a migration in `create()`, since updates keep the volume.
- `better-sqlite3` is native: the Docker build needs `python3 make g++` (already in the root `Dockerfile`).
- No comments in code.

## Docs

- [README.md](./README.md)
- [Creating a module](../../packages/module-sdk/docs/CREATING-A-MODULE.md)
- [Module catalog](../../docs/CATALOG.md)
