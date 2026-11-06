import type { Trigger } from "@neosaider/contracts";
import { deleteTrigger, listTriggers, type Db } from "@neosaider/storage";
import { Cron } from "croner";
import type { EventBus } from "./events.js";

export function assertValidSchedule(schedule: string): void {
  if (schedule.trim().split(/\s+/).length !== 5) {
    throw new Error(
      "A schedule must be a standard 5-field cron expression: minute hour day-of-month month day-of-week.",
    );
  }
  new Cron(schedule, { paused: true }).stop();
}

export function createScheduler(
  db: Db,
  bus: EventBus,
  fire: (trigger: Trigger) => Promise<void>,
) {
  let stopActive: (() => void)[] = [];

  const fireSafely = (trigger: Trigger) =>
    fire(trigger).catch((error: unknown) =>
      console.error(`Trigger ${trigger.id} failed`, error),
    );

  function stop(): void {
    stopActive.forEach((stopOne) => stopOne());
    stopActive = [];
  }

  function reload(): void {
    stop();
    for (const trigger of listTriggers(db)) {
      if (trigger.kind === "cron") {
        const job = new Cron(trigger.schedule, { protect: true }, () =>
          fireSafely(trigger),
        );
        stopActive.push(() => job.stop());
      } else if (trigger.kind === "once") {
        const fireOnce = () => {
          deleteTrigger(db, trigger.id);
          void fireSafely(trigger);
        };
        const at = new Date(trigger.at);
        if (at.getTime() <= Date.now()) {
          fireOnce();
          continue;
        }
        const job = new Cron(at, { maxRuns: 1 }, fireOnce);
        stopActive.push(() => job.stop());
      } else {
        const listener = () => void fireSafely(trigger);
        bus.on(trigger.event, listener);
        stopActive.push(() => bus.off(trigger.event, listener));
      }
    }
  }

  return { reload, stop };
}
