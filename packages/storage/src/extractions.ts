import type { Db } from "./database.js";

const MAX_EXTRACTION_ATTEMPTS = 3;

export type PendingExtraction = { id: number; transcript: string };

export function addPendingExtraction(db: Db, transcript: string): number {
  return Number(
    db
      .prepare("INSERT INTO pending_extractions (transcript) VALUES (?)")
      .run(transcript).lastInsertRowid,
  );
}

export function listPendingExtractions(db: Db): PendingExtraction[] {
  return db
    .prepare(
      "SELECT id, transcript FROM pending_extractions WHERE attempts < ? ORDER BY id",
    )
    .all(MAX_EXTRACTION_ATTEMPTS) as PendingExtraction[];
}

export function deletePendingExtraction(db: Db, id: number): void {
  db.prepare("DELETE FROM pending_extractions WHERE id = ?").run(id);
}

export function countExtractionAttempt(db: Db, id: number): void {
  db.prepare(
    "UPDATE pending_extractions SET attempts = attempts + 1 WHERE id = ?",
  ).run(id);
}
