import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { moduleManifestSchema } from "@neosaider/contracts";
import { z } from "zod";
import {
  createModuleHttpServer,
  resolveConfig,
  type ModuleDefinition,
} from "./index.js";

const manifest = moduleManifestSchema.parse({
  id: "echo",
  name: "Echo",
  version: "1.2.3",
  description: "Repeats what it receives.",
  author: "Tests",
  license: "MIT",
  sdk: "^0.1.0",
  image: "neosaider/module-echo:1.2.3",
  config: [
    { key: "GREETING", description: "Prefix", default: "hi" },
    { key: "API_TOKEN", description: "Token", required: true, secret: true },
  ],
});

test("config comes from the environment, falls back to defaults and requires what is required", () => {
  assert.deepEqual(resolveConfig(manifest, { API_TOKEN: "t" }), {
    GREETING: "hi",
    API_TOKEN: "t",
  });
  assert.throws(() => resolveConfig(manifest, {}), /API_TOKEN/);
});

test("a module serves its tools over MCP plus health, manifest and readme", async () => {
  let closed = false;
  const definition: ModuleDefinition = {
    manifest,
    readme: "# Echo\n",
    create: ({ config }) => ({
      register(server) {
        server.registerTool(
          "echo",
          {
            description: "Echo the text back.",
            inputSchema: z.object({ text: z.string() }),
          },
          async ({ text }) => ({
            content: [{ type: "text", text: `${config.GREETING} ${text}` }],
          }),
        );
      },
      close: () => {
        closed = true;
      },
    }),
  };
  const server = createModuleHttpServer(definition, {
    context: {
      manifest,
      dataDir: "/tmp",
      config: { GREETING: "hey" },
      log: () => undefined,
    },
    allowedHosts: ["127.0.0.1"],
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const adapter = new MCPAdapter({
    servers: { echo: { transport: "http", url: `${base}/mcp` } },
    prefixToolNameWithServerName: true,
  });
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), {
      ok: true,
      id: "echo",
    });
    assert.deepEqual(await (await fetch(`${base}/manifest`)).json(), manifest);
    assert.equal(await (await fetch(`${base}/readme`)).text(), "# Echo\n");
    assert.equal((await fetch(`${base}/other`)).status, 404);

    const [echo] = await adapter.listTools();
    assert.equal(echo?.name, "echo_echo");
    assert.match(
      JSON.stringify(await echo!.invoke({ text: "there" })),
      /hey there/,
    );

    const rejected = await new Promise<number | undefined>((resolve, reject) =>
      request(`${base}/health`, { headers: { Host: "evil.example" } })
        .on("response", (response) => {
          response.resume();
          resolve(response.statusCode);
        })
        .on("error", reject)
        .end(),
    );
    assert.equal(rejected, 403);
  } finally {
    await adapter.close();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.ok(closed);
});

test("a module started with a token only answers callers that present it", async () => {
  const server = createModuleHttpServer(
    {
      manifest,
      readme: "# Echo\n",
      create: () => ({ register: () => undefined }),
    },
    {
      context: { manifest, dataDir: "/tmp", config: {}, log: () => undefined },
      allowedHosts: ["127.0.0.1"],
      token: "module-secret",
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const path of ["/health", "/manifest", "/readme", "/mcp"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 401);
      assert.equal(
        (
          await fetch(`${base}${path}`, {
            headers: { Authorization: "Bearer wrong-secret" },
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await fetch(`${base}/health`, {
          headers: { Authorization: "Bearer module-secret" },
        })
      ).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
