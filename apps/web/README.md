# @neosaider/web

Local web interface for the Neosaider harness, built with Next.js 16 (App Router), React 19 and Tailwind CSS 4. It offers a chat with Neo, a store to browse and install catalog modules, a page to manage installed modules, and toasts for proactive notifications. The UI text is in Spanish.

The browser never sees the harness token: every request goes through a server-side proxy that adds it.

## Layer

Turbo tag `layer-client`. Its only workspace dependency is `@neosaider/contracts` (types). It never imports `@neosaider/core` or `@neosaider/storage`; it reaches the harness only over HTTP.

## Running

```sh
pnpm --filter @neosaider/web dev     # http://127.0.0.1:3001
pnpm --filter @neosaider/web build
pnpm --filter @neosaider/web start   # serves the build on 127.0.0.1:3001
```

The harness must be running. `next.config.ts` loads the root `.env` with `process.loadEnvFile` when it exists, so the same file configures the harness, the CLI and the web app.

| Script        | Command                                       |
| ------------- | --------------------------------------------- |
| `dev`         | `next dev --port 3001 --hostname 127.0.0.1`   |
| `build`       | `next build` (standalone output)              |
| `start`       | `next start --port 3001 --hostname 127.0.0.1` |
| `lint`        | `eslint --max-warnings 0`                     |
| `check-types` | `next typegen && tsc --noEmit`                |
| `test`        | `node --test "lib/**/*.test.ts"`              |

Tests run the `.ts` sources directly with Node's type stripping; they import with the `.ts` extension (`allowImportingTsExtensions`).

## Environment

They are read on the server only, at request time.

| Variable                      | Default                 | Use                                                                                                           |
| ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NEOSAIDER_URL`               | `http://localhost:3000` | Harness base URL (trailing `/` removed)                                                                       |
| `NEOSAIDER_API_TOKEN`         | required                | Token added to every request to the harness                                                                   |
| `NEOSAIDER_WEB_ALLOWED_HOSTS` | empty                   | Comma-separated extra hostnames accepted in `Host` and `Origin`, besides `localhost`, `127.0.0.1` and `[::1]` |

Without the token, every server-side call to the harness throws `NEOSAIDER_API_TOKEN is not configured`. `NEOSAIDER_URL` and `NEOSAIDER_API_TOKEN` are also listed as `env` of the `build` task in `turbo.json`, so they are part of the build cache key.

## Why it listens on 127.0.0.1

The proxy attaches the harness token to any request it receives and the app has no login of its own. Anyone who can reach the web app can therefore use the harness with full rights. `dev` and `start` bind to `127.0.0.1`, and Docker Compose publishes it as `127.0.0.1:3001`, so only the local machine can reach it. Do not expose it on other interfaces.

## Request guard

`proxy.ts` (Next 16 Proxy, formerly middleware) runs on every route and calls `isRequestAllowed` from `lib/request-guard.ts`:

- Every route answers `403` when the `Host` hostname is not `localhost`, `127.0.0.1`, `[::1]` or a name in `NEOSAIDER_WEB_ALLOWED_HOSTS`. Ports are ignored. This blocks DNS rebinding and requests addressed to a container name such as `web:3001`.
- `/api/harness/*` also answers `403` when `Sec-Fetch-Site` is `cross-site` or `same-site`, or when an `Origin` header is present with a hostname outside the list. Same-origin requests, direct navigation and `curl` pass.

Remaining limit: the guard does not authenticate the caller. On a multi-user host, any local OS user or process that can connect to `127.0.0.1:3001` can still use the proxy with the harness token, so the UI is meant for single-user machines.

## Pages

