import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SECRET_MASK, type moduleManifestSchema } from "@neosaider/contracts";
import { getInstallation, listModules, openDatabase } from "@neosaider/storage";
import type { z } from "zod";
import { createCatalog } from "./catalog.js";
import type Docker from "dockerode";
import { moduleToken } from "./module-auth.js";
import { createModuleInstaller, maskSecrets } from "./module-installer.js";
import {
  createDockerRuntime,
  type ModuleRuntime,
  type RuntimeModuleSpec,
} from "./module-runtime.js";

type ManifestOverrides = Partial<z.input<typeof moduleManifestSchema>>;

const baseManifest = {
  name: "Notes",
  description: "Take notes.",
  author: "Tests",
  license: "MIT",
  sdk: "^0.1.0",
  tags: ["productivity"],
};

function writeCatalog(
  modules: Record<string, Record<string, ManifestOverrides>>,
): string {
  const root = mkdtempSync(join(tmpdir(), "catalog-"));
  const entries = Object.entries(modules).map(([id, versions]) => ({
    id,
    versions: Object.entries(versions).map(([version, overrides]) => {
      const folder = join(root, id, version);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "neosaider.module.json"),
        JSON.stringify({
          ...baseManifest,
          id,
          version,
          image: `neosaider/module-${id}:${version}`,
          ...overrides,
        }),
      );
      writeFileSync(join(folder, "README.md"), `# ${id} ${version}\n`);
      return {
        version,
        manifest: `./${id}/${version}/neosaider.module.json`,
        readme: `./${id}/${version}/README.md`,
      };
    }),
  }));
  const location = join(root, "catalog.json");
  writeFileSync(location, JSON.stringify({ version: 1, modules: entries }));
  return location;
}

function serveModule(manifest: {
  id: string;
  version: string;
}): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.url === "/health") res.end(JSON.stringify({ ok: true }));
    else if (req.url === "/manifest") res.end(JSON.stringify(manifest));
    else res.writeHead(404).end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

function fakeRuntime() {
  const servers = new Map<string, Server>();
  const calls: string[] = [];
  const specs: RuntimeModuleSpec[] = [];
  const runtime: ModuleRuntime = {
    available: async () => true,
    ensureImage: async (image) => {
      calls.push(`pull ${image}`);
    },
    run: async (spec) => {
      specs.push(spec);
      calls.push(`run ${spec.id}@${spec.version}`);
      servers.get(spec.id)?.close();
      const server = await serveModule(spec);
      servers.set(spec.id, server);
      const { port } = server.address() as AddressInfo;
      return {
        container: `neosaider-module-${spec.id}`,
        volume: `neosaider-module-${spec.id}`,
        url: `http://127.0.0.1:${port}/mcp`,
      };
    },
    start: async (id) => {
      const server = servers.get(id);
      if (!server) return undefined;
      const { port } = server.address() as AddressInfo;
      return {
        container: `neosaider-module-${id}`,
        volume: `neosaider-module-${id}`,
        url: `http://127.0.0.1:${port}/mcp`,
      };
    },
    remove: async (id, { keepData }) => {
      calls.push(`remove ${id} keepData=${keepData}`);
      servers.get(id)?.close();
      servers.delete(id);
    },
    logs: async () => "log line\n",
  };
  return {
    runtime,
    calls,
    specs,
    close: () => servers.forEach((server) => server.close()),
  };
}

test("the catalog resolves relative manifests, orders versions and searches", async () => {
  const catalog = createCatalog(
    writeCatalog({
      notes: { "0.2.0": {}, "0.10.0": {}, "0.9.1": {} },
      lights: {
        "1.0.0": {
          name: "Lights",
          description: "Turn lights on and off.",
          tags: ["home"],
        },
      },
      broken: { "1.0.0": { image: "not a valid image!" } },
    }),
  );

  const modules = await catalog.modules();
  assert.deepEqual(modules.map((module) => module.id).sort(), [
    "lights",
    "notes",
  ]);
  const notes = modules.find((module) => module.id === "notes")!;
  assert.equal(notes.latest.version, "0.10.0");
  assert.deepEqual(
    notes.versions.map((version) => version.version),
    ["0.10.0", "0.9.1", "0.2.0"],
  );
  assert.equal(await catalog.readme(notes.latest), "# notes 0.10.0\n");

  assert.deepEqual(
    (await catalog.search({ tag: "home" })).map((module) => module.id),
    ["lights"],
  );
  assert.deepEqual(
    (await catalog.search({ q: "LIGHTS on" })).map((module) => module.id),
    ["lights"],
  );
  assert.equal((await catalog.find("notes", "0.2.0"))?.version, "0.2.0");
  assert.equal(await catalog.find("missing"), undefined);
});

