# @neosaider/typescript-config

Shared `tsconfig` bases for the monorepo. Turbo tag `layer-toolchain`. It has no code, only JSON files.

| File                 | Used by                       | Settings                                                                                                     |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `base.json`          | the other configs             | `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, ES2022, `NodeNext` modules, declarations with maps. |
| `node.json`          | every Node package and module | `base` plus `lib: es2023`, Node types, `src/` compiled to `dist/` (via `${configDir}`).                      |
| `nextjs.json`        | `apps/web`                    | `base` plus the Next.js plugin, `ESNext`/`Bundler` resolution, `jsx: preserve`, `noEmit`.                    |
| `react-library.json` | nothing yet                   | `base` plus `jsx: react-jsx`.                                                                                |

## Usage

Add `"@neosaider/typescript-config": "workspace:*"` to `devDependencies` and extend a config in `tsconfig.json`:

```json
{
  "extends": "@neosaider/typescript-config/node.json",
  "include": ["src"]
}
```

`node.json` uses `${configDir}`, so `outDir` and `rootDir` resolve against the package that extends it, not this one.
