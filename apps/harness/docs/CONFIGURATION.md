---
title: Harness configuration
description: Environment variables read by the harness, their defaults and how they are used.
---

# Harness configuration

The harness is configured only through environment variables, read once at startup by `loadConfig` in [`src/config.ts`](../src/config.ts). The template is the root [`.env.example`](../../../.env.example). `pnpm dev` loads the root `.env` with `node --env-file-if-exists=../../.env`; `pnpm start` does not load any file, so export the variables yourself.

## Variables

| Variable                   | Default                             | Used for                                                                                       |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NEOSAIDER_API_TOKEN`      | none, required                      | Bearer token required by every route except `/health`                                          |
| `PORT`                     | `3000`                              | HTTP port                                                                                      |
| `NEOSAIDER_DB_PATH`        | `neosaider.db`                      | SQLite file, relative to the working directory                                                 |
| `NEOSAIDER_CATALOG_URL`    | `modules/catalog.json` of the repo  | Module catalog: `http(s)://` URL, `file://` URL or a file path                                 |
| `NEOSAIDER_DOCKER_NETWORK` | unset                               | Docker network shared with module containers when the harness itself runs in Compose           |
| `NEO_LLM_BASE_URL`         | `http://localhost:11434/v1`         | OpenAI-compatible endpoint (Ollama by default)                                                 |
| `NEO_LLM_API_KEY`          | `local`                             | API key sent to the LLM server; an empty value also becomes `local`                            |
| `NEO_CHAT_MODEL`           | `qwen3:8b`                          | Main chat model                                                                                |
| `NEO_FAST_MODEL`           | `NEO_CHAT_MODEL`, else `qwen3:1.7b` | Fast model for background work such as memory extraction                                       |
| `NEO_EMBED_MODEL`          | `nomic-embed-text`                  | Embedding model for memory; set it to an empty string to disable embeddings                    |
| `DOCKER_HOST`              | Docker default socket               | Read by the Docker client (dockerode), not by `config.ts`; Compose points it at a socket proxy |

`NEOSAIDER_URL` in `.env.example` is not read by the harness; it is for the [CLI](../../cli/README.md) and the [web app](../../web/README.md).

## Details

### NEOSAIDER_API_TOKEN

Startup fails if it is missing, or if it contains characters that cannot travel in a `Bearer` header. Allowed characters: letters, digits and `- . _ ~ + /`, optionally followed by `=` padding. Generate one with:

```sh
openssl rand -hex 32
```

### NEOSAIDER_CATALOG_URL

An empty value falls back to the development catalog, resolved from the compiled `dist/config.js` to `<repo>/modules/catalog.json`. Values with a scheme (`https://…`, `file://…`) are used as URLs; anything else is treated as a file path. The catalog is cached for 5 minutes. Format: [CATALOG.md](../../../docs/CATALOG.md).

### NEOSAIDER_DOCKER_NETWORK

Controls how the harness reaches module containers:

| Value | Container network                                                                                                                                                                    | Module URL                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| unset | `bridge`, with the module port published on `127.0.0.1` at a random host port                                                                                                        | `http://127.0.0.1:<hostPort>/mcp` |
| set   | `isolated` modules join the internal `neosaider-modules-isolated`, `outbound` modules join `neosaider-modules-outbound`; the harness joins both, and modules never join this network | `http://<container>:<port>/mcp`   |

Docker Compose sets it to `neosaider`.

`NEOSAIDER_API_TOKEN` also derives each installed module's credential (`NEOSAIDER_MODULE_TOKEN`, an HMAC of the module id). After rotating the API token, update or reinstall installed modules so their containers receive the new credential; until then the harness cannot reach them. If Docker is not reachable at startup, the harness logs a warning and runs without a module runtime: the catalog works, but install, update, configure, uninstall and logs return `503`.

### LLM settings

`/health` reports `llm: true` when `GET <NEO_LLM_BASE_URL>/models` answers successfully within 2 seconds using `NEO_LLM_API_KEY`. The harness starts even if the LLM is unreachable.

## Docker Compose overrides

The `harness` service in the root `docker-compose.yml` loads `.env` and overrides:

| Variable                   | Value                     |
| -------------------------- | ------------------------- |
| `NEOSAIDER_DB_PATH`        | `/data/neosaider.db`      |
| `NEO_LLM_BASE_URL`         | `http://ollama:11434/v1`  |
| `DOCKER_HOST`              | `tcp://docker-proxy:2375` |
| `NEOSAIDER_DOCKER_NETWORK` | `neosaider`               |
| `NEOSAIDER_CATALOG_URL`    | `/catalog/catalog.json`   |

The container publishes `${PORT:-3000}:3000`, so keep `PORT=3000` inside the container.
