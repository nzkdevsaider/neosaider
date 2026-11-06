import type { Db } from "./database.js";

export type Notification = {
  id: number;
  triggerId: number;
  threadId: string;
  content: string;
};

type NotificationInput = Omit<Notification, "id">;

export function insertNotification(
  db: Db,
  { triggerId, threadId, content }: NotificationInput,
): Notification {
  return db
    .prepare(
      "INSERT INTO notifications (trigger_id, thread_id, content) VALUES (?, ?, ?) RETURNING id, trigger_id AS triggerId, thread_id AS threadId, content",
    )
    .get(triggerId, threadId, content) as Notification;
}

export function listUndeliveredNotifications(db: Db): Notification[] {
  return db
    .prepare(
      "SELECT id, trigger_id AS triggerId, thread_id AS threadId, content FROM notifications WHERE delivered_at IS NULL ORDER BY id",
    )
    .all() as Notification[];
}

export function markNotificationDelivered(db: Db, id: number): void {
  db.prepare(
    "UPDATE notifications SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(id);
}

export function deleteDeliveredNotifications(db: Db, before: Date): void {
  db.prepare("DELETE FROM notifications WHERE delivered_at < datetime(?)").run(
    before.toISOString(),
  );
}

export function listNotificationsAfter(db: Db, id: number): Notification[] {
  return db
    .prepare(
      "SELECT id, trigger_id AS triggerId, thread_id AS threadId, content FROM notifications WHERE id > ? ORDER BY id",
    )
    .all(id) as Notification[];
}

export function notificationCursor(db: Db, client: string): number {
  db.prepare(
    `INSERT OR IGNORE INTO notification_cursors (client, last_id) VALUES (?, COALESCE(
      (SELECT MIN(id) - 1 FROM notifications WHERE delivered_at IS NULL),
      (SELECT MAX(id) FROM notifications),
      0
    ))`,
  ).run(client);
  return (
    db
      .prepare("SELECT last_id FROM notification_cursors WHERE client = ?")
      .get(client) as { last_id: number }
  ).last_id;
}

export function advanceNotificationCursor(
  db: Db,
  client: string,
  id: number,
): void {
  db.prepare(
    "UPDATE notification_cursors SET last_id = MAX(last_id, ?) WHERE client = ?",
  ).run(id, client);
}
