import {
  moduleConfigValuesSchema,
  moduleManifestSchema,
  type InstallState,
  type ModuleConfigValues,
  type ModuleInstallation,
  type ModuleManifest,
} from "@neosaider/contracts";
import type { Db } from "./database.js";

type InstallationRow = {
  name: string;
  manifest: string;
  state: InstallState;
  error: string | null;
  volume: string;
  container: string;
  config: string;
  installed_at: string;
  updated_at: string;
};

export type StoredInstallation = ModuleInstallation & { name: string };

function toInstallation(row: InstallationRow): StoredInstallation {
  return {
    name: row.name,
    manifest: moduleManifestSchema.parse(JSON.parse(row.manifest)),
    state: row.state,
    ...(row.error && { error: row.error }),
    volume: row.volume,
    container: row.container,
    config: moduleConfigValuesSchema.parse(JSON.parse(row.config)),
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

export type InstallationInput = {
  manifest: ModuleManifest;
  state: InstallState;
  volume: string;
  container: string;
  config: ModuleConfigValues;
};

export function saveInstallation(
  db: Db,
  { manifest, state, volume, container, config }: InstallationInput,
): StoredInstallation {
  const row = db
    .prepare(
      `INSERT INTO installed_modules (name, manifest, state, volume, container, config)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         manifest = excluded.manifest,
         state = excluded.state,
         error = NULL,
         volume = excluded.volume,
         container = excluded.container,
         config = excluded.config,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
    )
    .get(
      manifest.id,
      JSON.stringify(manifest),
      state,
      volume,
      container,
      JSON.stringify(config),
    ) as InstallationRow;
  return toInstallation(row);
}

export function setInstallationState(
  db: Db,
  name: string,
  state: InstallState,
  error?: string,
): void {
  db.prepare(
    "UPDATE installed_modules SET state = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?",
  ).run(state, error ?? null, name);
}

export function getInstallation(
  db: Db,
  name: string,
): StoredInstallation | undefined {
  const row = db
    .prepare("SELECT * FROM installed_modules WHERE name = ?")
    .get(name) as InstallationRow | undefined;
  return row && toInstallation(row);
}

export function listInstallations(db: Db): StoredInstallation[] {
  const rows = db
    .prepare("SELECT * FROM installed_modules ORDER BY name")
    .all() as InstallationRow[];
  return rows.map(toInstallation);
}

export function deleteInstallation(db: Db, name: string): boolean {
  return (
    db.prepare("DELETE FROM installed_modules WHERE name = ?").run(name)
      .changes > 0
  );
}
