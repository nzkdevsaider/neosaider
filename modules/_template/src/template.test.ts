import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { createModuleHttpServer, resolveConfig } from "@neosaider/module-sdk";
import { templateModule } from "./template.js";

test("the hello tool greets with the configured greeting", async () => {
  const server = createModuleHttpServer(templateModule, {
    context: {
      manifest: templateModule.manifest,
      dataDir: ".",
      config: resolveConfig(templateModule.manifest, {}),
      log: () => undefined,
    },
    allowedHosts: ["127.0.0.1"],
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const adapter = new MCPAdapter({
    servers: {
      template: { transport: "http", url: `http://127.0.0.1:${port}/mcp` },
    },
    prefixToolNameWithServerName: true,
  });
  try {
    const [hello] = await adapter.listTools();
    assert.equal(hello?.name, "template_hello");
    assert.match(
      JSON.stringify(await hello!.invoke({ name: "Neo" })),
      /Hola, Neo!/,
    );
  } finally {
    await adapter.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
