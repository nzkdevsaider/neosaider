import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { createModuleHttpServer } from "@neosaider/module-sdk";
import { gymModule } from "./gym.js";

test("Neo's MCP adapter can log and list workouts through the SDK server", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "gym-"));
  const server = createModuleHttpServer(gymModule, {
    context: {
      manifest: gymModule.manifest,
      dataDir,
      config: {},
      log: () => undefined,
    },
    allowedHosts: ["127.0.0.1"],
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const adapter = new MCPAdapter({
    servers: { gym: { transport: "http", url: `${base}/mcp` } },
    prefixToolNameWithServerName: true,
  });
  try {
    const manifest = (await (await fetch(`${base}/manifest`)).json()) as {
      id: string;
      version: string;
    };
    assert.equal(manifest.id, "gym");
    assert.equal(manifest.version, gymModule.manifest.version);
    assert.match(await (await fetch(`${base}/readme`)).text(), /^# Gym/);

    const tools = await adapter.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.deepEqual([...byName.keys()].sort(), [
      "gym_list_workouts",
      "gym_log_workout",
    ]);
    await byName
      .get("gym_log_workout")!
      .invoke({ activity: "running", minutes: 30 });
    const listed = await byName.get("gym_list_workouts")!.invoke({});
    assert.match(JSON.stringify(listed), /running/);
  } finally {
    await adapter.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
