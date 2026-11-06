# @neosaider/core

The brain of Neosaider: Neo (a LangGraph agent), long-term memory, the task scheduler and the MCP module system (catalog, installer and Docker runtime). The HTTP API in `apps/harness` is a thin layer over the object returned by `createNeo`.

- Turbo tag: `layer-core`. It may import `@neosaider/contracts` and `@neosaider/storage` only.
- ESM, compiled with `tsc` to `dist/`. Node 24.

## Public API

Everything is exported from `src/index.ts`:

| Export                                                  | Kind     | Purpose                                                                                      |
| ------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `createNeo({ db, models, runtime?, catalogLocation? })` | function | Builds Neo and all its services. Returns the `Neo` object.                                   |
| `Neo`                                                   | type     | Return type of `createNeo`.                                                                  |
| `createModels(settings)`                                | function | Creates the chat, fast and optional embeddings models from an OpenAI-compatible endpoint.    |
| `isLlmReachable({ baseUrl, apiKey })`                   | function | `GET {baseUrl}/models` with a 2 s timeout; `true` when it answers 2xx.                       |
| `LlmSettings`, `NeoModels`                              | types    | Model settings (`baseUrl`, `apiKey`, `chatModel`, `fastModel`, `embedModel?`) and model set. |
| `EventBus`                                              | type     | Typed `EventEmitter` with `session.start` and `suggestion` events.                           |
| `createDockerRuntime({ docker?, composeNetwork? })`     | function | Docker implementation of `ModuleRuntime`.                                                    |
| `moduleResourceName(id)`                                | function | `neosaider-module-<id>`: name of a module's container and volume.                            |
| `ModuleRuntime`, `RunningModule`, `RuntimeModuleSpec`   | types    | Runtime contract used by the installer.                                                      |
| `ModuleInstallError`                                    | class    | Installer error carrying an HTTP status (`400`, `404`, `409` or `503`).                      |
| `SUPPORTED_SDK_VERSION`                                 | constant | SDK version this harness supports (`0.1.0`); manifests declare a semver range in `sdk`.      |

### The Neo object

| Member                                                          | Description                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `chat(threadId, message)`                                       | Async generator of `ChatStreamEvent` (`token`, `tool_call`, `tool_result`, `done`, `error`).                                    |
| `run(threadId, message)`                                        | Runs the graph to completion and returns the last message text.                                                                 |
| `history(threadId)`                                             | Thread messages as `ThreadMessage[]`.                                                                                           |
| `graph()`, `checkpointer`                                       | The current compiled graph (it is rebuilt when modules change) and the SQLite checkpointer.                                     |
| `extractAfterRun(threadId)`                                     | Queues memory extraction of the last exchange; used by the Agent Streaming Protocol runs.                                       |
| `threadIds()`                                                   | Conversation thread ids, excluding proactive threads.                                                                           |
| `bus`                                                           | The event bus.                                                                                                                  |
| `memory`, `memories.list()`, `memories.delete(id)`              | Memory manager and stored memories.                                                                                             |
| `triggers.list/create/delete`                                   | Scheduled tasks. `create` validates cron expressions and reloads the scheduler.                                                 |
| `notifications.pending(client?)`, `acknowledge(id, client?)`    | Notification inbox, global or per client cursor.                                                                                |
| `modules.*`                                                     | `statuses`, `register`, `unregister`, `isManaged`, `install`, `update`, `configure`, `uninstall`, `logs`, `readme`, `whenIdle`. |
| `catalog.search(query)`, `catalog.get(id)`, `catalog.refresh()` | Module store backed by the catalog.                                                                                             |
| `reconcileModules()`                                            | Brings Docker in line with `installed_modules` at startup.                                                                      |
| `pruneProactiveThreads(now?)`                                   | Retention sweep (also run at startup and daily at 04:00).                                                                       |
| `close()`                                                       | Stops timers, scheduler and MCP connections.                                                                                    |

## Building blocks

| File                        | Responsibility                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/neo.ts`                | `createNeo`: wires everything, builds the graph, chat/run/history, proactive runs, retention, module reconnection. |
| `src/graph.ts`              | `buildNeoGraph`: `recall → agent ⇄ tools` LangGraph `StateGraph`; refuses durable tools after module output.       |
| `src/self-description.ts`   | `describeNeosaider`: system prompt built from the live harness state.                                              |
| `src/memory.ts`             | Memory manager: extraction queue, consolidation, recall, `remember` and `recall` tools.                            |
| `src/scheduler.ts`          | Runs triggers with croner and the event bus; `assertValidSchedule`.                                                |
| `src/scheduling.ts`         | Tools `schedule_task`, `list_scheduled_tasks`, `cancel_scheduled_task`.                                            |
| `src/events.ts`             | `createEventBus`.                                                                                                  |
| `src/modules.ts`            | Module manager: one `MCPAdapter` per registered HTTP module; truncates, de-artifacts and de-duplicates tools.      |
| `src/catalog.ts`            | Catalog loading, validation, 5-minute cache, search and READMEs.                                                   |
| `src/module-installer.ts`   | Install, update, configure, uninstall, reconcile and logs; secret masking.                                         |
| `src/module-runtime.ts`     | Docker runtime with dockerode.                                                                                     |
| `src/models.ts`             | `createModels`, `isLlmReachable`.                                                                                  |
| `src/fakes.ts`              | Test doubles: `ScriptedChatModel`, `structuredReply`, `fakeEmbeddings`, `axis`.                                    |
| `src/docker-integration.ts` | End-to-end test against a real Docker daemon.                                                                      |

Details:

- [docs/AGENT.md](./docs/AGENT.md): graph, tools, system prompt, models, threads and retention.
- [docs/MEMORY.md](./docs/MEMORY.md): extraction, consolidation and recall.
- [docs/SCHEDULER.md](./docs/SCHEDULER.md): triggers, event bus and notifications.
- [docs/MODULE-RUNTIME.md](./docs/MODULE-RUNTIME.md): module manager, catalog, installer and Docker runtime.

## Usage

```ts
import { createModels, createNeo, createDockerRuntime } from "@neosaider/core";
import { openDatabase } from "@neosaider/storage";

const db = openDatabase("neosaider.db");
const runtime = createDockerRuntime();
const neo = await createNeo({
  db,
  models: createModels({
    baseUrl: "http://localhost:11434/v1",
    apiKey: "local",
    chatModel: "qwen3:8b",
    fastModel: "qwen3:1.7b",
    embedModel: "nomic-embed-text",
  }),
  runtime: (await runtime.available()) ? runtime : undefined,
  catalogLocation: "modules/catalog.json",
});
await neo.reconcileModules();

for await (const event of neo.chat("main", "Hi, I am Ana")) console.log(event);
await neo.close();
```

## Commands

```sh
pnpm --filter @neosaider/core build
pnpm --filter @neosaider/core test          # node --test over dist/**/*.test.js, no LLM or Docker
pnpm --filter @neosaider/core test:docker   # installs gym in real Docker and removes it
pnpm --filter @neosaider/core lint
pnpm --filter @neosaider/core check-types
```

Tests run on compiled code: build first. Unit tests use the fakes in `src/fakes.ts`, in-memory SQLite (`openDatabase(":memory:")`) and a fake `ModuleRuntime` with local HTTP servers.

## Related documentation

- [Architecture](../../docs/ARCHITECTURE.md)
- [Module catalog](../../docs/CATALOG.md)
- [Creating a module](../../packages/module-sdk/docs/CREATING-A-MODULE.md)
- [Harness API](../../apps/harness/docs/API.md)
- [Storage](../storage/README.md) and [contracts](../contracts/README.md)
