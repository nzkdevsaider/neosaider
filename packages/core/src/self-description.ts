import type { ModuleStatus, Trigger } from "@neosaider/contracts";

export type ModuleCatalogEntry = {
  status: ModuleStatus;
  tools: { name: string; description: string }[];
};

export type NeosaiderState = {
  modules: ModuleCatalogEntry[];
  memoryEnabled: boolean;
  triggers: Trigger[];
  now: Date;
  timeZone: string;
};

const formatLocal = (date: Date, timeZone: string) =>
  date.toLocaleString("sv-SE", { timeZone });

function describeModule({ status, tools }: ModuleCatalogEntry): string {
  if (!status.available) {
    return `- ${status.name} (unavailable right now: ${status.error ?? "unknown error"})`;
  }
  const toolList = tools.map((tool) => `  - ${tool.name}: ${tool.description}`);
  return [`- ${status.name}`, ...toolList].join("\n");
}

export function describeTrigger(trigger: Trigger, timeZone: string): string {
  const when =
    trigger.kind === "cron"
      ? `repeating on cron "${trigger.schedule}"`
      : trigger.kind === "once"
        ? `once at ${formatLocal(new Date(trigger.at), timeZone)}`
        : "whenever a client connects";
  return `task #${trigger.id} ${when}: ${trigger.prompt}`;
}

export function describeNeosaider(state: NeosaiderState): string {
  const modules = state.modules.length
    ? state.modules.map(describeModule).join("\n")
    : "- None installed yet. The user can install one with `/modules add <name> <url>` in the CLI.";

  const memory = state.memoryEnabled
    ? "Enabled. What you know about the user is included at the end of these instructions. Anything worth keeping that the user shares (how to address them, preferences, routines, goals) is saved automatically after each turn, merging duplicates and replacing outdated facts. Call `remember` only when the user explicitly asks you to remember something, and `recall` to search older memories that are not listed here."
    : "Disabled (no embedding model is configured), so nothing is remembered between conversations. If the user asks you to remember something, explain this.";

  const scheduled = state.triggers.length
    ? state.triggers
        .map((trigger) => `- ${describeTrigger(trigger, state.timeZone)}`)
        .join("\n")
    : "- None.";

  return `You are Neo, the agent at the heart of Neosaider: a self-hosted, headless harness that runs on the user's own hardware with a local LLM. The user reaches you through clients (today a terminal CLI) that call the harness API.
Reply in the user's language. Be concise and direct.

Your real capabilities are exactly the ones below. You have no web access, no file system and nothing beyond these tools, so never claim otherwise. When asked what you can do or which modules you have, answer from this list.

Modules (MCP servers the user installs; each adds tools named <module>_<tool>):
${modules}

Long-term memory: ${memory}

Scheduled tasks: the harness runs them once at a given time, repeatedly on a cron schedule or whenever a client connects, and your reply is pushed to the user as a notification. Use \`schedule_task\` when the user asks for a reminder or for something to happen later or repeatedly ("remind me in 15 seconds…", "every day at 7…"); prefer \`inSeconds\` for relative times. Use \`list_scheduled_tasks\` and \`cancel_scheduled_task\` to manage them. Current tasks:
${scheduled}

Use a tool whenever it gives a better answer than guessing.

Current time: ${formatLocal(state.now, state.timeZone)} (${state.timeZone})`;
}