| Route           | File                        | Rendering                     | Content                                                                                                       |
| --------------- | --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/`             | `app/page.tsx`              | Client only (`ssr: false`)    | Chat: thread list, messages and composer with `useStream`                                                     |
| `/store`        | `app/store/page.tsx`        | Server, dynamic               | Catalog search (`q`) and tag filter (`tag`) via `GET /catalog`; cards link to the detail page                 |
| `/store/[id]`   | `app/store/[id]/page.tsx`   | Server, dynamic               | `GET /catalog/:id`: README, manifest details, network permissions, and an install form or a link if installed |
| `/modules`      | `app/modules/page.tsx`      | Static page, client component | Installed and external modules with update, configure, logs and uninstall actions                             |
| `/modules/[id]` | `app/modules/[id]/page.tsx` | Server, dynamic               | One module from `GET /modules`: README (`/modules/:name/readme`), state, volume, URL and its tools            |

`app/layout.tsx` renders the navigation and the notification toasts on every page.

## Components

| Component                        | Role                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/chat.tsx`            | `useStream` with `HttpAgentServerAdapter`; `commands`, `stream` and `state` paths point at `/api/harness/agent/threads/:id/...`. The sidebar reads `GET /agent/threads` and refreshes when a run ends.                                |
| `components/client-chat.tsx`     | Loads `Chat` with `next/dynamic` and `ssr: false`, since it needs `window`.                                                                                                                                                           |
| `components/notifications.tsx`   | `EventSource` on `/api/harness/events?client=web`; shows each `suggestion` as a toast for 15 seconds.                                                                                                                                 |
| `components/modules-manager.tsx` | Polls `GET /modules` and `GET /catalog` every 3 seconds. Offers update to the latest catalog version, configure (`PATCH /modules/:name/config`), logs (`GET /modules/:name/logs?tail=200`) and uninstall with an option to keep data. |
| `components/install-form.tsx`    | Installs the latest catalog version with `POST /modules/install`, then goes to `/modules`.                                                                                                                                            |
| `components/config-fields.tsx`   | Form fields from the manifest `config`; secret fields are password inputs. `readConfig` drops empty values.                                                                                                                           |
| `components/module-card.tsx`     | Catalog card for the store.                                                                                                                                                                                                           |
| `components/dialog.tsx`          | Modal dialog used by the modules manager.                                                                                                                                                                                             |
| `components/markdown.tsx`        | `react-markdown` with GFM and raw HTML skipped, for READMEs.                                                                                                                                                                          |
| `components/nav.tsx`             | Top navigation: Chat, Tienda, Módulos.                                                                                                                                                                                                |

| Library                | Role                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/harness.ts`       | Server-only (`import "server-only"`). `harnessFetch` adds `Authorization: Bearer` and `cache: "no-store"`; `harnessJson` returns `undefined` on `404`. |
| `lib/client-api.ts`    | Browser helper `harnessRequest` that calls `/api/harness/*` and returns `{ data }` or `{ error }`.                                                     |
| `lib/request-guard.ts` | Pure `Host`/`Origin`/`Sec-Fetch-Site` check used by `proxy.ts`.                                                                                        |
| `lib/labels.ts`        | Spanish labels for install states and network permissions.                                                                                             |

## Harness proxy

`app/api/harness/[...path]/route.ts` forwards `GET`, `POST`, `PATCH` and `DELETE` from `/api/harness/<path>?<query>` to `<NEOSAIDER_URL>/<path>?<query>` through `harnessFetch`, so the token is added on the server and never reaches the browser.

- A request body is forwarded only when the request has a `Content-Type`; the harness rejects non-JSON bodies with `415`.
- Request headers forwarded: `content-type`, `accept`, `last-event-id`. Everything else, including cookies and any client `Authorization`, is dropped.
- Request bodies are streamed (`duplex: "half"`); the client's abort signal is passed on, so closing an `EventSource` closes the upstream stream.
- Response headers forwarded: `content-type`, `cache-control`, plus `x-accel-buffering: no` so SSE is not buffered.
- The upstream status and body are returned as is.
- The route is `force-dynamic`.

Server components call the harness directly with `harnessJson`/`harnessFetch`; client components go through the proxy.

## Docker

`next.config.ts` sets `output: "standalone"` with the repo root as `outputFileTracingRoot`. The root `Dockerfile` has a `web` target that copies `.next/standalone` and `.next/static` and runs `node apps/web/server.js` with `HOSTNAME=0.0.0.0` and `PORT=3001`. In `docker-compose.yml` the `web` service loads `.env`, sets `NEOSAIDER_URL=http://harness:3000` and publishes `127.0.0.1:3001:3001`.

```sh
docker compose up --build web
```

## See also

- [Harness API](../harness/docs/API.md)
- [Agent Streaming Protocol](../harness/docs/AGENT-PROTOCOL.md)
- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [CATALOG.md](../../docs/CATALOG.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
