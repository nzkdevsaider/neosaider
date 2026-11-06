# @neosaider/storage

Everything Neosaider persists lives in one SQLite file. This package opens it, runs the migrations and exposes small repository functions plus the LangGraph checkpointer.

- Turbo tag: `layer-storage`. It may import `@neosaider/contracts` only.
- Built on `better-sqlite3` (synchronous), `sqlite-vec` and `@langchain/langgraph-checkpoint-sqlite`.

## Opening the database

```ts
import { openDatabase } from "@neosaider/storage";

const db = openDatabase("neosaider.db"); // or ":memory:" in tests
```

`openDatabase(path)`:

1. For a file path, creates the file with mode `0600` (or tightens an existing file and its `-wal`/`-shm` to `0600`), so the WAL and SHM files SQLite creates inherit owner-only access. Then opens it with `better-sqlite3`.
2. Loads the `sqlite-vec` extension.
3. Sets `journal_mode = WAL` and `foreign_keys = ON`.
4. Runs pending migrations.

`Db` is the `better-sqlite3` `Database` type.

## Repositories

All functions take `db` as their first argument and are synchronous.

| File                   | Functions                                                                                                                                                                                      | Table                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `src/modules.ts`       | `listModules`, `saveModule` (upsert), `deleteModule`                                                                                                                                           | `modules`                               |
| `src/installations.ts` | `saveInstallation` (upsert, clears `error`), `setInstallationState`, `getInstallation`, `listInstallations`, `deleteInstallation`                                                              | `installed_modules`                     |
| `src/triggers.ts`      | `listTriggers`, `createTrigger`, `deleteTrigger`                                                                                                                                               | `triggers`                              |
| `src/notifications.ts` | `insertNotification`, `listUndeliveredNotifications`, `markNotificationDelivered`, `deleteDeliveredNotifications`, `listNotificationsAfter`, `notificationCursor`, `advanceNotificationCursor` | `notifications`, `notification_cursors` |
| `src/extractions.ts`   | `addPendingExtraction`, `listPendingExtractions`, `deletePendingExtraction`, `countExtractionAttempt`                                                                                          | `pending_extractions`                   |
| `src/memories.ts`      | `listMemories`, `insertMemory`, `updateMemory`, `searchMemories`, `deleteMemory`                                                                                                               | `memories`, `memory_vectors`            |
| `src/checkpointer.ts`  | `createCheckpointer`, `listThreadIds`                                                                                                                                                          | LangGraph checkpoint tables             |

Exported types: `Db`, `InstallationInput`, `StoredInstallation`, `Notification`, `PendingExtraction`, `MemoryInput`, `MemoryMatch`.

JSON columns are parsed back with the zod schemas from `@neosaider/contracts`, so invalid stored data fails loudly.

Tables, columns and behaviour: [docs/DATA-MODEL.md](./docs/DATA-MODEL.md).

## Commands

```sh
pnpm --filter @neosaider/storage build
pnpm --filter @neosaider/storage test   # node --test over dist, in-memory SQLite
pnpm --filter @neosaider/storage lint
pnpm --filter @neosaider/storage check-types
```

## Migrations

Migrations are an array of SQL strings in `src/migrations.ts`, tracked with `PRAGMA user_version`. Only append new entries; never edit or reorder existing ones, because databases already on disk have run them.

## Related documentation

- [Architecture](../../docs/ARCHITECTURE.md)
- [Core](../core/README.md) and its [memory](../core/docs/MEMORY.md) and [scheduler](../core/docs/SCHEDULER.md) docs
