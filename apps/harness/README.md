# @neosaider/harness

The harness is the headless HTTP server of Neosaider. It hosts **Neo**, the LangGraph JS assistant from `@neosaider/core`, and exposes it as:

- a REST API with SSE streaming for chat, notifications, the module catalog, modules, triggers and memories;
- the [Agent Streaming Protocol v2](./docs/AGENT-PROTOCOL.md) under `/agent`, for `useStream` frontends.

Everything is stored in one SQLite file. MCP modules are installed as Docker containers or registered by URL.

## Layer

Turbo tag `layer-api`. It may import `@neosaider/contracts`, `@neosaider/core` and `@neosaider/storage`. Clients (`apps/cli`, `apps/web`) talk to it only over HTTP. See the layer rules in the root `turbo.json` and [ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

## Running

Requirements: Node 24, pnpm, an OpenAI-compatible LLM server (Ollama by default) and, to install modules, a reachable Docker daemon.

```sh
cp .env.example .env            # at the repo root; set NEOSAIDER_API_TOKEN
pnpm install
pnpm --filter @neosaider/harness dev
```

| Script        | Command                                                          |
| ------------- | ---------------------------------------------------------------- |
| `build`       | `tsc` to `dist/`                                                 |
| `dev`         | Build, then run `dist/server.js` with the root `.env` if present |
| `start`       | `node dist/server.js` (no `.env` loading)                        |
| `test`        | `node --test "dist/**/*.test.js"`                                |
| `lint`        | `eslint .`                                                       |
| `check-types` | `tsc --noEmit`                                                   |

Run them with `pnpm --filter @neosaider/harness <script>`. There is no watch mode: `dev` compiles once.

With Docker Compose the harness is the `harness` service built from the root `Dockerfile` (`PACKAGE=@neosaider/harness`); see [CONFIGURATION.md](./docs/CONFIGURATION.md#docker-compose-overrides).

## Configuration

All configuration comes from environment variables. The essentials:

| Variable                | Default                     |
| ----------------------- | --------------------------- |
| `NEOSAIDER_API_TOKEN`   | required                    |
| `PORT`                  | `3000`                      |
| `NEOSAIDER_DB_PATH`     | `neosaider.db`              |
| `NEOSAIDER_CATALOG_URL` | repo `modules/catalog.json` |
| `NEO_LLM_BASE_URL`      | `http://localhost:11434/v1` |
| `NEO_CHAT_MODEL`        | `qwen3:8b`                  |

Full list and details: [docs/CONFIGURATION.md](./docs/CONFIGURATION.md).

## Routes

All routes except `GET /health` require `Authorization: Bearer <NEOSAIDER_API_TOKEN>`.

| Method   | Path                                   | Purpose                                   |
| -------- | -------------------------------------- | ----------------------------------------- |
| `GET`    | `/health`                              | Liveness and LLM reachability (public)    |
| `GET`    | `/threads/:threadId`                   | Thread history                            |
| `POST`   | `/threads/:threadId/messages`          | Chat with SSE streaming                   |
| `GET`    | `/events?client=`                      | Proactive notifications (SSE)             |
| `GET`    | `/catalog`, `/catalog/:id`             | Search the module catalog, read one entry |
| `GET`    | `/modules`                             | Module statuses                           |
| `POST`   | `/modules`                             | Register an external HTTP module          |
| `POST`   | `/modules/install`                     | Install a catalog module in Docker        |
| `POST`   | `/modules/:name/update`                | Change the installed version              |
| `PATCH`  | `/modules/:name/config`                | Change the module configuration           |
| `GET`    | `/modules/:name/readme`, `/:name/logs` | Module README and container logs          |
| `DELETE` | `/modules/:name`                       | Uninstall or unregister                   |
| `GET`    | `/triggers`                            | List triggers                             |
| `POST`   | `/triggers`                            | Create a trigger                          |
| `DELETE` | `/triggers/:id`                        | Delete a trigger                          |
| `GET`    | `/memories`                            | List memories                             |
| `DELETE` | `/memories/:id`                        | Delete a memory                           |
| various  | `/agent/threads/...`                   | Agent Streaming Protocol v2               |

Request and response details, SSE events and curl examples: [docs/API.md](./docs/API.md). The `/agent` routes: [docs/AGENT-PROTOCOL.md](./docs/AGENT-PROTOCOL.md).

## How it is wired

| File                                               | Role                                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/config.ts`](./src/config.ts)                 | `loadConfig(env)` validates the token and builds `Config` (port, database path, catalog location, Docker network, LLM settings).                                     |
| [`src/server.ts`](./src/server.ts)                 | Entry point. Opens the database, probes Docker, creates Neo, reconciles installed modules in the background, starts the server and shuts down on `SIGINT`/`SIGTERM`. |
| [`src/app.ts`](./src/app.ts)                       | `createApp({ neo, apiToken, isLlmReachable })` builds the Hono app: error handling, auth, CORS for `/agent/*` and every REST route.                                  |
| [`src/agent-protocol.ts`](./src/agent-protocol.ts) | `createAgentProtocol(neo)` returns the Hono sub-app mounted at `/agent`.                                                                                             |

Startup sequence in `server.ts`:

1. `loadConfig()`; fails fast without a valid `NEOSAIDER_API_TOKEN`.
2. `openDatabase(config.databasePath)` from `@neosaider/storage` (runs migrations).
3. `createDockerRuntime({ composeNetwork })`; if Docker is not reachable, Neo runs without a module runtime and a warning is printed.
4. `createNeo({ db, models: createModels(config.llm), runtime, catalogLocation })`.
5. `neo.reconcileModules()` in the background: restarts installed containers, resumes interrupted installs and finishes pending removals.
6. `serve()` with `createApp(...)`.

On shutdown it closes the server, stops Neo (timers, scheduler, MCP clients), waits for pending memory work and closes the database.

`createApp` only depends on the `Neo` facade, so tests inject a Neo built with fake models and an in-memory database.

## Testing

Tests live in [`src/app.test.ts`](./src/app.test.ts) and use `node --test`, `FakeListChatModel`, `FakeEmbeddings` and `openDatabase(":memory:")`. They call `app.request()` directly, so no port, LLM or Docker is needed. They run on the compiled output, so build first:

```sh
pnpm --filter @neosaider/harness build
pnpm --filter @neosaider/harness test
```

They cover auth, chat SSE and history, validation errors, token format, notification delivery per client, the Agent Streaming Protocol (runs, state, history, CORS, consecutive runs) and the catalog without Docker.

## Documentation

- [docs/API.md](./docs/API.md): REST API reference.
- [docs/AGENT-PROTOCOL.md](./docs/AGENT-PROTOCOL.md): Agent Streaming Protocol v2.
- [docs/CONFIGURATION.md](./docs/CONFIGURATION.md): environment variables.
- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md): system architecture.
- [CATALOG.md](../../docs/CATALOG.md): catalog format.
- [CREATING-A-MODULE.md](../../packages/module-sdk/docs/CREATING-A-MODULE.md): building a module.
- [CONTRIBUTING.md](../../CONTRIBUTING.md): contribution guide.
