import { join } from "node:path";
import Database from "better-sqlite3";
import type { McpServer } from "@modelcontextprotocol/server";
import { defineModule } from "@neosaider/module-sdk";
import { z } from "zod";

export type GymDb = Database.Database;

type Workout = {
  id: number;
  activity: string;
  minutes: number;
  notes: string | null;
  loggedAt: string;
};

export function openGymDatabase(path: string): GymDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY,
    activity TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    notes TEXT,
    logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  return db;
}

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerGymTools(server: McpServer, db: GymDb): void {
  server.registerTool(
    "log_workout",
    {
      title: "Log workout",
      description: "Record a workout the user did.",
      inputSchema: z.object({
        activity: z.string().min(1).describe("e.g. running, squats, yoga"),
        minutes: z.number().int().positive(),
        notes: z.string().optional(),
      }),
    },
    async ({ activity, minutes, notes }) =>
      textResult(
        db
          .prepare(
            `INSERT INTO workouts (activity, minutes, notes) VALUES (?, ?, ?)
             RETURNING id, activity, minutes, notes, logged_at AS loggedAt`,
          )
          .get(activity, minutes, notes ?? null) as Workout,
      ),
  );

  server.registerTool(
    "list_workouts",
    {
      title: "List workouts",
      description:
        "List the user's workouts from the last N days, newest first.",
      inputSchema: z.object({
        days: z.number().int().positive().default(7),
      }),
    },
    async ({ days }) =>
      textResult(
        db
          .prepare(
            `SELECT id, activity, minutes, notes, logged_at AS loggedAt FROM workouts
             WHERE logged_at >= datetime('now', ?)
             ORDER BY logged_at DESC, id DESC`,
          )
          .all(`-${days} days`) as Workout[],
      ),
  );
}

export const gymModule = defineModule({
  root: new URL("..", import.meta.url),
  create({ dataDir }) {
    const db = openGymDatabase(join(dataDir, "gym.db"));
    return {
      register: (server) => registerGymTools(server, db),
      close: () => db.close(),
    };
  },
});