test("installing runs the module, waits for it and registers it; uninstalling purges it", async () => {
  const db = openDatabase(":memory:");
  const fake = fakeRuntime();
  let reloads = 0;
  const installer = createModuleInstaller({
    db,
    catalog: createCatalog(
      writeCatalog({
        notes: {
          "1.0.0": {
            config: [
              {
                key: "API_TOKEN",
                description: "Token",
                required: true,
                secret: true,
              },
              { key: "LANGUAGE", description: "Language", default: "es" },
            ],
            permissions: { network: "outbound" },
          },
        },
      }),
    ),
    runtime: fake.runtime,
    onModulesChanged: async () => {
      reloads++;
    },
  });
  try {
    await assert.rejects(
      installer.install({ id: "notes", config: {} }),
      /Missing required configuration: API_TOKEN/,
    );
    await assert.rejects(
      installer.install({
        id: "notes",
        config: { API_TOKEN: "t", OTHER: "x" },
      }),
      /Unknown configuration: OTHER/,
    );
    await assert.rejects(
      installer.install({ id: "ghost", config: {} }),
      /not in the catalog/,
    );

    const started = await installer.install({
      id: "notes",
      config: { API_TOKEN: "secret-token" },
    });
    assert.equal(started.state, "installing");
    await installer.whenIdle();

    const installed = getInstallation(db, "notes")!;
    assert.equal(installed.state, "running");
    assert.deepEqual(fake.calls, [
      "pull neosaider/module-notes:1.0.0",
      "run notes@1.0.0",
    ]);
    assert.equal(fake.specs[0]?.network, "outbound");
    assert.deepEqual(fake.specs[0]?.env, { API_TOKEN: "secret-token" });
    assert.match(
      listModules(db)[0]?.url ?? "",
      /^http:\/\/127\.0\.0\.1:\d+\/mcp$/,
    );
    assert.ok(reloads >= 1);
    assert.deepEqual(maskSecrets(installed.manifest, installed.config), {
      API_TOKEN: SECRET_MASK,
    });

    await assert.rejects(
      installer.install({ id: "notes", config: { API_TOKEN: "t" } }),
      /already installed/,
    );

    installer.configure("notes", { API_TOKEN: SECRET_MASK, LANGUAGE: "en" });
    await installer.whenIdle();
    assert.deepEqual(fake.specs.at(-1)?.env, {
      API_TOKEN: "secret-token",
      LANGUAGE: "en",
    });

    assert.match(await installer.logs("notes", 10), /log line/);
    assert.equal(await installer.uninstall("notes", { keepData: false }), true);
    assert.equal(fake.calls.at(-1), "remove notes keepData=false");
    assert.equal(getInstallation(db, "notes"), undefined);
    assert.deepEqual(listModules(db), []);
  } finally {
    fake.close();
  }
});

test("a container that serves another manifest fails the installation", async () => {
  const db = openDatabase(":memory:");
  const fake = fakeRuntime();
  const lyingRuntime: ModuleRuntime = {
    ...fake.runtime,
    run: async (spec) => fake.runtime.run({ ...spec, version: "9.9.9" }),
  };
  const installer = createModuleInstaller({
    db,
    catalog: createCatalog(writeCatalog({ notes: { "1.0.0": {} } })),
    runtime: lyingRuntime,
    onModulesChanged: async () => undefined,
  });
  try {
    await installer.install({ id: "notes", config: {} });
    await installer.whenIdle();
    const failed = getInstallation(db, "notes")!;
    assert.equal(failed.state, "failed");
    assert.match(failed.error ?? "", /serves notes@9\.9\.9/);
    assert.deepEqual(listModules(db), []);
  } finally {
    fake.close();
  }
});

test("without Docker, lifecycle operations are refused and reconciliation marks missing containers", async () => {
  const db = openDatabase(":memory:");
  const catalog = createCatalog(writeCatalog({ notes: { "1.0.0": {} } }));
  const withoutDocker = createModuleInstaller({
    db,
    catalog,
    onModulesChanged: async () => undefined,
  });
  await assert.rejects(
    withoutDocker.install({ id: "notes", config: {} }),
    (error: Error & { status?: number }) => error.status === 503,
  );

  const fake = fakeRuntime();
  const installer = createModuleInstaller({
    db,
    catalog,
    runtime: fake.runtime,
    onModulesChanged: async () => undefined,
  });
  try {
    await installer.install({ id: "notes", config: {} });
    await installer.whenIdle();
    await installer.reconcile();
    assert.equal(getInstallation(db, "notes")?.state, "running");

    const restarted = createModuleInstaller({
      db,
      catalog,
      runtime: { ...fake.runtime, start: async () => undefined },
      onModulesChanged: async () => undefined,
    });
    await restarted.reconcile();
    assert.equal(getInstallation(db, "notes")?.state, "failed");
    assert.match(getInstallation(db, "notes")?.error ?? "", /no longer exists/);
  } finally {
    fake.close();
  }
});

