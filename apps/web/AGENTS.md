# AGENTS.md

`@neosaider/web` is the local Next.js 16 UI of Neosaider: chat with `useStream`, module store, module management and notification toasts. Turbo layer tag: `layer-client`.

## Imports

- Allowed: `@neosaider/contracts` (types), Next.js, React, `@langchain/react`, `@langchain/core`, `react-markdown`.
- Forbidden: `@neosaider/core`, `@neosaider/storage`, `@neosaider/harness`. The web app reaches the harness only over HTTP. Check with `pnpm turbo boundaries`.

## Commands

```sh
pnpm --filter @neosaider/web dev           # 127.0.0.1:3001, needs a running harness
pnpm --filter @neosaider/web build
pnpm --filter @neosaider/web lint          # zero warnings allowed
pnpm --filter @neosaider/web check-types
pnpm --filter @neosaider/web test          # node --test on lib/**/*.test.ts, no build
```

Tests import sources with the `.ts` extension so Node's type stripping can run them.

## Key files

- `proxy.ts` and `lib/request-guard.ts`: Host allowlist on every route, plus `Origin`/`Sec-Fetch-Site` checks on `/api/harness/*`.
- `app/api/harness/[...path]/route.ts`: proxy to the harness that adds the token.
- `lib/harness.ts`: server-only fetch helpers holding `NEOSAIDER_API_TOKEN`.
- `lib/client-api.ts`: browser helper that always goes through `/api/harness`.
- `components/chat.tsx`: `useStream` against `/api/harness/agent`.
- `components/modules-manager.tsx`: module actions.

## Pitfalls

- Never import `lib/harness.ts` or read `NEOSAIDER_API_TOKEN` from a client component; the token must stay on the server. Client code calls `/api/harness/*`.
- Keep `dev` and `start` bound to `127.0.0.1`: the proxy grants full harness access to anyone who can reach it. A new hostname for the UI must be added to `NEOSAIDER_WEB_ALLOWED_HOSTS` or every request gets `403`.
- Browser calls to the harness must send `content-type: application/json` with a body; the harness returns `415` otherwise.
- New harness routes need no proxy changes, but new methods (for example `PUT`) must be exported from the proxy route.
- UI text is in Spanish; keep it consistent.
- No code comments; names must explain the code. Format with Prettier. No commits or pushes.

## Docs

[README.md](./README.md), [harness API](../harness/docs/API.md), [Agent Streaming Protocol](../harness/docs/AGENT-PROTOCOL.md).
