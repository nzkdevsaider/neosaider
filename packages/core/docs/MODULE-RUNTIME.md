---
title: Module runtime
description: How core connects to MCP modules, loads the catalog, installs modules and runs them as hardened Docker containers.
---

# Module runtime

Modules are MCP servers reached over HTTP. Four pieces cooperate:

```mermaid
flowchart LR
  catalog[catalog.ts<br/>catalog.json + manifests] --> installer[module-installer.ts]
  installer --> runtime[module-runtime.ts<br/>Docker]
  installer -->|saveModule| modulesTable[(modules)]
  installer -->|state| installed[(installed_modules)]
  modulesTable --> manager[modules.ts<br/>MCPAdapter per module]
  manager -->|tools| graph[Neo graph]
```

Registrations in `modules` can also be added by hand (`neo.modules.register`) for a module that already runs somewhere; only installations are managed by the installer.

## Module manager

`createModuleManager(db)` in `src/modules.ts`:

- `reload()` closes every adapter and creates one `MCPAdapter` per row of `modules`, with `transport: "http"` and `prefixToolNameWithServerName: true`, so tools are named `<module>_<tool>`.
- A module whose `listTools()` fails is kept with `available: false` and the error message, truncated to 300 characters; it contributes no tools. A failing module never makes `createNeo` throw.
- Each tool goes through `toModuleTool`: its description is truncated to 1024 characters before it is bound or shown in the system prompt, and its results keep only the content. MCP `structuredContent`, `_meta` and resource artifacts are dropped, so `ToolMessage.artifact` is always empty and the checkpoint never stores module-controlled objects that its serializer could revive.
- `createModuleManager(db, reservedToolNames)` gets the built-in tool names. `tools()` and `catalog()` leave out every module tool whose final name matches a built-in tool or another module tool (for example `my` + `mail_send` and `my_mail` + `send`); none of the colliding tools is bound.
- `fetchModuleReadme(url)` reads a module's `/readme` incrementally and gives up past 256 KiB; `neo.modules.readme` then falls back to the catalog README.
- MCP responses themselves are not size-capped yet: `@langchain/mcp-adapters` 2.0.1 does not forward a custom `fetch` to its HTTP transport.
- `reconnectUnavailable()` retries only unavailable modules. Neo calls it every 15 s (`MODULE_RECONNECT_MS`) and rebuilds the graph when at least one recovers.
- `statuses()` returns `ModuleStatus` with the tool list; `catalog()` feeds the system prompt.

`neo.modules.statuses()` merges these statuses with installations (secrets masked with `SECRET_MASK`); installations without a registration appear as unavailable.

## Catalog

`createCatalog(location)` in `src/catalog.ts`. `location` is a URL (`http`, `https` or `file`) or a local path. Without `catalogLocation` Neo uses an empty catalog.

- The index is validated with `catalogSchema` (`version: 1`). Each version's `manifest` and optional `readme` paths are resolved relative to the catalog URL. A resolved URL must use the catalog's protocol and, for `http(s)`, its origin; anything else (for example an `https` catalog pointing at `file:///etc/passwd`) skips the module.
- Each manifest is validated with `moduleManifestSchema` and must match the entry's `id` and `version`. A module with any invalid version is skipped with a warning; the rest of the catalog still loads.
- Versions are sorted newest first with `semver.rcompare`; `latest` is the first.
- Every document (catalog, manifest, README) is capped at 1 MiB: `file:` reads must be regular files (no devices, FIFOs or directories) within the limit, and `http(s)` reads are rejected by `content-length` or once the streamed body passes the limit.
- Remote reads time out after 10 s. Results are cached for 5 minutes; a failed load is not cached. `refresh()` drops the cache.
- `search({ q, tag })` filters by exact tag and by case-insensitive text over id, name, description and tags of the latest manifest.
- `readme(version)` fetches the README, or returns `# <name>` plus the description when there is none.

Catalog format: [CATALOG.md](../../../docs/CATALOG.md).

## Installer

`createModuleInstaller({ db, catalog, runtime, onModulesChanged })` in `src/module-installer.ts`. Neo passes `onModulesChanged = reloadModules`, which reloads the module manager and rebuilds the graph. Without a runtime, every operation throws `ModuleInstallError` with status `503`.

| Operation                                  | Checks                                                                                                                                                                                                                                                                  | Effect                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `install({ id, version?, config })`        | `409` if installed and not `failed`; `404` if not in the catalog; `400` if `SUPPORTED_SDK_VERSION` does not satisfy the manifest `sdk` range or config is invalid                                                                                                       | Saves the installation as `installing` and deploys in the background.                                                   |
| `update(id, version?, { acceptChanges? })` | `404` if not installed; same catalog and SDK checks; `409` listing the changes when the new manifest widens network (`isolated` to `outbound`), makes a secret config field non-secret or changes the image repository (tag and digest ignored), unless `acceptChanges` | Redeploys the chosen (or latest) version with the stored config.                                                        |
| `configure(id, config)`                    | `404` if not installed; config validation                                                                                                                                                                                                                               | Redeploys the same manifest with merged config.                                                                         |
| `uninstall(id, { keepData })`              | Returns `false` if not installed                                                                                                                                                                                                                                        | State `removing`, deletes the registration, reloads, removes container (and volume unless `keepData`), deletes the row. |
| `reconcile()`                              | No-op without a reachable runtime                                                                                                                                                                                                                                       | Startup sync, below.                                                                                                    |
| `logs(id, tail)`                           | `404` if not installed                                                                                                                                                                                                                                                  | Container logs.                                                                                                         |

