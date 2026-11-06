import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import {
  deleteInstallation,
  getInstallation,
  listInstallations,
  saveInstallation,
  setInstallationState,
  addPendingExtraction,
  countExtractionAttempt,
  createTrigger,
  deletePendingExtraction,
  deleteTrigger,
  deleteMemory,
  insertNotification,
  listPendingExtractions,
  listThreadIds,
  advanceNotificationCursor,
  listNotificationsAfter,
  listUndeliveredNotifications,
  markNotificationDelivered,
  notificationCursor,
  insertMemory,
  listMemories,
  listModules,
  listTriggers,
  openDatabase,
  saveModule,
  searchMemories,
  updateMemory,
} from "./index.js";
import { moduleManifestSchema } from "@neosaider/contracts";
import { migrate } from "./migrations.js";

test("migrations run once and repos round-trip", () => {
  const db = openDatabase(":memory:");
  assert.equal(db.pragma("user_version", { simple: true }), 5);

  saveModule(db, {
    name: "gym",
    transport: "http",
    url: "http://gym:3001/mcp",
  });
  saveModule(db, {
    name: "gym",
    transport: "http",
    url: "http://gym:3002/mcp",
  });
  assert.deepEqual(listModules(db), [
    { name: "gym", transport: "http", url: "http://gym:3002/mcp" },
  ]);

  const trigger = createTrigger(db, {
    kind: "cron",
    schedule: "0 7 * * *",
    prompt: "Suggest a workout",
  });
  assert.equal(listTriggers(db)[0]?.id, trigger.id);
});

test("memories saved before kinds existed become facts and stdio modules are dropped", () => {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  db.exec(
    "CREATE TABLE memories (id INTEGER PRIMARY KEY, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE modules (name TEXT PRIMARY KEY, config TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE triggers (id INTEGER PRIMARY KEY, definition TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  db.pragma("user_version = 1");
  db.prepare("INSERT INTO memories (content) VALUES (?)").run("Likes tea");
  db.prepare("INSERT INTO modules (name, config) VALUES (?, ?)").run(
    "shell",
    JSON.stringify({ name: "shell", transport: "stdio", command: "sh" }),
  );
  db.prepare("INSERT INTO triggers (id, definition) VALUES (?, ?)").run(
    7,
    JSON.stringify({ kind: "event", event: "session.start", prompt: "Hi" }),
  );

  migrate(db);

  assert.equal(db.pragma("user_version", { simple: true }), 5);
  assert.deepEqual(listModules(db), []);
  assert.equal(listTriggers(db)[0]?.id, 7);
  assert.deepEqual(
    listMemories(db).map(({ kind, content }) => ({ kind, content })),
    [{ kind: "fact", content: "Likes tea" }],
  );
});

test("memories are searched, updated and deleted together with their vector", () => {
  const db = openDatabase(":memory:");
  assert.deepEqual(searchMemories(db, [1, 0, 0], 3), []);

  const color = insertMemory(
    db,
    { kind: "fact", content: "Likes yellow" },
    [1, 0, 0],
  );
  insertMemory(db, { kind: "profile", content: "Call him Sebas" }, [0, 1, 0]);

  const [closest] = searchMemories(db, [0.9, 0.1, 0], 1);
  assert.equal(closest?.content, "Likes yellow");
  assert.ok(closest!.distance < 0.1);
  assert.deepEqual(
    listMemories(db, "profile").map((memory) => memory.content),
    ["Call him Sebas"],
  );

  assert.throws(
    () => insertMemory(db, { kind: "fact", content: "wrong size" }, [1, 0]),
    /dimensions/,
  );

  updateMemory(
    db,
    color.id,
    { kind: "fact", content: "Likes blue" },
    [0, 0, 1],
  );
  assert.equal(searchMemories(db, [0, 0, 1], 1)[0]?.content, "Likes blue");
  assert.equal(
    updateMemory(db, 999, { kind: "fact", content: "x" }, [0, 0, 1]),
    undefined,
  );

  assert.equal(deleteMemory(db, color.id), true);
  assert.deepEqual(
    listMemories(db).map((memory) => memory.content),
    ["Call him Sebas"],
  );
  assert.equal(searchMemories(db, [1, 0, 0], 2).length, 1);
});

test("deleted trigger ids are never reused", () => {
  const db = openDatabase(":memory:");
  const definition = {
    kind: "event",
    event: "session.start",
    prompt: "Hi",
  } as const;
  const first = createTrigger(db, definition);
  deleteTrigger(db, first.id);
  assert.notEqual(createTrigger(db, definition).id, first.id);
});

test("notifications stay pending until delivered", () => {
  const db = openDatabase(":memory:");
  const notification = insertNotification(db, {
    triggerId: 1,
    threadId: "proactive:1:0",
    content: "Drink water",
  });
  assert.deepEqual(listUndeliveredNotifications(db), [notification]);
  markNotificationDelivered(db, notification.id);
  assert.deepEqual(listUndeliveredNotifications(db), []);
});

test("pending extractions are retried at most three times", () => {
  const db = openDatabase(":memory:");
  const failing = addPendingExtraction(db, "User: hi");
  const done = addPendingExtraction(db, "User: bye");
  deletePendingExtraction(db, done);
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(listPendingExtractions(db), [
      { id: failing, transcript: "User: hi" },
    ]);
    countExtractionAttempt(db, failing);
  }
  assert.deepEqual(listPendingExtractions(db), []);
});

