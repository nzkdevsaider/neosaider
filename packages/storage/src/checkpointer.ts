import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { Db } from "./database.js";

export const createCheckpointer = (db: Db) => new SqliteSaver(db);

export function listThreadIds(db: Db, prefix: string): string[] {
  const hasCheckpoints = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'",
    )
    .get();
  if (!hasCheckpoints) return [];
  const rows = db
    .prepare(
      "SELECT DISTINCT thread_id FROM checkpoints WHERE substr(thread_id, 1, length(?)) = ?",
    )
    .all(prefix, prefix) as { thread_id: string }[];
  return rows.map((row) => row.thread_id);
}
