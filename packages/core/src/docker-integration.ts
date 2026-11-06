import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MCPAdapter } from "@langchain/mcp-adapters";
import { getInstallation, listModules, openDatabase } from "@neosaider/storage";
import Docker from "dockerode";
import { createCatalog } from "./catalog.js";
import { createModuleInstaller } from "./module-installer.js";
import { createDockerRuntime, moduleResourceName } from "./module-runtime.js";

const docker = new Docker();
const exists = (inspect: () => Promise<unknown>) =>
  inspect().then(
    () => true,
    () => false,
  );

test("gym is installed from the development catalog into Docker and fully removed", async () => {
  const db = openDatabase(":memory:");
  const runtime = createDockerRuntime({ docker });
  assert.ok(await runtime.available(), "Docker must be running");
  const installer = createModuleInstaller({
    db,
    catalog: createCatalog(
      fileURLToPath(new URL("../../../modules/catalog.json", import.meta.url)),
    ),
    runtime,
    onModulesChanged: async () => undefined,
  });
  const name = moduleResourceName("gym");
  await runtime.remove("gym", { keepData: false });

  try {
    await installer.install({ id: "gym", config: {} });
    await installer.whenIdle();
    const installation = getInstallation(db, "gym");
    assert.equal(installation?.state, "running", installation?.error);

    const container = await docker.getContainer(name).inspect();
    assert.equal(container.State.Running, true);
    assert.equal(container.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(container.HostConfig.CapDrop, ["ALL"]);
    assert.equal(container.Config.Labels["neosaider.module"], "gym");
    assert.ok(await exists(() => docker.getVolume(name).inspect()));

    const [registration] = listModules(db);
    const adapter = new MCPAdapter({
      servers: { gym: { transport: "http", url: registration!.url } },
      prefixToolNameWithServerName: true,
    });
    try {
      const tools = new Map(
        (await adapter.listTools()).map((tool) => [tool.name, tool]),
      );
      await tools
        .get("gym_log_workout")!
        .invoke({ activity: "rowing", minutes: 20 });
      assert.match(
        JSON.stringify(await tools.get("gym_list_workouts")!.invoke({})),
        /rowing/,
      );
    } finally {
      await adapter.close();
    }
    assert.match(await installer.logs("gym", 20), /listening/);

    assert.equal(await installer.uninstall("gym", { keepData: false }), true);
    assert.equal(
      await exists(() => docker.getContainer(name).inspect()),
      false,
    );
    assert.equal(await exists(() => docker.getVolume(name).inspect()), false);
    assert.equal(getInstallation(db, "gym"), undefined);
  } finally {
    await runtime.remove("gym", { keepData: false });
  }
});
