---
title: Harness REST API
description: Every REST route of the Neosaider harness, with auth, request schemas, responses, SSE events, error codes and curl examples.
---

# Harness REST API

All routes are defined in [`src/app.ts`](../src/app.ts). Request schemas are zod schemas exported by `@neosaider/contracts` and applied with `@hono/zod-validator`. The Agent Streaming Protocol under `/agent` is documented separately in [AGENT-PROTOCOL.md](./AGENT-PROTOCOL.md).

## Conventions

The examples assume:

```sh
API=http://localhost:3000
TOKEN=<value of NEOSAIDER_API_TOKEN>
```

### Authentication

Every route except `GET /health` requires `Authorization: Bearer <NEOSAIDER_API_TOKEN>` (Hono `bearerAuth`). A missing or wrong token returns `401`. CORS is only enabled for `/agent/*`; the REST routes below send no CORS headers.

`POST`, `PUT`, `PATCH` and `DELETE` requests that carry a body (a `Content-Type`, a non-zero `Content-Length` or a `Transfer-Encoding`) must send `Content-Type: application/json`; anything else returns `415` before validation. Requests with no body, such as `POST /agent/threads`, need no `Content-Type`.

### Errors

| Status | When                                                                                                                                                      | Body                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `400`  | The body or query fails its zod schema                                                                                                                    | The zod validation result as JSON                      |
| `400`  | `ModuleInstallError` (unknown or missing config, SDK mismatch) or an invalid trigger                                                                      | `{ "error": "<message>" }`                             |
| `401`  | Missing or invalid bearer token                                                                                                                           | Plain text                                             |
| `415`  | A mutation carries a body whose `Content-Type` is not `application/json`                                                                                  | `{ "error": "Content-Type must be application/json" }` |
| `404`  | Unknown id or name                                                                                                                                        | Hono default `404 Not Found` (plain text)              |
| `404`  | `ModuleInstallError`: module not installed or not in the catalog                                                                                          | `{ "error": "<message>" }`                             |
| `409`  | Module already installed, registering an external module with the name of an installed one, or an update that widens capabilities without `acceptChanges` | `{ "error": "<message>" }`                             |
| `503`  | `ModuleInstallError`: Docker is not reachable, so modules cannot be installed, updated, configured, removed or read                                       | `{ "error": "<message>" }`                             |
| `500`  | Any other exception (logged to stderr)                                                                                                                    | `{ "error": "Internal server error" }`                 |

### Server-Sent Events

Streaming routes use `hono/streaming` `streamSSE`. Each event has `event:` set to the payload `type` and `data:` set to the JSON payload.

## Route overview

| Method   | Path                          | Purpose                                              |
| -------- | ----------------------------- | ---------------------------------------------------- |
| `GET`    | `/health`                     | Liveness and LLM reachability (public)               |
| `GET`    | `/threads/:threadId`          | Message history of a thread                          |
| `POST`   | `/threads/:threadId/messages` | Send a message and stream the answer (SSE)           |
| `GET`    | `/events`                     | Proactive notifications (SSE)                        |
| `GET`    | `/catalog`                    | Search the module catalog                            |
| `GET`    | `/catalog/:id`                | One catalog entry with its README                    |
| `GET`    | `/modules`                    | Status of every module                               |
| `POST`   | `/modules`                    | Register an external HTTP MCP module                 |
| `POST`   | `/modules/install`            | Install a module from the catalog in Docker          |
| `POST`   | `/modules/:name/update`       | Redeploy an installed module at another version      |
| `PATCH`  | `/modules/:name/config`       | Change the configuration of an installed module      |
| `GET`    | `/modules/:name/readme`       | Module README (Markdown)                             |
| `GET`    | `/modules/:name/logs`         | Container logs of an installed module                |
| `DELETE` | `/modules/:name`              | Uninstall an installed module or unregister external |
| `GET`    | `/triggers`                   | List triggers                                        |
| `POST`   | `/triggers`                   | Create a trigger                                     |
| `DELETE` | `/triggers/:id`               | Delete a trigger                                     |
| `GET`    | `/memories`                   | List long-term memories                              |
| `DELETE` | `/memories/:id`               | Delete a memory                                      |
| any      | `/agent/*`                    | [Agent Streaming Protocol v2](./AGENT-PROTOCOL.md)   |

## Health

### `GET /health`

Public. Reports whether the harness is up and whether the LLM server answers `GET <NEO_LLM_BASE_URL>/models` within 2 seconds.

```json
{ "ok": true, "llm": false }
```

```sh
curl $API/health
```

## Threads

A thread id is any string chosen by the client. Threads are persisted by the LangGraph SQLite checkpointer.

### `GET /threads/:threadId`

Returns the thread history as `ThreadMessage[]`. An unknown thread returns `[]`.

```ts
type ThreadMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: { name: string; args: unknown }[];
};
```

```sh
curl $API/threads/cli -H "Authorization: Bearer $TOKEN"
```

### `POST /threads/:threadId/messages`

