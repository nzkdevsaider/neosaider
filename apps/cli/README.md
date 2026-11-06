# @neosaider/cli

Interactive terminal client for the Neosaider harness. It chats with Neo over SSE, prints proactive notifications as they arrive and manages modules, triggers and memories with slash commands. It talks to the harness only over HTTP.

## Layer

Turbo tag `layer-client`. Its only workspace dependency is `@neosaider/contracts` (types). It never imports `@neosaider/core` or `@neosaider/storage`.

## Build and run

```sh
pnpm --filter @neosaider/cli build
pnpm --filter @neosaider/cli start            # loads the root .env if it exists
pnpm --filter @neosaider/cli start morning    # open thread "morning"
```

The package also declares a `neo` binary (`dist/cli.js`). Run directly, it does not load `.env`, so export the variables first:

```sh
NEOSAIDER_API_TOKEN=... node apps/cli/dist/cli.js [threadId]
```

| Script        | Command                                            |
| ------------- | -------------------------------------------------- |
| `build`       | `tsc` to `dist/`                                   |
| `start`       | `node --env-file-if-exists=../../.env dist/cli.js` |
| `test`        | `node --test "dist/**/*.test.js"`                  |
| `lint`        | `eslint .`                                         |
| `check-types` | `tsc --noEmit`                                     |

On startup the CLI calls `GET /health`. It exits with an error if the harness is unreachable, and prints a warning if the harness cannot reach its LLM.

## Environment

| Variable              | Default                            | Use                                                   |
| --------------------- | ---------------------------------- | ----------------------------------------------------- |
| `NEOSAIDER_API_TOKEN` | required                           | Bearer token of the harness; the CLI exits without it |
| `NEOSAIDER_URL`       | `http://localhost:${PORT ?? 3000}` | Harness base URL                                      |
| `PORT`                | `3000`                             | Only used to build the default URL                    |
| `NEOSAIDER_CLIENT`    | the machine's hostname             | Client name for the notification cursor               |

## Threads

The first positional argument is the thread id; the default is `cli`. Threads are server-side, so reopening the same id continues the same conversation, from this or any other client. `/new` switches to a fresh id `cli-<8 hex chars>`. The prompt shows the current thread: `cli> `.

Any line that does not start with `/` is sent to `POST /threads/:threadId/messages`. Tokens are printed as they stream; tool calls appear dimmed as `→ name {args}` and results as `← name: <first 200 chars>`; errors in red.

Every string the CLI receives from the harness (tokens, tool results, errors, history, modules, triggers, memories and suggestions) has its control characters, except newline and tab, replaced with visible escapes such as `\x1b` for ESC, so a module or the model cannot inject terminal escape sequences.

## Commands

| Command                                         | Harness call                          | Effect                                                                               |
| ----------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `/thread`                                       | none                                  | Show the current thread id                                                           |
| `/thread <id>`                                  | none                                  | Switch to thread `<id>`                                                              |
| `/new`                                          | none                                  | Switch to a new random thread                                                        |
| `/history`                                      | `GET /threads/:threadId`              | Print the current thread                                                             |
| `/modules`                                      | `GET /modules`                        | List modules with version, URL or state and error                                    |
| `/modules add <name> <url>`                     | `POST /modules`                       | Register an external HTTP MCP module                                                 |
| `/modules rm <name>`                            | `DELETE /modules/:name?keepData=true` | Unregister an external module, or uninstall an installed one keeping its data volume |
| `/triggers`                                     | `GET /triggers`                       | List triggers (`cron`, `once` and `event`)                                           |
| `/triggers add cron <m h dom mon dow> <prompt>` | `POST /triggers`                      | Create a cron trigger; the first 5 words are the schedule                            |
| `/triggers add session <prompt>`                | `POST /triggers`                      | Create an `event` trigger on `session.start` (a client connects to `/events`)        |
| `/triggers rm <id>`                             | `DELETE /triggers/:id`                | Delete a trigger                                                                     |
| `/memories`                                     | `GET /memories`                       | List memories with their kind                                                        |
| `/memories rm <id>`                             | `DELETE /memories/:id`                | Delete a memory                                                                      |
| `/help`                                         | none                                  | Show the help                                                                        |
| `/quit`, `/exit`                                | none                                  | Exit                                                                                 |

Unknown commands and malformed arguments print the help. HTTP errors are printed in red as `METHOD path → <response body or status>`. One-shot (`once`) triggers can be listed but not created from the CLI; use `POST /triggers` (see the [harness API](../harness/docs/API.md#triggers)).

## Notifications

In the background the CLI keeps `GET /events?client=<NEOSAIDER_CLIENT>` open and prints each `suggestion` as `neo (proactive)> <content>`, then redraws the prompt. Because the harness keeps a cursor per client name, notifications fired while the CLI was closed are delivered on the next start, once per client name. Use a distinct `NEOSAIDER_CLIENT` per terminal if each one should receive every notification. If the stream drops, the CLI prints `suggestions disconnected` and does not reconnect.

## Source

| File                                   | Content                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| [`src/cli.ts`](./src/cli.ts)           | Entry point: env, health check, readline loop, notification listener |
| [`src/client.ts`](./src/client.ts)     | `createClient(baseUrl, token)`: typed HTTP client of the harness     |
| [`src/commands.ts`](./src/commands.ts) | `runCommand` and the help text                                       |
| [`src/sse.ts`](./src/sse.ts)           | `parseServerSentEvents`: SSE parser over text chunks                 |

## Tests

[`src/cli.test.ts`](./src/cli.test.ts) uses `node --test` with a fake client (no harness needed). It checks that SSE events are reassembled across chunk boundaries, that harness text arrives with control characters neutralized, and that chat output, thread switching and `/quit` work. Tests run on `dist`, so build first:

```sh
pnpm --filter @neosaider/cli build && pnpm --filter @neosaider/cli test
```

## See also

- [Harness API](../harness/docs/API.md)
- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
