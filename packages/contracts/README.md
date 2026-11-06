# @neosaider/contracts

Shared zod schemas and TypeScript types for the Neosaider API, triggers, memories and modules. Every API input is validated with a schema from here through `@hono/zod-validator`; clients, the harness, core, storage and the module SDK all import their types from this package.

- Turbo tag: `layer-contracts`. It depends on nothing else in the workspace (only `zod`).

## Exports

`src/index.ts` re-exports everything in `src/modules.ts`.

### API and agent (`src/index.ts`)

| Export                                         | Kind   | Content                                                                                                               |
| ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `chatRequestSchema`, `ChatRequest`             | schema | `{ message }`, trimmed, non-empty.                                                                                    |
| `triggerEventSchema`, `TriggerEvent`           | schema | `"session.start"`.                                                                                                    |
| `triggerDefinitionSchema`, `TriggerDefinition` | schema | Union on `kind`: `cron` (`schedule`), `event` (`event`), `once` (`at`, ISO date-time with offset); all with `prompt`. |
| `Trigger`                                      | type   | `TriggerDefinition` plus `id` and `createdAt`.                                                                        |
| `memoryKindSchema`, `MemoryKind`, `Memory`     | schema | `"profile"` or `"fact"`; a memory has `id`, `kind`, `content`, `createdAt`.                                           |
| `ThreadMessage`                                | type   | `role` (`user`, `assistant`, `tool`), `content`, optional `toolCalls`.                                                |
| `ChatStreamEvent`                              | type   | `token`, `tool_call`, `tool_result`, `done`, `error`.                                                                 |
| `SuggestionEvent`                              | type   | Notification pushed to clients: `id`, `triggerId`, `threadId`, `content`.                                             |
| `protocolCommandSchema`, `ProtocolCommand`     | schema | Agent Streaming Protocol command: `id`, `method`, `params`.                                                           |
| `protocolSubscriptionSchema`                   | schema | `{ channels }`, at least one.                                                                                         |
| `threadStateUpdateSchema`                      | schema | `{ values?, as_node? }`.                                                                                              |
| `threadHistoryRequestSchema`                   | schema | `limit` (1–100, default 10), `before` (string or `{ checkpoint_id }`).                                                |
| `eventsQuerySchema`                            | schema | Optional `client` id (`[\w.-]{1,64}`).                                                                                |

### Modules (`src/modules.ts`)

| Export                                               | Kind     | Content                                                                                       |
| ---------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `moduleNameSchema`                                   | schema   | `^[a-z][a-z0-9_-]{0,31}$`.                                                                    |
| `semverSchema`                                       | schema   | `1.2.3` with optional pre-release and build.                                                  |
| `moduleConfigFieldSchema`, `ModuleConfigField`       | schema   | Config field of a manifest.                                                                   |
| `moduleNetworkSchema`, `ModuleNetwork`               | schema   | `"isolated"` or `"outbound"`.                                                                 |
| `moduleManifestSchema`, `ModuleManifest`             | schema   | Module manifest, below.                                                                       |
| `catalogSchema`, `Catalog`                           | schema   | `{ version: 1, modules: [{ id, versions: [{ version, manifest, readme? }] }] }`.              |
| `CatalogEntry`                                       | type     | `manifest`, `versions`, optional `installedVersion`.                                          |
| `catalogQuerySchema`                                 | schema   | `q` (max 100), `tag` (max 32).                                                                |
| `moduleConfigValuesSchema`, `ModuleConfigValues`     | schema   | Record of strings, each up to 4096 characters.                                                |
| `installModuleRequestSchema`, `InstallModuleRequest` | schema   | `id`, optional `version`, `config` (default `{}`).                                            |
| `updateModuleRequestSchema`                          | schema   | Optional `version`.                                                                           |
| `updateModuleConfigSchema`                           | schema   | `{ config }`.                                                                                 |
| `uninstallModuleQuerySchema`                         | schema   | `keepData`: `"true"` or `"false"` (default).                                                  |
| `moduleLogsQuerySchema`                              | schema   | `tail`: 1–2000, default 200, coerced from the query string.                                   |
| `moduleRegistrationSchema`, `ModuleRegistration`     | schema   | `name`, `transport: "http"`, `url`.                                                           |
| `installStateSchema`, `InstallState`                 | schema   | `installing`, `running`, `stopped`, `failed`, `removing`.                                     |
| `ModuleInstallation`, `ModuleTool`, `ModuleStatus`   | types    | Installation record, tool summary, module status for the API.                                 |
| `SECRET_MASK`                                        | constant | `••••••`: replaces secret config values in responses; sending it back keeps the stored value. |

## Module manifest

`moduleManifestSchema` validates `neosaider.module.json`:

| Field         | Rule                                                          | Default                   |
| ------------- | ------------------------------------------------------------- | ------------------------- |
| `id`          | `moduleNameSchema`                                            | required                  |
| `name`        | 1–64 characters                                               | required                  |
| `version`     | `semverSchema`                                                | required                  |
| `description` | 1–300 characters                                              | required                  |
| `tags`        | Up to 10, each `^[a-z0-9-]{1,32}$`                            | `[]`                      |
| `author`      | 1–100 characters                                              | required                  |
| `license`     | 1–64 characters                                               | required                  |
| `homepage`    | URL                                                           | optional                  |
| `repository`  | URL                                                           | optional                  |
| `icon`        | Up to 16 characters                                           | optional                  |
| `sdk`         | Semver range of the module SDK, 1–64 characters               | required                  |
| `image`       | Docker image reference, `^[\w.\-/:@]+$`, up to 255 characters | required                  |
| `port`        | 1–65535                                                       | `8080`                    |
| `dataPath`    | Absolute path                                                 | `/data`                   |
| `config`      | Array of config fields with unique keys                       | `[]`                      |
| `permissions` | `{ network: "isolated" \| "outbound" }`                       | `{ network: "isolated" }` |

A config field has `key` (`UPPER_SNAKE_CASE`, up to 64 characters; `PORT`, `HOST` and `NEOSAIDER_*` are reserved), `description` (1–300), `required` (default `false`), `secret` (default `false`) and an optional string `default`.

## JSON Schema

[`docs/schemas/module-manifest.schema.json`](../../docs/schemas/module-manifest.schema.json) is generated from `moduleManifestSchema` (input side, so fields with defaults are optional). After changing the manifest schema, regenerate it:

```sh
pnpm --filter @neosaider/contracts build
pnpm --filter @neosaider/contracts schema
```

The script reads `dist/modules.js`, so build first. A test in `src/modules.test.ts` fails when the published file does not match.

## Commands

```sh
pnpm --filter @neosaider/contracts build
pnpm --filter @neosaider/contracts test   # node --test over dist
pnpm --filter @neosaider/contracts lint
pnpm --filter @neosaider/contracts check-types
pnpm --filter @neosaider/contracts schema
```

## Related documentation

- [Harness API](../../apps/harness/docs/API.md)
- [Module catalog](../../docs/CATALOG.md)
- [Creating a module](../../packages/module-sdk/docs/CREATING-A-MODULE.md)
- [Architecture](../../docs/ARCHITECTURE.md)
