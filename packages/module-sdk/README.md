# @neosaider/module-sdk

SDK for building Neosaider modules: HTTP MCP servers, packaged as Docker images, that give Neo domain tools. A module defines its tools with `defineModule` and serves them with `startModule`; the SDK handles the manifest, configuration, the HTTP endpoints, Host header validation and shutdown.

To build a module step by step, read [Creating a module](./docs/CREATING-A-MODULE.md). Reference modules: [`modules/_template`](../../modules/_template) and [`modules/gym`](../../modules/gym).

## Layer

Turbo tag `layer-sdk`. It may depend only on `layer-contracts` (`@neosaider/contracts`) and `layer-toolchain`; it never imports `core` or `storage`. Modules (`layer-module`) depend on it.

Runtime dependencies: `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `@neosaider/contracts` and `zod`.

## Usage

```ts
import { defineModule, startModule } from "@neosaider/module-sdk";
import { z } from "zod";

export const helloModule = defineModule({
  root: new URL("..", import.meta.url),
  create({ config }) {
    return {
      register(server) {
        server.registerTool(
          "hello",
          {
            description: "Greet someone by name.",
            inputSchema: z.object({ name: z.string().min(1) }),
          },
          async ({ name }) => ({
            content: [{ type: "text", text: `${config.GREETING}, ${name}!` }],
          }),
        );
      },
    };
  },
});

startModule(helloModule);
```

## API

Everything is exported from `src/index.ts`.

### Constants

| Export          | Value                     | Meaning                                                                             |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `SDK_VERSION`   | `"0.1.0"`                 | SDK version. A manifest's `sdk` range must accept the version the harness supports. |
| `MANIFEST_FILE` | `"neosaider.module.json"` | Manifest file name read from the module root.                                       |

### `defineModule({ root, create })`

Builds a `ModuleDefinition`.

| Option   | Type                                         | Description                                                                               |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `root`   | `URL`                                        | Module root directory, usually `new URL("..", import.meta.url)` from `src/` (or `dist/`). |
| `create` | `(context: ModuleContext) => ModuleInstance` | Factory called once when the server is created.                                           |

It reads `<root>/neosaider.module.json` synchronously and parses it with `moduleManifestSchema` (throws if invalid), and reads `<root>/README.md`. If the README is missing, it uses `# <name>\n\n<description>\n`.

### `startModule(definition, env = process.env)`

Starts the module and returns the Node `http.Server`. It reads from `env`:

| Variable                  | Default                           | Effect                                                                         |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `PORT`                    | `manifest.port`                   | Listening port.                                                                |
| `HOST`                    | `127.0.0.1`                       | Listening address (the harness passes `0.0.0.0`).                              |
| `NEOSAIDER_DATA_DIR`      | `manifest.dataPath`               | `context.dataDir`; created with `mkdir -p` before listening.                   |
| `NEOSAIDER_ALLOWED_HOSTS` | `localhost`, `127.0.0.1`, `[::1]` | Comma-separated list of accepted `Host` header values.                         |
| `NEOSAIDER_MODULE_TOKEN`  | unset                             | When set, every request needs `Authorization: Bearer <token>` (401 otherwise). |
| each `config[].key`       | `config[].default`                | Values resolved into `context.config` with `resolveConfig`.                    |

It throws on startup if a required config value is missing, logs `[<id>] <name> <version> listening on <host>:<port>` and closes the server on `SIGINT` or `SIGTERM`.

### `createModuleHttpServer(definition, { context, allowedHosts? })`

Creates the HTTP server without listening, with an explicit `ModuleContext`. `startModule` uses it, and tests use it to listen on a random port. `allowedHosts` defaults to `localhost`, `127.0.0.1` and `[::1]`. It calls `definition.create(context)` immediately and calls the instance's `close()` when the server emits `close`.

### `resolveConfig(manifest, env)`

Returns a `ModuleConfigValues` record with one entry per `manifest.config` key, taken from `env` or else from its `default`. Keys without a value and without a default are omitted, unless they are `required`: then it throws `Missing required configuration: <keys>`.

### Types

| Type               | Shape                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| `ModuleContext`    | `{ manifest, dataDir, config, log }`; `log(message)` prints with an `[<id>]` prefix. |
| `ModuleInstance`   | `{ register(server: McpServer): void; close?(): void }`                              |
| `ModuleDefinition` | `{ manifest: ModuleManifest; readme: string; create(context): ModuleInstance }`      |

## Endpoints

Every module serves these routes. Any other path returns 404.

| Route           | Response                                                                        |
| --------------- | ------------------------------------------------------------------------------- |
| `/mcp`          | MCP over Streamable HTTP. All tools registered by `register`.                   |
| `GET /health`   | `{ "ok": true, "id": "<id>" }`. The harness waits for it after installing.      |
| `GET /manifest` | The parsed manifest, defaults included. The harness compares it to the catalog. |
| `GET /readme`   | The module README as `text/markdown`. The UI shows it for installed modules.    |

### Host header validation

Every request, on every route, goes through `hostHeaderValidation` from `@modelcontextprotocol/node`. A `Host` not in the allowed list gets a 403. This protects against DNS rebinding: a web page cannot reach a module on `localhost` through a domain it controls. The harness allows `neosaider-module-<id>,localhost,127.0.0.1`.

### Statelessness

The MCP transport runs without sessions (`sessionIdGenerator: undefined`). Each request to `/mcp` creates a new `McpServer`, calls `register(server)` on it, handles the request and closes both when the response ends. Keep state (database handles, clients) in the closure of `create`, which runs once; `register` must only register tools.

## Scripts

```sh
pnpm --filter @neosaider/module-sdk build
pnpm --filter @neosaider/module-sdk test
pnpm --filter @neosaider/module-sdk lint
pnpm --filter @neosaider/module-sdk check-types
```

## Tests

`src/sdk.test.ts` runs with `node --test` on the compiled `dist/`, so build first. It covers `resolveConfig` (environment, defaults, required keys) and a full module served by `createModuleHttpServer`: `/health`, `/manifest`, `/readme`, 404 on other paths, a tool invoked through `MCPAdapter` from `@langchain/mcp-adapters` (the same client the harness uses), 403 for a foreign `Host`, and `close()` on shutdown.
