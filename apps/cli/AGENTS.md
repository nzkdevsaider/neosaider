# AGENTS.md

`@neosaider/cli` is the terminal client of the Neosaider harness: chat over SSE, proactive notifications and slash commands for modules, triggers and memories. Turbo layer tag: `layer-client`.

## Imports

- Allowed: `@neosaider/contracts` (types and schemas) and Node built-ins. No runtime dependencies beyond that.
- Forbidden: `@neosaider/core`, `@neosaider/storage`, `@neosaider/harness`. The CLI talks to the harness only over HTTP. Check with `pnpm turbo boundaries`.

## Commands

```sh
pnpm --filter @neosaider/cli build
pnpm --filter @neosaider/cli test          # runs on dist: build first
pnpm --filter @neosaider/cli start         # needs a running harness and NEOSAIDER_API_TOKEN
pnpm --filter @neosaider/cli lint
pnpm --filter @neosaider/cli check-types
```

## Key files

- `src/cli.ts`: entry point, env vars, readline loop, notification listener.
- `src/commands.ts`: `runCommand` and `HELP`; every slash command lives here.
- `src/client.ts`: typed fetch client for the harness routes.
- `src/sse.ts`: SSE parser.
- `src/cli.test.ts`: tests with a fake client.

## Pitfalls

- Use the types from `@neosaider/contracts` for every request and response; never redefine them.
- A new slash command must be added to `HELP`, handled in `runCommand` and listed in `README.md`.
- `runCommand` writes through the `Output` interface so tests can capture it; do not write to `stdout` directly from commands.
- Tests run on `dist`, use no network and must stay that way. Each logic change needs a test that fails if it breaks.
- No code comments; names must explain the code. Format with Prettier. No commits or pushes.

## Docs

[README.md](./README.md), [harness API](../harness/docs/API.md).
