# AGENTS.md

Guidance for AI coding agents working in this repository. Read this file first. Then read the `AGENTS.md` of the project you are changing, because it adds that project's own rules.

## Project

Neosaider is the headless, local-first harness for **Neo**, a personal assistant built with LangGraph JS. It exposes an HTTP API with SSE streaming, stores everything in one SQLite file and gains capabilities through MCP modules that run as Docker containers. [README.md](./README.md) has the overview, and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) has the full architecture.

## Monorepo map

| Path                                                   | Layer (turbo tag) | Content                                                  | Read                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`                                   | `layer-contracts` | Zod schemas and shared API and manifest types.           | [README](./packages/contracts/README.md) · [AGENTS](./packages/contracts/AGENTS.md)                                                                                                                                                                                       |
| `packages/storage`                                     | `layer-storage`   | SQLite, migrations, repositories, checkpointer.          | [README](./packages/storage/README.md) · [AGENTS](./packages/storage/AGENTS.md) · [data model](./packages/storage/docs/DATA-MODEL.md)                                                                                                                                     |
| `packages/core`                                        | `layer-core`      | Neo's graph, memory, scheduler, catalog, module runtime. | [README](./packages/core/README.md) · [AGENTS](./packages/core/AGENTS.md) · [agent](./packages/core/docs/AGENT.md) · [memory](./packages/core/docs/MEMORY.md) · [scheduler](./packages/core/docs/SCHEDULER.md) · [module runtime](./packages/core/docs/MODULE-RUNTIME.md) |
| `apps/harness`                                         | `layer-api`       | Hono API and Agent Streaming Protocol v2 under `/agent`. | [README](./apps/harness/README.md) · [AGENTS](./apps/harness/AGENTS.md) · [API](./apps/harness/docs/API.md) · [protocol](./apps/harness/docs/AGENT-PROTOCOL.md) · [configuration](./apps/harness/docs/CONFIGURATION.md)                                                   |
| `apps/cli`                                             | `layer-client`    | Terminal client; depends only on `contracts`.            | [README](./apps/cli/README.md) · [AGENTS](./apps/cli/AGENTS.md)                                                                                                                                                                                                           |
| `apps/web`                                             | `layer-client`    | Next.js UI: chat, store, module management; token proxy. | [README](./apps/web/README.md) · [AGENTS](./apps/web/AGENTS.md)                                                                                                                                                                                                           |
| `packages/module-sdk`                                  | `layer-sdk`       | Module SDK: `defineModule` and `startModule`.            | [README](./packages/module-sdk/README.md) · [AGENTS](./packages/module-sdk/AGENTS.md) · [creating a module](./packages/module-sdk/docs/CREATING-A-MODULE.md)                                                                                                              |
| `modules/gym`                                          | `layer-module`    | Example module built with the SDK.                       | [README](./modules/gym/README.md) · [AGENTS](./modules/gym/AGENTS.md)                                                                                                                                                                                                     |
| `modules/_template`                                    | `layer-module`    | Minimal template for new modules.                        | [README](./modules/_template/README.md) · [AGENTS](./modules/_template/AGENTS.md)                                                                                                                                                                                         |
| `modules/catalog.json`                                 | —                 | Development catalog read by the store.                   | [catalog format](./docs/CATALOG.md)                                                                                                                                                                                                                                       |
| `packages/eslint-config`, `packages/typescript-config` | toolchain         | Shared ESLint and TypeScript configs.                    | [eslint](./packages/eslint-config/README.md) · [typescript](./packages/typescript-config/README.md)                                                                                                                                                                       |

## Commands

```sh
pnpm install
pnpm build              # compile every package with turbo
pnpm test               # node --test on dist; no LLM needed
pnpm lint
pnpm check-types
pnpm format             # prettier on .ts, .tsx and .md
pnpm turbo boundaries   # check the layer rules
pnpm --filter @neosaider/core test:docker   # install gym in real Docker and remove it
docker compose --profile modules build      # harness, web and module images
```

Tests run on compiled code, so build before you test.

## Rules

- **Layers:** respect the allowed dependencies in `turbo.json` (`boundaries`). Clients (`apps/cli`, `apps/web`) never import `core` or `storage`. Modules depend only on `@neosaider/module-sdk` and `@neosaider/contracts`.
- **Contracts:** every API input schema is a zod schema in `@neosaider/contracts`, applied with `@hono/zod-validator`.
- **Module manifest:** it is validated with `moduleManifestSchema`. If you change the schema, regenerate `docs/schemas/module-manifest.schema.json` with `pnpm --filter @neosaider/contracts schema`. A test fails if they differ.
- **Migrations:** only append new entries to the array in `packages/storage/src/migrations.ts`. Never edit existing ones.
- **Tests:** `node --test` with the scripted fake models and embeddings from `packages/core/src/fakes.ts` and in-memory SQLite. Every logic change leaves at least one test that fails if it breaks.
- **Style:** no comments in code; names must explain it. Format with Prettier.
- **Git:** do not commit or push. The user does that.

## Documentation

All documentation is in English and is split by scope:

| Scope                    | Where                              | Notes                                                                                  |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------- |
| Whole monorepo           | [`docs/`](./docs/)                 | `ARCHITECTURE.md` (arc42), `CATALOG.md`, `architecture.html`, `schemas/`, `diagrams/`. |
| Project overview         | `<project>/README.md`              | Purpose, layer, how to run and test it, public API, links to its `docs/`.              |
| Project detail           | `<project>/docs/<TOPIC>.md`        | One topic per file. Only for projects with enough to split.                            |
| Agent rules              | `AGENTS.md`, `<project>/AGENTS.md` | This file, plus each project's own rules and pitfalls.                                 |
| Contributors and license | `CONTRIBUTING.md`, `LICENSE.md`    | AGPL-3.0. `LICENSE.md` is the verbatim license text; do not reformat it.               |

When you write documentation:

- Files inside any `docs/` folder start with YAML front matter (`title` and `description`).
- Use only relative links and diagrams in `mermaid` blocks, so the docs can later be published with MkDocs, Docusaurus or VitePress without rewriting.
- Use a single `#` per document, and section titles without accents.
- Keep docs in sync with the code you change. Update the README or `docs/` of every affected project.
- If a change alters the architecture (a decision, a block or a flow), update `docs/ARCHITECTURE.md`. If components or connections change, also update `docs/architecture.html` and the sources in `docs/diagrams/`, then re-export their `.svg` and `.png` files.
