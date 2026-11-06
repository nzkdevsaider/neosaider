import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import {
  catalogSchema,
  installModuleRequestSchema,
  moduleManifestSchema,
  updateModuleRequestSchema,
} from "./modules.js";

const minimalManifest = {
  id: "gym",
  name: "Gym",
  version: "0.1.0",
  description: "Log workouts.",
  author: "Neosaider",
  license: "MIT",
  sdk: "^0.1.0",
  image: "neosaider/module-gym:0.1.0",
};

test("a minimal manifest gets safe defaults", () => {
  assert.deepEqual(moduleManifestSchema.parse(minimalManifest), {
    ...minimalManifest,
    tags: [],
    port: 8080,
    dataPath: "/data",
    config: [],
    permissions: { network: "isolated" },
  });
});

test("manifests with unsafe or ambiguous fields are rejected", () => {
  const invalid = [
    { ...minimalManifest, id: "Gym" },
    { ...minimalManifest, version: "1.0" },
    { ...minimalManifest, image: "evil image; rm -rf /" },
    { ...minimalManifest, dataPath: "data" },
    { ...minimalManifest, permissions: { network: "host" } },
    {
      ...minimalManifest,
      config: [{ key: "PORT", description: "reserved" }],
    },
    {
      ...minimalManifest,
      config: [
        { key: "API_KEY", description: "a" },
        { key: "API_KEY", description: "b" },
      ],
    },
  ];
  for (const manifest of invalid) {
    assert.equal(
      moduleManifestSchema.safeParse(manifest).success,
      false,
      JSON.stringify(manifest),
    );
  }
});

test("catalogs and install requests are validated", () => {
  assert.ok(
    catalogSchema.safeParse({
      version: 1,
      modules: [
        {
          id: "gym",
          versions: [
            { version: "0.1.0", manifest: "./gym/neosaider.module.json" },
          ],
        },
      ],
    }).success,
  );
  assert.equal(
    catalogSchema.safeParse({ version: 2, modules: [] }).success,
    false,
  );
  assert.deepEqual(installModuleRequestSchema.parse({ id: "gym" }), {
    id: "gym",
    config: {},
  });
});

test("the published JSON Schema matches the manifest schema", () => {
  const published = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/schemas/module-manifest.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown;
  assert.deepEqual(
    published,
    z.toJSONSchema(moduleManifestSchema, { io: "input" }),
    "run `pnpm --filter @neosaider/contracts schema` to regenerate it",
  );
});

test("update requests default to not accepting capability changes", () => {
  assert.deepEqual(updateModuleRequestSchema.parse({}), {
    acceptChanges: false,
  });
  assert.equal(
    updateModuleRequestSchema.parse({ acceptChanges: true }).acceptChanges,
    true,
  );
  assert.equal(
    updateModuleRequestSchema.safeParse({ acceptChanges: "yes" }).success,
    false,
  );
});