test("thread ids are listed by prefix once checkpoints exist", () => {
  const db = openDatabase(":memory:");
  assert.deepEqual(listThreadIds(db, "proactive:"), []);
  db.exec("CREATE TABLE checkpoints (thread_id TEXT)");
  db.exec(
    "INSERT INTO checkpoints VALUES ('proactive:1:5'), ('proactive:1:5'), ('cli')",
  );
  assert.deepEqual(listThreadIds(db, "proactive:"), ["proactive:1:5"]);
});

test("each client keeps its own notification cursor", () => {
  const db = openDatabase(":memory:");
  const notify = (content: string) =>
    insertNotification(db, {
      triggerId: 1,
      threadId: "proactive:1:0",
      content,
    });
  const seen = notify("seen by someone");
  markNotificationDelivered(db, seen.id);
  const unseen = notify("not seen yet");

  assert.equal(notificationCursor(db, "laptop"), seen.id);
  assert.deepEqual(
    listNotificationsAfter(db, notificationCursor(db, "laptop")),
    [unseen],
  );

  advanceNotificationCursor(db, "laptop", unseen.id);
  markNotificationDelivered(db, unseen.id);
  assert.equal(notificationCursor(db, "laptop"), unseen.id);
  assert.equal(notificationCursor(db, "phone"), unseen.id);

  const later = notify("later");
  assert.deepEqual(
    listNotificationsAfter(db, notificationCursor(db, "phone")),
    [later],
  );
  assert.deepEqual(
    listNotificationsAfter(db, notificationCursor(db, "laptop")),
    [later],
  );
});

test("module installations are saved, updated and deleted", () => {
  const db = openDatabase(":memory:");
  const manifest = moduleManifestSchema.parse({
    id: "gym",
    name: "Gym",
    version: "0.1.0",
    description: "Workouts",
    author: "Tests",
    license: "MIT",
    sdk: "^0.1.0",
    image: "neosaider/module-gym:0.1.0",
  });
  const saved = saveInstallation(db, {
    manifest,
    state: "installing",
    volume: "neosaider-module-gym",
    container: "neosaider-module-gym",
    config: { KEY: "value" },
  });
  assert.equal(saved.state, "installing");
  setInstallationState(db, "gym", "failed", "boom");
  assert.equal(getInstallation(db, "gym")?.error, "boom");

  saveInstallation(db, { ...saved, state: "installing" });
  const retried = getInstallation(db, "gym");
  assert.equal(retried?.state, "installing");
  assert.equal(retried?.error, undefined);
  assert.deepEqual(retried?.config, { KEY: "value" });
  assert.equal(listInstallations(db).length, 1);
  assert.equal(deleteInstallation(db, "gym"), true);
  assert.equal(getInstallation(db, "gym"), undefined);
});

test(
  "file databases and their WAL are readable only by the owner",
  { skip: process.platform === "win32" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "neosaider-storage-"));
    const preexisting = join(directory, "preexisting.db");
    writeFileSync(preexisting, "", { mode: 0o644 });
    try {
      for (const path of [join(directory, "fresh.db"), preexisting]) {
        const db = openDatabase(path);
        db.exec(
          "CREATE TABLE secrets (value TEXT); INSERT INTO secrets VALUES ('dummy')",
        );
        for (const file of [path, `${path}-wal`]) {
          assert.equal(statSync(file).mode & 0o077, 0, file);
        }
        db.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
