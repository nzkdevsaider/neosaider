# AGENTS.md

`@neosaider/module-sdk`: the SDK modules use to define and serve their MCP tools (`defineModule`, `startModule`, `createModuleHttpServer`, `resolveConfig`). Turbo tag `layer-sdk`.

## Boundaries

- May import only `@neosaider/contracts` (`layer-contracts`), toolchain packages and external libraries. Never `core`, `storage` or the apps.
- Manifests are parsed with `moduleManifestSchema` from `@neosaider/contracts`. If that schema changes, regenerate `docs/schemas/module-manifest.schema.json` with `pnpm --filter @neosaider/contracts schema`.
- `SDK_VERSION` must stay in step with `SUPPORTED_SDK_VERSION` in `packages/core/src/module-installer.ts` and with the `sdk` range in module manifests.

## Commands

```sh
pnpm --filter @neosaider/module-sdk build
pnpm --filter @neosaider/module-sdk test
pnpm --filter @neosaider/module-sdk lint
pnpm --filter @neosaider/module-sdk check-types
pnpm turbo boundaries
```

## Key files

- `src/index.ts`: the whole public API and the HTTP server (`/mcp`, `/health`, `/manifest`, `/readme`).
- `src/sdk.test.ts`: config resolution, endpoints, MCP round-trip with `MCPAdapter`, Host rejection.
- `docs/CREATING-A-MODULE.md`: the module authoring guide.

## Pitfalls

- Tests run with `node --test` on `dist/`: build before testing.
- The MCP server is stateless: `register` runs on every request; state belongs in `create`.
- Every route is behind Host header validation; keep it that way (DNS rebinding).
- Changes to endpoints or env variables affect the harness (`packages/core/src/module-runtime.ts`, `module-installer.ts`) and both modules.
- No comments in code; names explain it.

## Docs

- [README.md](./README.md)
- [Creating a module](./docs/CREATING-A-MODULE.md)
- [Module catalog](../../docs/CATALOG.md)
- [Architecture](../../docs/ARCHITECTURE.md)
