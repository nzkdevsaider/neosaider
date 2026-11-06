# @neosaider/eslint-config

Shared ESLint flat configs for the monorepo. Turbo tag `layer-toolchain`.

| Export                                    | Export name    | Used by                      | Adds                                                                                                                                                               |
| ----------------------------------------- | -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@neosaider/eslint-config/base`           | `config`       | every package except the web | `@eslint/js` recommended, Prettier compatibility, TypeScript via `@babel/eslint-parser`, `turbo/no-undeclared-env-vars`, `dist/**` ignored, all rules as warnings. |
| `@neosaider/eslint-config/next-js`        | `nextJsConfig` | `apps/web`                   | `base` plus browser globals, Next.js and React Hooks rules, `.next/**` ignored.                                                                                    |
| `@neosaider/eslint-config/react-internal` | `config`       | nothing yet                  | `base` plus browser globals and React Hooks rules.                                                                                                                 |

## Usage

Add `"@neosaider/eslint-config": "workspace:*"` and `eslint` to `devDependencies`, then create `eslint.config.js`:

```js
import { config } from "@neosaider/eslint-config/base";

export default config;
```

Run it with `pnpm lint` (each package's `lint` script is `eslint .`).
