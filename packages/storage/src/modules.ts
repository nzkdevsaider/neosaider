import {
  moduleRegistrationSchema,
  type ModuleRegistration,
} from "@neosaider/contracts";
import type { Db } from "./database.js";

export function listModules(db: Db): ModuleRegistration[] {
  const rows = db
    .prepare("SELECT config FROM modules ORDER BY created_at, name")
    .all() as { config: string }[];
  return rows.map((row) =>
    moduleRegistrationSchema.parse(JSON.parse(row.config)),
  );
}

export function saveModule(db: Db, module: ModuleRegistration): void {
  db.prepare(
    "INSERT INTO modules (name, config) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET config = excluded.config",
  ).run(module.name, JSON.stringify(module));
}

export function deleteModule(db: Db, name: string): boolean {
  return db.prepare("DELETE FROM modules WHERE name = ?").run(name).changes > 0;
}