Config resolution: unknown keys are rejected; a value of `SECRET_MASK` or a missing key keeps the previous value; empty values are dropped; required fields without a value or a `default` are reported as missing.

Deploy (background, tracked by `whenIdle()`):

1. `ensureImage(manifest.image)`, then `run(...)` with the config as environment.
2. Poll `<base>/health` every 500 ms for up to 60 s; once healthy, `<base>/manifest` must report the same `id` and `version`, otherwise it fails immediately.
3. Save the registration (`modules`) and set the state to `running`.
4. On any error, set the state to `failed` with the message. In every case call `onModulesChanged`.

`reconcile()` runs at harness startup: `removing` rows are finished, `installing` rows are redeployed, and the rest are started with `runtime.start`; a missing container sets `failed` with `the container no longer exists; update or reinstall the module`.

Installation states are those of `installStateSchema`: `installing`, `running`, `stopped`, `failed`, `removing`.

## Docker runtime

`createDockerRuntime({ docker?, composeNetwork? })` in `src/module-runtime.ts` implements `ModuleRuntime` (`available`, `ensureImage`, `run`, `start`, `remove`, `logs`) with dockerode.

- Names: container and volume are both `neosaider-module-<id>`; both carry the label `neosaider.module=<id>`, and the container also `neosaider.version`.
- Image: inspected locally and pulled only if missing.
- Volume: mounted at the manifest `dataPath` (default `/data`).
- Environment: module config plus `PORT`, `HOST=0.0.0.0`, `NEOSAIDER_DATA_DIR=<dataPath>`, `NEOSAIDER_ALLOWED_HOSTS=<name>,localhost,127.0.0.1` and, when the harness has a module secret, `NEOSAIDER_MODULE_TOKEN`.
- Credentials: `createNeo({ moduleSecret })` (the harness passes `NEOSAIDER_API_TOKEN`) derives one token per module with `moduleToken(secret, id)` (HMAC-SHA256, `src/module-auth.ts`). The installer sends it as `Authorization: Bearer` on the health and manifest checks, and the module manager on MCP and `/readme` requests to installed modules. Modules built with the SDK reject requests without it, so one module cannot call another module's tools.
- `run` replaces any existing container with the same name.

Hardened container options:

| Option           | Value                                   |
| ---------------- | --------------------------------------- |
| `ReadonlyRootfs` | `true`                                  |
| `Tmpfs`          | `/tmp` with `rw,noexec,nosuid,size=64m` |
| `CapDrop`        | `ALL`                                   |
| `SecurityOpt`    | `no-new-privileges`                     |
| `Memory`         | 256 MiB                                 |
| `RestartPolicy`  | `unless-stopped`                        |

Networking:

| Harness mode                                           | `permissions.network` | Container network                                                | URL                               |
| ------------------------------------------------------ | --------------------- | ---------------------------------------------------------------- | --------------------------------- |
| Compose (`composeNetwork`, `NEOSAIDER_DOCKER_NETWORK`) | `isolated`            | `neosaider-modules-isolated` (internal, no outbound)             | `http://<name>:<port>/mcp`        |
| Compose                                                | `outbound`            | `neosaider-modules-outbound` (egress allowed, no other services) | `http://<name>:<port>/mcp`        |
| Local (no `composeNetwork`)                            | any                   | `bridge`, port published on `127.0.0.1` with a random host port  | `http://127.0.0.1:<hostPort>/mcp` |

Both module networks are created on demand with label `neosaider.managed=true`, and the harness container (found by its hostname) joins them so it can reach the modules. Modules never share a network with `web`, `docker-proxy` or `ollama`. In local mode the `isolated` permission is not enforced.

The module manager connects with its own MCP `Client` and `StreamableHTTPClientTransport` so it can pass a size-limited `fetch`: any module response over 2 MiB is cut off and the module is marked unavailable instead of being buffered.

`logs(id, tail)` reads stdout and stderr and demultiplexes Docker's 8-byte frame headers.

## Docker integration test

`src/docker-integration.ts` is not part of `pnpm test`. Run it with:

```sh
pnpm --filter @neosaider/core build
pnpm --filter @neosaider/core test:docker
```

It needs a running Docker daemon and the gym image from `modules/catalog.json` (locally built with `docker compose --profile modules build`, or pullable). It installs `gym` from the development catalog into an in-memory database, checks the container is running, read-only and drops all capabilities, calls `gym_log_workout` and `gym_list_workouts` through MCP, reads the logs, then uninstalls and checks that the container, volume and installation are gone.

See also [Creating a module](../../module-sdk/docs/CREATING-A-MODULE.md).
