import { fileURLToPath } from "node:url";
import type { LlmSettings } from "@neosaider/core";

export type Config = {
  apiToken: string;
  port: number;
  databasePath: string;
  catalogLocation: string;
  dockerNetwork?: string;
  llm: LlmSettings;
};

const DEVELOPMENT_CATALOG = fileURLToPath(
  new URL("../../../modules/catalog.json", import.meta.url),
);

const BEARER_TOKEN_FORMAT = /^[A-Za-z0-9._~+/-]+=*$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiToken = env.NEOSAIDER_API_TOKEN;
  if (!apiToken) {
    throw new Error("NEOSAIDER_API_TOKEN is required");
  }
  if (!BEARER_TOKEN_FORMAT.test(apiToken)) {
    throw new Error(
      "NEOSAIDER_API_TOKEN may only contain letters, digits and - . _ ~ + / (generate one with `openssl rand -hex 32`)",
    );
  }
  return {
    apiToken,
    port: Number(env.PORT ?? 3000),
    databasePath: env.NEOSAIDER_DB_PATH ?? "neosaider.db",
    catalogLocation: env.NEOSAIDER_CATALOG_URL || DEVELOPMENT_CATALOG,
    ...(env.NEOSAIDER_DOCKER_NETWORK && {
      dockerNetwork: env.NEOSAIDER_DOCKER_NETWORK,
    }),
    llm: {
      baseUrl: env.NEO_LLM_BASE_URL ?? "http://localhost:11434/v1",
      apiKey: env.NEO_LLM_API_KEY || "local",
      chatModel: env.NEO_CHAT_MODEL ?? "qwen3:8b",
      fastModel: env.NEO_FAST_MODEL ?? env.NEO_CHAT_MODEL ?? "qwen3:1.7b",
      embedModel: (env.NEO_EMBED_MODEL ?? "nomic-embed-text") || undefined,
    },
  };
}
