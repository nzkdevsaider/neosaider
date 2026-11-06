---
title: Scheduler and notifications
description: Trigger kinds, how the scheduler runs them with croner and the event bus, and the notification inbox with per-client cursors.
---

# Scheduler and notifications

A trigger asks Neo to run a prompt later. When it fires, Neo answers on a new proactive thread and the answer becomes a notification. Code: `src/scheduler.ts`, `src/scheduling.ts`, `src/events.ts` and `fireTrigger` in `src/neo.ts`.

## Trigger kinds

Triggers are validated by `triggerDefinitionSchema` in `@neosaider/contracts` and stored as JSON in the `triggers` table.

| Kind    | Fields                                     | Behaviour                                                                                                                   |
| ------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `once`  | `at` (ISO date-time with offset), `prompt` | Fires once. The row is deleted right before firing. If `at` is already past when the scheduler loads, it fires immediately. |
| `cron`  | `schedule`, `prompt`                       | Fires on every match of the cron expression. Kept until cancelled.                                                          |
| `event` | `event` (`session.start`), `prompt`        | Fires every time the event is emitted on the bus. Kept until cancelled.                                                     |

Triggers are created through `neo.triggers.create` (the API) or the `schedule_task` tool. Cron expressions are checked with `assertValidSchedule`, which accepts only standard 5-field expressions (minute hour day-of-month month day-of-week; croner's seconds and year fields are rejected) and builds a paused `Cron` to reject invalid syntax. The tool converts `inSeconds` and `at` into `once` triggers and `cron` into `cron` triggers; `at` is parsed as local time and must be in the future.

Trigger ids use `AUTOINCREMENT`, so a deleted id is never reused.

## Scheduler

`createScheduler(db, bus, fire)` returns `reload()` and `stop()`. `reload()` stops every active job and rebuilds them from `listTriggers(db)`:

- `cron`: `new Cron(schedule, { protect: true }, ...)` from croner; `protect` skips a run while the previous one is still running.
- `once`: `new Cron(date, { maxRuns: 1 }, ...)`.
- `event`: a listener on the event bus.

`reload()` is called at startup and after every create or delete. Errors from a firing are caught and logged as `Trigger <id> failed`.

## Event bus

`createEventBus()` is a typed Node `EventEmitter`:

| Event           | Payload           | Emitted by                                          |
| --------------- | ----------------- | --------------------------------------------------- |
| `session.start` | none              | The harness, when a client opens the events stream. |
| `suggestion`    | `SuggestionEvent` | `fireTrigger`, after storing a notification.        |

## Firing

`fireTrigger(trigger)`:

1. Runs Neo on thread `proactive:<triggerId>:<Date.now()>` with `Scheduled task #<id> is due now. Your reply is delivered to the user as a notification, so write it directly to them. Task: <prompt>`.
2. Inserts the final text into `notifications` (`trigger_id`, `thread_id`, `content`).
3. Emits `suggestion` on the bus.
4. Resumes pending memory extractions.

## Notification inbox

`neo.notifications` exposes:

| Method                     | Without `client`                             | With `client`                                                      |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `pending(client?)`         | Every notification with `delivered_at` null. | Every notification with `id` greater than the client's cursor.     |
| `acknowledge(id, client?)` | Sets `delivered_at`.                         | Sets `delivered_at` and advances the cursor to `max(last_id, id)`. |

A client cursor is created on first use in `notification_cursors`. Its initial `last_id` is the id just before the oldest undelivered notification, or the newest id when everything is delivered, or `0`. So a new client receives what is still undelivered, and each client then sees every later notification even if another client acknowledged it first.

Delivered notifications older than 7 days are deleted by the retention sweep; see [AGENT.md](./AGENT.md#retention).
