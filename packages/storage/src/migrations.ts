import type { Db } from "./database.js";

const migrations = [
  `
  CREATE TABLE modules (
    name TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE triggers (
    id INTEGER PRIMARY KEY,
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact' CHECK (kind IN ('profile', 'fact'));
  `,
  `
  CREATE TABLE triggers_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO triggers_new (id, definition, created_at) SELECT id, definition, created_at FROM triggers;
  DROP TABLE triggers;
  ALTER TABLE triggers_new RENAME TO triggers;
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_id INTEGER NOT NULL,
    thread_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TEXT
  );
  CREATE TABLE pending_extractions (
    id INTEGER PRIMARY KEY,
    transcript TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  DELETE FROM modules WHERE json_extract(config, '$.transport') = 'stdio';
  `,
  `
  CREATE TABLE notification_cursors (
    client TEXT PRIMARY KEY,
    last_id INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE installed_modules (
    name TEXT PRIMARY KEY,
    manifest TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('installing', 'running', 'stopped', 'failed', 'removing')),
    error TEXT,
    volume TEXT NOT NULL,
    container TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
];

export function migrate(db: Db): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  db.transaction(() => {
    migrations.slice(currentVersion).forEach((sql, index) => {
      db.exec(sql);
      db.pragma(`user_version = ${currentVersion + index + 1}`);
    });
  })();
}