Body: `chatRequestSchema`.

| Field     | Type   | Rules                    |
| --------- | ------ | ------------------------ |
| `message` | string | Trimmed, at least 1 char |

Responds `200` with an SSE stream of `ChatStreamEvent`. The stream ends after `done` or `error`. Model or tool failures arrive as an `error` event, not as an HTTP error.

| `event:`      | `data:`                                               |
| ------------- | ----------------------------------------------------- |
| `token`       | `{ "type": "token", "content": "..." }`               |
| `tool_call`   | `{ "type": "tool_call", "id"?, "name", "args" }`      |
| `tool_result` | `{ "type": "tool_result", "id"?, "name", "content" }` |
| `done`        | `{ "type": "done" }`                                  |
| `error`       | `{ "type": "error", "message": "..." }`               |

After the run, Neo queues memory extraction for the last exchange in the background.

```sh
curl -N $API/threads/cli/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"What can you do?"}'
```

## Notifications

### `GET /events`

SSE stream of proactive notifications produced by triggers. Query: `eventsQuerySchema`.

| Param    | Type   | Rules                                       |
| -------- | ------ | ------------------------------------------- |
| `client` | string | Optional, `^[\w.-]{1,64}$`; otherwise `400` |

Events:

| `event:`     | `id:`           | `data:`                                                              |
| ------------ | --------------- | -------------------------------------------------------------------- |
| `suggestion` | notification id | `{ "type": "suggestion", "id", "triggerId", "threadId", "content" }` |
| `ping`       | none            | empty, every 25 seconds                                              |

Delivery semantics:

- **With `client`**: each client name has its own cursor in the `notification_cursors` table. The first time a name is seen, its cursor starts just before the oldest undelivered notification (or at the newest notification if all were delivered). On connect the harness replays every notification after the cursor, then forwards new ones live. Each delivered notification advances the cursor, so every named client receives each notification once, even if it was offline when the notification fired.
- **Without `client`**: on connect the harness replays notifications that no client has delivered yet, then forwards new ones live. Delivery is global: once any connection delivers a notification, other anonymous clients will not get it on reconnect.

The `id:` field is informational: the harness does not read `Last-Event-ID`; resuming relies on the `client` cursor.

Every connection emits a `session.start` event on Neo's bus, which fires all `event` triggers with `event: "session.start"`.

Delivered notifications and proactive threads (`proactive:*`) older than 7 days are pruned daily at 04:00 and at startup.

```sh
curl -N "$API/events?client=laptop" -H "Authorization: Bearer $TOKEN"
```

## Catalog

The catalog is read from `NEOSAIDER_CATALOG_URL` (see [CONFIGURATION.md](./CONFIGURATION.md)) and cached for 5 minutes. Its format is described in [CATALOG.md](../../../docs/CATALOG.md).

### `GET /catalog`

Query: `catalogQuerySchema`.

| Param | Type   | Rules                                                                             |
| ----- | ------ | --------------------------------------------------------------------------------- |
| `q`   | string | Optional, max 100. Case-insensitive substring over id, name, description and tags |
| `tag` | string | Optional, max 32. Exact tag match                                                 |

Returns `CatalogEntry[]`:

```ts
type CatalogEntry = {
  manifest: ModuleManifest;
  versions: string[];
  installedVersion?: string;
};
```

`manifest` is the latest version's manifest. `installedVersion` is present when the module is installed through the harness.

```sh
curl "$API/catalog?q=gym" -H "Authorization: Bearer $TOKEN"
```

### `GET /catalog/:id`

Returns a `CatalogEntry` plus `readme` (Markdown string). When the catalog version has no `readme`, it is generated from the manifest name and description. Unknown id: `404`.

```sh
curl $API/catalog/gym -H "Authorization: Bearer $TOKEN"
```

## Modules

There are two kinds of modules:

- **Installed** modules come from the catalog and run as Docker containers named `neosaider-module-<id>`, managed by the harness.
- **External** modules are HTTP MCP servers registered by URL. The harness only connects to them.

Install, update, configure, uninstall and logs need Docker; without it they return `503`.

### `GET /modules`

Returns `ModuleStatus[]`: registered modules plus installations that are not connected yet.

```ts
type ModuleStatus = {
  name: string;
  url?: string;
  available: boolean;
  error?: string;
  tools?: { name: string; description: string }[];
  installation?: {
    state: "installing" | "running" | "stopped" | "failed" | "removing";
    manifest: ModuleManifest;
    volume: string;
    container: string;
    config: Record<string, string>;
    error?: string;
    installedAt: string;
    updatedAt: string;
  };
};
```

Values of `secret` config fields are replaced by `••••••` (`SECRET_MASK`).

### `POST /modules`

Registers an external module. Body: `moduleRegistrationSchema`.

| Field       | Type     | Rules                     |
| ----------- | -------- | ------------------------- |
| `name`      | string   | `^[a-z][a-z0-9_-]{0,31}$` |
| `transport` | `"http"` | Only HTTP is accepted     |
| `url`       | string   | Valid URL                 |

