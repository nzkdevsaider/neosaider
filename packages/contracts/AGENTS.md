# AGENTS.md

`@neosaider/contracts`: zod schemas and shared types for the API, triggers, memories, modules and the module manifest. Turbo tag `layer-contracts`.

## Imports

- Allowed: `zod` only.
- Forbidden: every other workspace package. Everything else depends on this one, so it must stay a leaf. Check with `pnpm turbo boundaries`.

## Commands

```sh
pnpm --filter @neosaider/contracts build
pnpm --filter @neosaider/contracts test     # build first: tests run on dist
pnpm --filter @neosaider/contracts schema   # regenerate the manifest JSON Schema (after build)
pnpm --filter @neosaider/contracts lint
pnpm --filter @neosaider/contracts check-types
```

## Key files

- `src/index.ts`: API, trigger, memory, chat stream and protocol schemas; re-exports `modules.ts`.
- `src/modules.ts`: manifest, catalog, install, configuration and module status schemas.
- `scripts/write-manifest-schema.mjs`: writes `docs/schemas/module-manifest.schema.json`.
- `src/modules.test.ts`: manifest defaults and rejections, catalog validation, schema sync.

## Pitfalls

- Every API input schema lives here and is applied with `@hono/zod-validator`; do not define request schemas in the harness.
- Changing `moduleManifestSchema` requires `build` then `schema`; the sync test fails otherwise.
- Storage parses stored JSON with these schemas: tightening one can break reading existing rows.
- Tests use `node --test` on `dist`. Every logic change leaves a test that fails if it breaks.
- No comments in code; names must explain it. Format with Prettier.

## Docs

[README.md](./README.md), [architecture](../../docs/ARCHITECTURE.md), [catalog](../../docs/CATALOG.md).
