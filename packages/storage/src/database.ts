import { chmodSync, closeSync, existsSync, openSync } from "node:fs";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { migrate } from "./migrations.js";

export type Db = Database.Database;

const OWNER_READ_WRITE = 0o600;
const IN_MEMORY_PATHS = new Set([":memory:", ""]);

function restrictToOwner(path: string) {
  closeSync(openSync(path, "a", OWNER_READ_WRITE));
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) chmodSync(file, OWNER_READ_WRITE);
  }
}

export function openDatabase(path: string): Db {
  if (!IN_MEMORY_PATHS.has(path)) restrictToOwner(path);
  const db = new Database(path);
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