Responds `201` with the module's `ModuleStatus` (check `available` and `error`; a module that cannot be reached is still registered). Registering a name that already exists as an external module replaces it. A name that belongs to an installed module returns `409`.

```sh
curl $API/modules -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"gym","transport":"http","url":"http://localhost:3101/mcp"}'
```

### `POST /modules/install`

Installs a catalog module. Body: `installModuleRequestSchema`.

| Field     | Type                     | Rules                                           |
| --------- | ------------------------ | ----------------------------------------------- |
| `id`      | string                   | Module name pattern                             |
| `version` | string                   | Optional semver; defaults to the latest         |
| `config`  | `Record<string, string>` | Optional, values up to 4096 chars; default `{}` |

Responds `202` with the stored installation in state `installing`. The deployment continues in the background: pull the image, run the container, poll its `/health` and `/manifest` (every 500 ms, up to 60 s, and the served id and version must match), then register its `/mcp` URL and set the state to `running`, or to `failed` with an `error`. Poll `GET /modules` to follow it.

| Status | Cause                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| `400`  | Unknown config keys, missing required keys, or the manifest `sdk` range does not include the harness SDK version |
| `404`  | Id or version not in the catalog                                                                                 |
| `409`  | Already installed (a `failed` installation can be installed again)                                               |
| `503`  | Docker not reachable                                                                                             |

```sh
curl $API/modules/install -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"gym","config":{}}'
```

### `POST /modules/:name/update`

Body: `updateModuleRequestSchema` (`{ "version"?: semver, "acceptChanges"?: boolean }`, latest when omitted, `acceptChanges` defaults to `false`). Redeploys the container at that version, keeping the current configuration and the data volume. Responds `202` with the installation. `404` if not installed or the version is not in the catalog. `409` when the new manifest widens network access (`isolated` to `outbound`), turns a secret config field into a non-secret one or changes the image repository (tag and digest are ignored); the message lists the changes, and the operator repeats the request with `"acceptChanges": true` to proceed.

```sh
curl $API/modules/gym/update -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"version":"0.2.0"}'
```

### `PATCH /modules/:name/config`

Body: `updateModuleConfigSchema` (`{ "config": Record<string, string> }`). Keys missing from the body, or sent as `••••••`, keep their previous value; an empty string clears the value. The module is redeployed with the new configuration. Responds `202` with the installation. Errors as in install.

```sh
curl -X PATCH $API/modules/gym/config -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"config":{"API_KEY":"new-value"}}'
```

### `GET /modules/:name/readme`

Returns `text/markdown; charset=utf-8`. The harness first asks the running module at `<module url without /mcp>/readme` (5 s timeout); if that fails, it falls back to the catalog README. `404` when the module is unknown or has no README.

### `GET /modules/:name/logs`

Query: `moduleLogsQuerySchema` (`tail`, integer 1 to 2000, default 200). Returns the container logs as `text/plain`. `404` if not installed, `503` without Docker.

```sh
curl "$API/modules/gym/logs?tail=50" -H "Authorization: Bearer $TOKEN"
```

### `DELETE /modules/:name`

Query: `uninstallModuleQuerySchema` (`keepData`, `"true"` or `"false"`, default `"false"`).

- Installed module: stops and removes the container; the data volume is removed unless `keepData=true`.
- External module: unregisters it; `keepData` is ignored.

Responds `204`, or `404` when the name is unknown.

```sh
curl -X DELETE "$API/modules/gym?keepData=true" -H "Authorization: Bearer $TOKEN"
```

## Triggers

Triggers make Neo run a prompt on its own and deliver the answer as a notification on `/events`. Each firing runs in a new thread `proactive:<triggerId>:<timestamp>`.

### `GET /triggers`

Returns `Trigger[]`: a trigger definition plus `id` and `createdAt`.

### `POST /triggers`

Body: `triggerDefinitionSchema`, a union discriminated by `kind`:

| `kind`  | Fields                                          |
| ------- | ----------------------------------------------- |
| `cron`  | `schedule` (cron expression), `prompt`          |
| `event` | `event` (only `"session.start"`), `prompt`      |
| `once`  | `at` (ISO 8601 date-time with offset), `prompt` |

`prompt` is trimmed and must not be empty. Responds `201` with the trigger. An invalid cron expression returns `400` with `{ "error": "<message>" }`.

```sh
curl $API/triggers -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"cron","schedule":"0 8 * * 1-5","prompt":"Summarize my day"}'
```

### `DELETE /triggers/:id`

`204` when deleted. `404` when the id is not a positive integer or does not exist.

## Memories

### `GET /memories`

Returns `Memory[]`:

```ts
type Memory = {
  id: number;
  kind: "profile" | "fact";
  content: string;
  createdAt: string;
};
```

### `DELETE /memories/:id`

`204` when deleted. `404` when the id is not a positive integer or does not exist.

```sh
curl -X DELETE $API/memories/3 -H "Authorization: Bearer $TOKEN"
```
