# AGENTS.md

`@neosaider/typescript-config`: shared `tsconfig` bases (`base`, `node`, `nextjs`, `react-library`). Turbo tag `layer-toolchain`; every layer may depend on it.

- JSON only, no build or tests. Changes affect every package: run `pnpm build` and `pnpm check-types` from the root after editing.
- `node.json` sets `outDir`/`rootDir` with `${configDir}`; packages must keep sources in `src/` and output in `dist/`, where `node --test` looks for tests.

See [README.md](./README.md).
