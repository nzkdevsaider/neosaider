#!/usr/bin/env node
import { hostname } from "node:os";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { styleText } from "node:util";
import { createClient, type NeosaiderClient } from "./client.js";
import { runCommand, type Output } from "./commands.js";

const token = process.env.NEOSAIDER_API_TOKEN;
if (!token) {
  console.error("Set NEOSAIDER_API_TOKEN (the harness token) to use the CLI.");
  process.exit(1);
}
const baseUrl =
  process.env.NEOSAIDER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const client = createClient(baseUrl, token);
const clientName = process.env.NEOSAIDER_CLIENT ?? hostname();
const session = { threadId: process.argv[2] ?? "cli" };
const out: Output = {
  write: (text) => stdout.write(text),
  line: (text) => stdout.write(`${text}\n`),
};

const health = await client.health().catch(() => undefined);
if (!health) {
  console.error(`Cannot reach the harness at ${baseUrl}.`);
  process.exit(1);
}
out.line(
  `Connected to ${baseUrl}, thread "${session.threadId}". /help for commands.`,
);
if (!health.llm) {
  out.line(
    styleText("yellow", "Warning: the harness cannot reach its LLM server."),
  );
}

const rl = createInterface({ input: stdin, output: stdout });
const events = new AbortController();
let inputClosed = false;
rl.once("close", () => {
  inputClosed = true;
});
const showPrompt = (preserveCursor = false) => {
  if (inputClosed) return;
  rl.setPrompt(`${session.threadId}> `);
  rl.prompt(preserveCursor);
};

async function printSuggestions(api: NeosaiderClient) {
  try {
    for await (const event of api.suggestions(events.signal, clientName)) {
      if (event.type !== "suggestion") continue;
      out.line(`\n${styleText("yellow", "neo (proactive)>")} ${event.content}`);
      showPrompt(true);
    }
  } catch (error) {
    if (!events.signal.aborted) {
      out.line(
        styleText("dim", `\nsuggestions disconnected: ${String(error)}`),
      );
    }
  }
}

void printSuggestions(client);

showPrompt();
for await (const line of rl) {
  const input = line.trim();
  if (input) {
    try {
      if ((await runCommand(input, { client, session, out })) === "quit") break;
    } catch (error) {
      out.line(
        styleText(
          "red",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
  showPrompt();
}
rl.close();
events.abort();
process.exit(0);
