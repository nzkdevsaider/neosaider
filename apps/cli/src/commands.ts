import { randomUUID } from "node:crypto";
import { styleText } from "node:util";
import type { ModuleRegistration } from "@neosaider/contracts";
import type { NeosaiderClient } from "./client.js";

export type Output = {
  write: (text: string) => void;
  line: (text: string) => void;
};

export type Session = { threadId: string };

type Context = { client: NeosaiderClient; session: Session; out: Output };

const RESULT_PREVIEW_LENGTH = 200;
const CRON_FIELDS = 5;

const dim = (text: string) => styleText("dim", text);
const preview = (text: string) =>
  text.length > RESULT_PREVIEW_LENGTH
    ? `${text.slice(0, RESULT_PREVIEW_LENGTH)}…`
    : text;

export const HELP = `Type a message to chat with Neo, or a command:
  /thread [id]                         show or switch the current thread
  /new                                 start a fresh thread
  /history                             show the current thread
  /modules                             list MCP modules
  /modules add <name> <url>            register an HTTP module
  /modules rm <name>                   remove a module
  /triggers                            list triggers
  /triggers add cron <m h dom mon dow> <prompt>
  /triggers add session <prompt>       run when a client connects
  /triggers rm <id>                    remove a trigger
  /memories                            list what Neo remembers
  /memories rm <id>                    forget a memory
  /help                                show this help
  /quit                                exit`;

async function chat({ client, session, out }: Context, message: string) {
  let midLine = false;
  const endLine = () => {
    if (midLine) out.write("\n");
    midLine = false;
  };
  for await (const event of client.chat(session.threadId, message)) {
    if (event.type === "token") {
      out.write(event.content);
      midLine = true;
    } else if (event.type === "tool_call") {
      endLine();
      out.line(dim(`→ ${event.name} ${JSON.stringify(event.args)}`));
    } else if (event.type === "tool_result") {
      out.line(dim(`← ${event.name}: ${preview(event.content)}`));
    } else if (event.type === "error") {
      endLine();
      out.line(styleText("red", `error: ${event.message}`));
    }
  }
  endLine();
}

async function history({ client, session, out }: Context) {
  for (const message of await client.history(session.threadId)) {
    if (message.role === "user")
      out.line(styleText("cyan", `you> ${message.content}`));
    else if (message.role === "tool")
      out.line(dim(`← ${preview(message.content)}`));
    else {
      for (const call of message.toolCalls ?? []) {
        out.line(dim(`→ ${call.name} ${JSON.stringify(call.args)}`));
      }
      if (message.content) out.line(`neo> ${message.content}`);
    }
  }
}

async function modules({ client, out }: Context, args: string[]) {
  const [action, name, url] = args;
  if (action === "add" && name && url) {
    const registration: ModuleRegistration = { name, transport: "http", url };
    const status = await client.addModule(registration);
    out.line(
      status.available ? `✔ ${name} connected` : `✖ ${name}: ${status.error}`,
    );
  } else if (action === "rm" && name) {
    await client.removeModule(name);
    out.line(`removed ${name}`);
  } else if (!action) {
    const statuses = await client.modules();
    if (!statuses.length) out.line(dim("no modules"));
    for (const status of statuses) {
      const where = dim(
        [
          status.installation?.manifest.version,
          status.url ?? status.installation?.state,
        ]
          .filter(Boolean)
          .join(" "),
      );
      out.line(
        status.available
          ? `✔ ${status.name} ${where}`
          : `✖ ${status.name} ${where} ${styleText("red", status.error ?? "")}`,
      );
    }
  } else {
    out.line(HELP);
  }
}

async function triggers({ client, out }: Context, args: string[]) {
  const [action, kind, ...rest] = args;
  if (action === "add" && kind === "cron" && rest.length > CRON_FIELDS) {
    const trigger = await client.addTrigger({
      kind: "cron",
      schedule: rest.slice(0, CRON_FIELDS).join(" "),
      prompt: rest.slice(CRON_FIELDS).join(" "),
    });
    out.line(`added trigger #${trigger.id}`);
  } else if (action === "add" && kind === "session" && rest.length) {
    const trigger = await client.addTrigger({
      kind: "event",
      event: "session.start",
      prompt: rest.join(" "),
    });
    out.line(`added trigger #${trigger.id}`);
  } else if (action === "rm" && kind) {
    await client.removeTrigger(kind);
    out.line(`removed trigger #${kind}`);
  } else if (!action) {
    const list = await client.triggers();
    if (!list.length) out.line(dim("no triggers"));
    for (const trigger of list) {
      const when =
        trigger.kind === "cron"
          ? `cron ${trigger.schedule}`
          : trigger.kind === "once"
            ? `once at ${new Date(trigger.at).toLocaleString()}`
            : `on ${trigger.event}`;
      out.line(`#${trigger.id} ${dim(when)} ${trigger.prompt}`);
    }
  } else {
    out.line(HELP);
  }
}

async function memories({ client, out }: Context, args: string[]) {
  const [action, id] = args;
  if (action === "rm" && id) {
    await client.removeMemory(id);
    out.line(`forgot memory #${id}`);
  } else if (!action) {
    const list = await client.memories();
    if (!list.length) out.line(dim("no memories"));
    for (const memory of list) {
      out.line(`#${memory.id} ${dim(`[${memory.kind}]`)} ${memory.content}`);
    }
  } else {
    out.line(HELP);
  }
}

export async function runCommand(
  input: string,
  context: Context,
): Promise<"quit" | undefined> {
  if (!input.startsWith("/")) {
    await chat(context, input);
    return undefined;
  }
  const [command, ...args] = input.slice(1).split(/\s+/);
  switch (command) {
    case "quit":
    case "exit":
      return "quit";
    case "thread":
      if (args[0]) context.session.threadId = args[0];
      context.out.line(`thread: ${context.session.threadId}`);
      break;
    case "new":
      context.session.threadId = `cli-${randomUUID().slice(0, 8)}`;
      context.out.line(`thread: ${context.session.threadId}`);
      break;
    case "history":
      await history(context);
      break;
    case "modules":
      await modules(context, args);
      break;
    case "triggers":
      await triggers(context, args);
      break;
    case "memories":
      await memories(context, args);
      break;
    default:
      context.out.line(HELP);
  }
  return undefined;
}
