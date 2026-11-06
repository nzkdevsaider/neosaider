# Template

Minimal Neosaider module template. Copy it to start a new one; the full guide is in [Creating a module](../../packages/module-sdk/docs/CREATING-A-MODULE.md).

## Tools

Neo sees the tool prefixed with the module id (`template_hello`).

| Tool    | What it does                                                         |
| ------- | -------------------------------------------------------------------- |
| `hello` | Greets someone by `name` using the configured greeting (`GREETING`). |

## Configuration

| Variable   | Default | Description                        |
| ---------- | ------- | ---------------------------------- |
| `GREETING` | `Hola`  | Greeting used by the `hello` tool. |

## Data

None. The module does not write to its data directory (`/data`).

## Permissions

Isolated network: only the harness can talk to it and it makes no outbound connections.

## Development

| File                                               | Content                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`neosaider.module.json`](./neosaider.module.json) | Manifest: id `template`, image `neosaider/module-template:0.1.0`, `GREETING` config. |
| [`src/template.ts`](./src/template.ts)             | The `templateModule` definition with the `hello` tool.                               |
| [`src/server.ts`](./src/server.ts)                 | Entry point: `startModule(templateModule)`.                                          |
| [`src/template.test.ts`](./src/template.test.ts)   | Calls `hello` through `MCPAdapter`; copy it to test your own tools.                  |

```sh
pnpm --filter @neosaider/module-template build
pnpm --filter @neosaider/module-template test
NEOSAIDER_DATA_DIR=./data PORT=3102 pnpm --filter @neosaider/module-template start
docker build --build-arg PACKAGE=@neosaider/module-template -t neosaider/module-template:0.1.0 .
```

The template is not listed in [`modules/catalog.json`](../catalog.json), so it does not appear in the store.
