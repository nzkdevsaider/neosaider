import assert from "node:assert/strict";
import { test } from "node:test";
import { describeNeosaider } from "./self-description.js";

const now = new Date("2026-10-10T07:30:00Z");

test("an empty install says so instead of inventing capabilities", () => {
  const prompt = describeNeosaider({
    modules: [],
    memoryEnabled: false,
    triggers: [],
    now,
    timeZone: "UTC",
  });

  assert.match(prompt, /Modules[^\n]*\n- None installed yet/);
  assert.match(prompt, /Long-term memory: Disabled/);
  assert.match(prompt, /Current tasks:\n- None\./);
  assert.match(prompt, /Current time: 2026-10-10 07:30:00 \(UTC\)/);
});

test("installed modules, their tools and triggers are listed", () => {
  const prompt = describeNeosaider({
    modules: [
      {
        status: {
          name: "gym",
          url: "http://gym/mcp",
          available: true,
        },
        tools: [
          {
            name: "gym_log_workout",
            description: "Record a workout the user did.",
          },
        ],
      },
      {
        status: {
          name: "finance",
          url: "http://finance/mcp",
          available: false,
          error: "fetch failed",
        },
        tools: [],
      },
    ],
    memoryEnabled: true,
    triggers: [
      {
        id: 3,
        kind: "cron",
        schedule: "0 7 * * *",
        prompt: "Suggest a workout",
        createdAt: "",
      },
      {
        id: 4,
        kind: "event",
        event: "session.start",
        prompt: "Greet the user",
        createdAt: "",
      },
      {
        id: 5,
        kind: "once",
        at: "2026-10-10T08:00:00.000Z",
        prompt: "Stretch",
        createdAt: "",
      },
    ],
    now,
    timeZone: "Europe/Madrid",
  });

  assert.match(
    prompt,
    /- gym\n {2}- gym_log_workout: Record a workout the user did\./,
  );
  assert.match(prompt, /- finance \(unavailable right now: fetch failed\)/);
  assert.match(prompt, /Long-term memory: Enabled/);
  assert.match(
    prompt,
    /- task #3 repeating on cron "0 7 \* \* \*": Suggest a workout/,
  );
  assert.match(prompt, /- task #5 once at 2026-10-10 10:00:00: Stretch/);
  assert.match(prompt, /- task #4 whenever a client connects: Greet the user/);
  assert.match(prompt, /Current time: 2026-10-10 09:30:00 \(Europe\/Madrid\)/);
});
