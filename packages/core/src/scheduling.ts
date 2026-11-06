import { tool } from "@langchain/core/tools";
import type { Trigger, TriggerDefinition } from "@neosaider/contracts";
import { z } from "zod";
import { describeTrigger } from "./self-description.js";

export type TriggerApi = {
  list: () => Trigger[];
  create: (definition: TriggerDefinition) => Trigger;
  delete: (id: number) => boolean;
};

function parseLocalDateTime(value: string, now: Date): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      "`at` must be an ISO 8601 date-time such as 2026-10-10T18:30:00",
    );
  }
  if (date.getTime() <= now.getTime()) {
    throw new Error("That time has already passed; pick a future time.");
  }
  return date;
}

function toDefinition(
  { task, inSeconds, at, cron }: ScheduleInput,
  now: Date,
): TriggerDefinition {
  const chosen = [inSeconds, at, cron].filter(
    (value) => value !== null && value !== undefined,
  );
  if (chosen.length !== 1) {
    throw new Error("Provide exactly one of inSeconds, at or cron.");
  }
  if (cron) return { kind: "cron", schedule: cron, prompt: task };
  const runAt = inSeconds
    ? new Date(now.getTime() + inSeconds * 1000)
    : parseLocalDateTime(at!, now);
  return { kind: "once", at: runAt.toISOString(), prompt: task };
}

const scheduleSchema = z.object({
  task: z
    .string()
    .min(1)
    .describe(
      'What you must do when it runs, as an instruction to yourself, e.g. Remind the user: "You are amazing"',
    ),
  inSeconds: z
    .number()
    .int()
    .positive()
    .nullish()
    .describe("Run once after this many seconds. Use it for relative times."),
  at: z
    .string()
    .nullish()
    .describe(
      "Run once at this local date-time, ISO 8601, e.g. 2026-10-10T18:30:00",
    ),
  cron: z
    .string()
    .nullish()
    .describe(
      'Repeat on this cron schedule (minute hour day-of-month month day-of-week), e.g. "0 7 * * *" every day at 07:00',
    ),
});

type ScheduleInput = z.infer<typeof scheduleSchema>;

export function createSchedulingTools(triggers: TriggerApi, timeZone: string) {
  return [
    tool(
      async (input) => {
        const trigger = triggers.create(toDefinition(input, new Date()));
        return `Scheduled ${describeTrigger(trigger, timeZone)}`;
      },
      {
        name: "schedule_task",
        description:
          "Schedule a reminder or task that you will carry out later: once after some seconds, once at a date-time, or repeatedly on a cron schedule. When it runs, your reply is sent to the user as a notification.",
        schema: scheduleSchema,
      },
    ),
    tool(
      async () => {
        const scheduled = triggers.list();
        return scheduled.length
          ? scheduled
              .map((trigger) => `- ${describeTrigger(trigger, timeZone)}`)
              .join("\n")
          : "No scheduled tasks.";
      },
      {
        name: "list_scheduled_tasks",
        description: "List the scheduled tasks and reminders.",
        schema: z.object({}),
      },
    ),
    tool(
      async ({ id }) =>
        triggers.delete(id)
          ? `Cancelled task #${id}.`
          : `There is no task #${id}.`,
      {
        name: "cancel_scheduled_task",
        description: "Cancel a scheduled task or reminder by its id.",
        schema: z.object({ id: z.number().int() }),
      },
    ),
  ];
}