test("updates that widen capabilities need an explicit acknowledgement", async () => {
  const db = openDatabase(":memory:");
  const fake = fakeRuntime();
  const secretToken = {
    key: "API_TOKEN",
    description: "Token",
    secret: true,
  };
  const installer = createModuleInstaller({
    db,
    catalog: createCatalog(
      writeCatalog({
        notes: {
          "1.0.0": { config: [secretToken] },
          "1.1.0": { config: [secretToken] },
          "2.0.0": {
            config: [secretToken],
            permissions: { network: "outbound" },
          },
          "3.0.0": {
            config: [{ ...secretToken, secret: false }],
            permissions: { network: "outbound" },
          },
          "4.0.0": {
            config: [secretToken],
            permissions: { network: "outbound" },
            image: "attacker/notes:4.0.0",
          },
        },
      }),
    ),
    runtime: fake.runtime,
    onModulesChanged: async () => undefined,
  });
  const needsConfirmation =
    (pattern: RegExp) => (error: Error & { status?: number }) =>
      error.status === 409 && pattern.test(error.message);
  try {
    await installer.install({
      id: "notes",
      version: "1.0.0",
      config: { API_TOKEN: "t" },
    });
    await installer.whenIdle();

    await installer.update("notes", "1.1.0");
    await installer.whenIdle();
    assert.equal(getInstallation(db, "notes")?.manifest.version, "1.1.0");

    await assert.rejects(
      installer.update("notes", "2.0.0"),
      needsConfirmation(/isolated to outbound/),
    );
    assert.equal(getInstallation(db, "notes")?.manifest.version, "1.1.0");
    await installer.update("notes", "2.0.0", { acceptChanges: true });
    await installer.whenIdle();
    assert.equal(getInstallation(db, "notes")?.manifest.version, "2.0.0");
    assert.equal(fake.specs.at(-1)?.network, "outbound");

    await assert.rejects(
      installer.update("notes", "3.0.0"),
      needsConfirmation(/API_TOKEN is no longer secret/),
    );
    await assert.rejects(
      installer.update("notes", "4.0.0"),
      needsConfirmation(
        /image repository changes from neosaider\/module-notes to attacker\/notes/,
      ),
    );
    assert.equal(getInstallation(db, "notes")?.manifest.version, "2.0.0");
  } finally {
    fake.close();
  }
});

const MIB = 1024 * 1024;

function manifestJson(id: string, padding = 0) {
  return (
    JSON.stringify({
      ...baseManifest,
      id,
      version: "1.0.0",
      image: `neosaider/module-${id}:1.0.0`,
    }) + " ".repeat(padding)
  );
}

function catalogJson(
  modules: Record<string, { manifest: string; readme?: string }>,
) {
  return JSON.stringify({
    version: 1,
    modules: Object.entries(modules).map(([id, version]) => ({
      id,
      versions: [{ version: "1.0.0", ...version }],
    })),
  });
}

test("a file catalog only reads regular files up to 1 MiB", async () => {
  const root = mkdtempSync(join(tmpdir(), "catalog-"));
  writeFileSync(join(root, "notes.json"), manifestJson("notes"));
  writeFileSync(join(root, "huge.json"), manifestJson("huge", MIB));
  mkdirSync(join(root, "folder.json"));
  writeFileSync(
    join(root, "catalog.json"),
    catalogJson({
      notes: { manifest: "./notes.json" },
      huge: { manifest: "./huge.json" },
      folder: { manifest: "./folder.json" },
    }),
  );
  const catalog = createCatalog(join(root, "catalog.json"));
  assert.deepEqual(
    (await catalog.modules()).map((module) => module.id),
    ["notes"],
  );
});

