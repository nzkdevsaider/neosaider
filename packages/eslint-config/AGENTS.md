# AGENTS.md

`@neosaider/eslint-config`: shared ESLint flat configs (`base`, `next-js`, `react-internal`). Turbo tag `layer-toolchain`; every layer may depend on it.

- Plain JavaScript, no build or tests. Changes affect `pnpm lint` in every package: run it from the root after editing.
- `base.js` turns every rule into a warning (`eslint-plugin-only-warn`) and ignores `dist/**`.
- Add new exports to `package.json` `exports`.
- No comments in new code.

See [README.md](./README.md).
