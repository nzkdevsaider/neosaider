import { timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import {
  hostHeaderValidation,
  NodeStreamableHTTPServerTransport,
} from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import {
  moduleManifestSchema,
  type ModuleConfigValues,
  type ModuleManifest,
} from "@neosaider/contracts";

export const SDK_VERSION = "0.1.0";

export const MANIFEST_FILE = "neosaider.module.json";

export type ModuleContext = {
  manifest: ModuleManifest;
  dataDir: string;
  config: ModuleConfigValues;
  log: (message: string) => void;
};

export type ModuleInstance = {
  register: (server: McpServer) => void;
  close?: () => void;
};

export type ModuleDefinition = {
  manifest: ModuleManifest;
  readme: string;
  create: (context: ModuleContext) => ModuleInstance;
};

type DefineModuleInput = {
  root: URL;
  create: ModuleDefinition["create"];
};

export function defineModule({
  root,
  create,
}: DefineModuleInput): ModuleDefinition {
  const manifest = moduleManifestSchema.parse(
    JSON.parse(readFileSync(new URL(MANIFEST_FILE, root), "utf8")),
  );
  let readme = "";
  try {
    readme = readFileSync(new URL("README.md", root), "utf8");
  } catch {
    readme = `# ${manifest.name}\n\n${manifest.description}\n`;
  }
  return { manifest, readme, create };
}

export function resolveConfig(
  manifest: ModuleManifest,
  env: NodeJS.ProcessEnv,
): ModuleConfigValues {
  const config: ModuleConfigValues = {};
  const missing: string[] = [];
  for (const field of manifest.config) {
    const value = env[field.key] ?? field.default;
    if (value !== undefined) config[field.key] = value;
    else if (field.required) missing.push(field.key);
  }
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }
  return config;
}

const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

type HttpServerOptions = {
  context: ModuleContext;
  allowedHosts?: string[];
  token?: string;
};

function hasBearer(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(header ?? "");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

function sendJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createModuleHttpServer(
  definition: ModuleDefinition,
  { context, allowedHosts = DEFAULT_ALLOWED_HOSTS, token }: HttpServerOptions,
): Server {
  const validateHost = hostHeaderValidation(allowedHosts);
  const instance = definition.create(context);
  const httpServer = createServer(async (req, res) => {
    if (!validateHost(req, res)) return;
    if (token && !hasBearer(req.headers.authorization, token)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true, id: definition.manifest.id });
      return;
    }
    if (req.method === "GET" && path === "/manifest") {
      sendJson(res, 200, definition.manifest);
      return;
    }
    if (req.method === "GET" && path === "/readme") {
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
      res.end(definition.readme);
      return;
    }
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    const server = new McpServer({
      name: `neosaider-${definition.manifest.id}`,
      version: definition.manifest.version,
    });
    instance.register(server);
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  httpServer.once("close", () => instance.close?.());
  return httpServer;
}

export function startModule(
  definition: ModuleDefinition,
  env: NodeJS.ProcessEnv = process.env,
): Server {
  const { manifest } = definition;
  const log = (message: string) => console.log(`[${manifest.id}] ${message}`);
  const context: ModuleContext = {
    manifest,
    dataDir: env.NEOSAIDER_DATA_DIR ?? manifest.dataPath,
    config: resolveConfig(manifest, env),
    log,
  };
  const allowedHosts = env.NEOSAIDER_ALLOWED_HOSTS
    ? env.NEOSAIDER_ALLOWED_HOSTS.split(",").map((host) => host.trim())
    : DEFAULT_ALLOWED_HOSTS;
  const port = Number(env.PORT ?? manifest.port);
  const host = env.HOST ?? "127.0.0.1";
  mkdirSync(context.dataDir, { recursive: true });

  const server = createModuleHttpServer(definition, {
    context,
    allowedHosts,
    token: env.NEOSAIDER_MODULE_TOKEN || undefined,
  });
  server.listen(port, host, () => {
    log(`${manifest.name} ${manifest.version} listening on ${host}:${port}`);
  });
  const shutdown = () => server.close();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}