test("an http catalog cannot point outside its origin and caps response sizes", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/catalog.json") {
      res.end(
        catalogJson({
          notes: { manifest: "./notes.json", readme: "./README.md" },
          leaky: {
            manifest: "./leaky.json",
            readme: "file:///etc/passwd",
          },
          local: { manifest: "file:///etc/passwd" },
          elsewhere: { manifest: "http://localhost:1/elsewhere.json" },
          huge: { manifest: "./huge.json" },
          streamed: { manifest: "./streamed.json" },
          bounced: { manifest: "./bounce.json" },
        }),
      );
    } else if (req.url === "/notes.json") res.end(manifestJson("notes"));
    else if (req.url === "/README.md") res.end("# notes\n");
    else if (req.url === "/leaky.json") res.end(manifestJson("leaky"));
    else if (req.url === "/bounced.json") res.end(manifestJson("bounced"));
    else if (req.url === "/bounce.json") {
      const { port } = server.address() as AddressInfo;
      res
        .writeHead(302, { location: `http://localhost:${port}/bounced.json` })
        .end();
    } else if (req.url === "/huge.json") res.end(manifestJson("huge", MIB));
    else if (req.url === "/streamed.json") {
      res.write(manifestJson("streamed"));
      for (let sent = 0; sent <= MIB; sent += 64 * 1024) {
        res.write(" ".repeat(64 * 1024));
      }
      res.end();
    } else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const catalog = createCatalog(`http://127.0.0.1:${port}/catalog.json`);
    const modules = await catalog.modules();
    assert.deepEqual(
      modules.map((module) => module.id),
      ["notes"],
    );
    assert.equal(await catalog.readme(modules[0]!.latest), "# notes\n");
  } finally {
    server.close();
  }
});

test("installed modules get their own token and the installer authenticates with it", async () => {
  const db = openDatabase(":memory:");
  const fake = fakeRuntime();
  const unauthenticated: string[] = [];
  const after: (() => void)[] = [];
  const guarded: ModuleRuntime = {
    ...fake.runtime,
    run: async (spec) => {
      fake.specs.push(spec);
      const expected = `Bearer ${moduleToken("harness-secret", spec.id)}`;
      const server = createServer((req, res) => {
        if (req.headers.authorization !== expected) {
          unauthenticated.push(req.url ?? "");
          res.writeHead(401).end();
        } else if (req.url === "/health") res.end(JSON.stringify({ ok: true }));
        else res.end(JSON.stringify(spec));
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      after.push(() => server.close());
      const { port } = server.address() as AddressInfo;
      return {
        container: `neosaider-module-${spec.id}`,
        volume: `neosaider-module-${spec.id}`,
        url: `http://127.0.0.1:${port}/mcp`,
      };
    },
  };
  const installer = createModuleInstaller({
    db,
    catalog: createCatalog(writeCatalog({ notes: { "1.0.0": {} } })),
    runtime: guarded,
    onModulesChanged: async () => undefined,
    moduleSecret: "harness-secret",
  });
  try {
    await installer.install({ id: "notes", config: {} });
    await installer.whenIdle();
    assert.equal(getInstallation(db, "notes")?.state, "running");
    assert.equal(fake.specs[0]?.token, moduleToken("harness-secret", "notes"));
    assert.deepEqual(unauthenticated, []);
  } finally {
    after.forEach((close) => close());
  }
});

test("compose-mode modules never join the harness network", async () => {
  const networks: { name: string; internal: boolean }[] = [];
  const containers: { NetworkMode: string; Env: string[] }[] = [];
  const docker = {
    createVolume: async () => undefined,
    listNetworks: async () => [],
    createNetwork: async ({
      Name,
      Internal,
    }: {
      Name: string;
      Internal: boolean;
    }) => {
      networks.push({ name: Name, internal: Internal });
    },
    getNetwork: () => ({ connect: async () => undefined }),
    getContainer: () => ({
      remove: async () => undefined,
      inspect: async () => {
        throw Object.assign(new Error("missing"), { statusCode: 404 });
      },
    }),
    createContainer: async (options: {
      Env: string[];
      HostConfig: { NetworkMode: string };
    }) => {
      containers.push({
        NetworkMode: options.HostConfig.NetworkMode,
        Env: options.Env,
      });
      return { start: async () => undefined };
    },
  } as unknown as Docker;
  const runtime = createDockerRuntime({ docker, composeNetwork: "neosaider" });
  const spec = {
    version: "1.0.0",
    image: "example/module:1",
    port: 8080,
    dataPath: "/data",
    env: {},
    token: "module-token",
  };
  await runtime.run({ ...spec, id: "web-search", network: "outbound" });
  await runtime.run({ ...spec, id: "notes", network: "isolated" });

  assert.deepEqual(
    containers.map((container) => container.NetworkMode),
    ["neosaider-modules-outbound", "neosaider-modules-isolated"],
  );
  assert.ok(containers.every((c) => c.NetworkMode !== "neosaider"));
  assert.deepEqual(networks, [
    { name: "neosaider-modules-outbound", internal: false },
    { name: "neosaider-modules-isolated", internal: true },
  ]);
  assert.ok(
    containers.every((c) =>
      c.Env.includes("NEOSAIDER_MODULE_TOKEN=module-token"),
    ),
  );
});
