import type { Memory, MemoryKind } from "@neosaider/contracts";
import type { Db } from "./database.js";

export type MemoryMatch = Memory & { distance: number };

export type MemoryInput = { kind: MemoryKind; content: string };

type MemoryRow = {
  id: number;
  kind: MemoryKind;
  content: string;
  created_at: string;
};

const MEMORY_COLUMNS = "id, kind, content, created_at";

const toMemory = (row: MemoryRow): Memory => ({
  id: row.id,
  kind: row.kind,
  content: row.content,
  createdAt: row.created_at,
});

function vectorTableDimensions(db: Db): number | undefined {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'memory_vectors'")
    .get() as { sql: string } | undefined;
  const match = row?.sql.match(/float\[(\d+)\]/);
  return match ? Number(match[1]) : undefined;
}

function ensureVectorTable(db: Db, dimensions: number): void {
  const existing = vectorTableDimensions(db);
  if (existing === undefined) {
    db.exec(
      `CREATE VIRTUAL TABLE memory_vectors USING vec0(embedding float[${dimensions}] distance_metric=cosine)`,
    );
    return;
  }
  if (existing !== dimensions) {
    throw new Error(
      `Embedding has ${dimensions} dimensions but stored memories use ${existing}; changing the embedding model requires re-embedding memories`,
    );
  }
}

export function listMemories(db: Db, kind?: MemoryKind): Memory[] {
  const rows = (
    kind
      ? db
          .prepare(
            `SELECT ${MEMORY_COLUMNS} FROM memories WHERE kind = ? ORDER BY id`,
          )
          .all(kind)
      : db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories ORDER BY id`).all()
  ) as MemoryRow[];
  return rows.map(toMemory);
}

export function insertMemory(
  db: Db,
  memory: MemoryInput,
  embedding: number[],
): Memory {
  ensureVectorTable(db, embedding.length);
  return db.transaction(() => {
    const row = db
      .prepare(
        `INSERT INTO memories (kind, content) VALUES (?, ?) RETURNING ${MEMORY_COLUMNS}`,
      )
      .get(memory.kind, memory.content) as MemoryRow;
    db.prepare(
      "INSERT INTO memory_vectors (rowid, embedding) VALUES (?, ?)",
    ).run(BigInt(row.id), new Float32Array(embedding));
    return toMemory(row);
  })();
}

export function updateMemory(
  db: Db,
  id: number,
  memory: MemoryInput,
  embedding: number[],
): Memory | undefined {
  ensureVectorTable(db, embedding.length);
  return db.transaction(() => {
    const row = db
      .prepare(
        `UPDATE memories SET kind = ?, content = ? WHERE id = ? RETURNING ${MEMORY_COLUMNS}`,
      )
      .get(memory.kind, memory.content, id) as MemoryRow | undefined;
    if (!row) return undefined;
    db.prepare("UPDATE memory_vectors SET embedding = ? WHERE rowid = ?").run(
      new Float32Array(embedding),
      BigInt(id),
    );
    return toMemory(row);
  })();
}

export function searchMemories(
  db: Db,
  embedding: number[],
  limit: number,
): MemoryMatch[] {
  if (vectorTableDimensions(db) === undefined) return [];
  ensureVectorTable(db, embedding.length);
  const rows = db
    .prepare(
      `SELECT m.id, m.kind, m.content, m.created_at, v.distance
       FROM memory_vectors v JOIN memories m ON m.id = v.rowid
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`,
    )
    .all(new Float32Array(embedding), limit) as (MemoryRow & {
    distance: number;
  })[];
  return rows.map((row) => ({ ...toMemory(row), distance: row.distance }));
}

export function deleteMemory(db: Db, id: number): boolean {
  return db.transaction(() => {
    if (vectorTableDimensions(db) !== undefined) {
      db.prepare("DELETE FROM memory_vectors WHERE rowid = ?").run(BigInt(id));
    }
    return db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
  })();
}
