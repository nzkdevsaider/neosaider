import {
  triggerDefinitionSchema,
  type Trigger,
  type TriggerDefinition,
} from "@neosaider/contracts";
import type { Db } from "./database.js";

type TriggerRow = { id: number; definition: string; created_at: string };

function toTrigger(row: TriggerRow): Trigger {
  return {
    ...triggerDefinitionSchema.parse(JSON.parse(row.definition)),
    id: row.id,
    createdAt: row.created_at,
  };
}

export function listTriggers(db: Db): Trigger[] {
  const rows = db
    .prepare("SELECT id, definition, created_at FROM triggers ORDER BY id")
    .all() as TriggerRow[];
  return rows.map(toTrigger);
}

export function createTrigger(db: Db, definition: TriggerDefinition): Trigger {
  const row = db
    .prepare(
      "INSERT INTO triggers (definition) VALUES (?) RETURNING id, definition, created_at",
    )
    .get(JSON.stringify(definition)) as TriggerRow;
  return toTrigger(row);
}

export function deleteTrigger(db: Db, id: number): boolean {
  return db.prepare("DELETE FROM triggers WHERE id = ?").run(id).changes > 0;
}
