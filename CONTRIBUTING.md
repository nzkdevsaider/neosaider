# Contributing to Neosaider

Thanks for helping improve Neosaider. This guide covers the development setup, the rules the codebase follows and how to propose changes.

## Development setup

You need:

- Node.js 24+;
- pnpm 11 (the version is pinned in `packageManager`);
- for module work, Docker.

You do not need a model server: tests use fake models.

```sh
pnpm install
cp .env.example .env    # only needed to run the harness, CLI or UI
pnpm build
```

## Commands

| Command                                     | What it does                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm build`                                | Compiles every package with Turborepo.                                   |
| `pnpm test`                                 | Runs `node --test` on the compiled output (builds first).                |
| `pnpm lint`                                 | ESLint in every package.                                                 |
| `pnpm check-types`                          | `tsc --noEmit` in every package.                                         |
| `pnpm format`                               | Prettier on every `.ts`, `.tsx` and `.md` file.                          |
| `pnpm turbo boundaries`                     | Checks the layer rules declared in `turbo.json`.                         |
| `pnpm --filter <package> <script>`          | Runs a script in one package, e.g. `pnpm --filter @neosaider/core test`. |
| `pnpm --filter @neosaider/core test:docker` | Installs the `gym` module in real Docker, then removes it.               |

Before you open a pull request, run `pnpm build && pnpm test && pnpm lint && pnpm check-types && pnpm turbo boundaries`.

## Layers

Every package declares a layer tag, and `turbo.json` lists what each layer may import:

| Layer             | Projects               | May import               |
| ----------------- | ---------------------- | ------------------------ |
| `layer-contracts` | `packages/contracts`   | toolchain only           |
| `layer-storage`   | `packages/storage`     | contracts                |
| `layer-core`      | `packages/core`        | contracts, storage       |
| `layer-api`       | `apps/harness`         | contracts, core, storage |
| `layer-client`    | `apps/cli`, `apps/web` | contracts                |
| `layer-sdk`       | `packages/module-sdk`  | contracts                |
| `layer-module`    | `modules/*`            | contracts, module SDK    |

Clients reach the harness only over HTTP, and the harness reaches modules only over MCP at runtime. If a change seems to need a forbidden import, it belongs in a lower layer, or it should be a contract in `@neosaider/contracts`.

## Conventions

- **No comments in code.** Names should explain the code. Put the reasoning in the commit message or the pull request.
- **Formatting.** Use Prettier (`pnpm format`).
- **API input.** Every input schema is a zod schema in `@neosaider/contracts`, applied with `@hono/zod-validator`.
- **Migrations.** Only append new entries to the array in `packages/storage/src/migrations.ts`. Never edit an existing one.
- **Module manifest.** If you change `moduleManifestSchema`, regenerate `docs/schemas/module-manifest.schema.json` with `pnpm --filter @neosaider/contracts schema`. A test fails if they differ.
- **Tests.** Use `node --test` on `dist`, with fake models from `packages/core/src/fakes.ts` and in-memory SQLite. Every logic change leaves at least one test that fails if the change breaks.
- **Dependencies.** Prefer the standard library and dependencies that are already installed. Add a new one only when it clearly pays for itself.

## Documentation

Documentation is in English and is organized by scope:

| Scope                 | Location                           | Content                                                                              |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| Whole monorepo        | [`docs/`](./docs/)                 | Architecture (arc42), the catalog format, the manifest JSON Schema and the diagrams. |
| One project, overview | `<project>/README.md`              | What it does, how to run and test it, and its public API.                            |
| One project, detail   | `<project>/docs/*.md`              | One topic per file, e.g. `apps/harness/docs/API.md`.                                 |
| Agent guidance        | `AGENTS.md`, `<project>/AGENTS.md` | Rules and pitfalls for AI coding agents.                                             |

Rules for Markdown in a `docs/` folder:

- Front matter with `title` and `description`.
- Only relative links.
- Diagrams in `mermaid` blocks.
- A single `#` heading.
- Section titles without accents.

If a change alters the architecture, update [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and, when components or connections change, the diagrams. The diagrams are [`docs/architecture.html`](./docs/architecture.html) and the sources in [`docs/diagrams/`](./docs/diagrams/). Then re-export the `.svg` and `.png` files next to their `.html` sources.

## Adding a module

1. Copy `modules/_template` and follow [Creating a module](./packages/module-sdk/docs/CREATING-A-MODULE.md).
2. Add an entry to [`modules/catalog.json`](./modules/catalog.json), following the [catalog format](./docs/CATALOG.md).
3. Add a build service for its image to `docker-compose.yml` under the `modules` profile.
4. Include tests that run without Docker. Use `test:docker` only for end-to-end checks.

## Pull requests

- Keep each pull request focused on one change, and describe what changed and why.
- Update the README or `docs/` of every project the change affects.
- Make sure the checks listed in [Commands](#commands) pass.

## License

By contributing, you agree that your contributions are licensed under the [GNU Affero General Public License v3.0](./LICENSE.md).
