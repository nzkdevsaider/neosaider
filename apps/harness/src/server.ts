import { serve } from "@hono/node-server";
import {
  createDockerRuntime,
  createModels,
  createNeo,
  isLlmReachable,
} from "@neosaider/core";
import { openDatabase } from "@neosaider/storage";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const dockerRuntime = createDockerRuntime({
  composeNetwork: config.dockerNetwork,
});
const runtime = (await dockerRuntime.available()) ? dockerRuntime : undefined;
if (!runtime) {
  console.warn(
    "Docker is not reachable: the catalog works, but modules cannot be installed or removed.",
  );
}
const neo = await createNeo({
  db,
  models: createModels(config.llm),
  runtime,
  catalogLocation: config.catalogLocation,
  moduleSecret: config.apiToken,
});
void neo
  .reconcileModules()
  .catch((error: unknown) =>
    console.error("Module reconciliation failed", error),
  );
const app = createApp({
  neo,
  apiToken: config.apiToken,
  isLlmReachable: () => isLlmReachable(config.llm),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Neosaider listening on http://localhost:${info.port}`);
});

async function shutdown() {
  server.close();
  await neo.close();
  await neo.memory.whenIdle();
  db.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
