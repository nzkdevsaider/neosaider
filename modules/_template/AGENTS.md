# AGENTS.md

`@neosaider/module-template`: minimal module to copy when creating a new one. One tool (`hello`) and one config value (`GREETING`). Turbo tag `layer-module`.

## Boundaries

- Depends only on `@neosaider/module-sdk`, `@neosaider/contracts` and external libraries. Never `core` or `storage`.
- `neosaider.module.json` is validated with `moduleManifestSchema`. If you change that schema, regenerate `docs/schemas/module-manifest.schema.json` with `pnpm --filter @neosaider/contracts schema`.
- The template is intentionally not in `modules/catalog.json`. A new module copied from it must be added there (and to `docker-compose.yml` with the `modules` profile).

## Commands

```sh
pnpm --filter @neosaider/module-template build
pnpm --filter @neosaider/module-template test
NEOSAIDER_DATA_DIR=./data PORT=3102 pnpm --filter @neosaider/module-template start
```

## Key files

- `neosaider.module.json`: manifest with the `GREETING` config entry.
- `src/template.ts`: `templateModule` and the `hello` tool.
- `src/server.ts`: entry point.
- `src/template.test.ts`: test pattern to copy; it expects the default greeting `Hola`.
- `README.md`: shown by the store and served at `/readme`.

## Pitfalls

- Keep it minimal: it is the starting point the guide tells authors to copy.
- Tests run with `node --test` on `dist/`: build first.
- No comments in code.

## Docs

- [README.md](./README.md)
- [Creating a module](../../packages/module-sdk/docs/CREATING-A-MODULE.md)
- [Module catalog](../../docs/CATALOG.md)
