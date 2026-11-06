import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { ChatStreamEvent } from "@neosaider/contracts";
import { createClient, type NeosaiderClient } from "./client.js";
import { runCommand } from "./commands.js";
import { parseServerSentEvents } from "./sse.js";

async function* fromChunks(chunks: string[]) {
  yield* chunks;
}

test("SSE events are reassembled across chunk boundaries", async () => {
  const events = [];
  for await (const event of parseServerSentEvents(
    fromChunks([
      'event: token\ndata: {"a"',
      ":1}\n\nevent: do",
      "ne\ndata: {}\n\n: comment\n\n",
    ]),
  )) {
    events.push(event);
  }
  assert.deepEqual(events, [
    { event: "token", data: '{"a":1}' },
    { event: "done", data: "{}" },
  ]);
});

test("chat renders tokens and tool activity, commands switch threads", async () => {
  const chatEvents: ChatStreamEvent[] = [
    { type: "tool_call", name: "gym_log_workout", args: { minutes: 30 } },
    { type: "tool_result", name: "gym_log_workout", content: "ok" },
    { type: "token", content: "Logged " },
    { type: "token", content: "it." },
    { type: "done" },
  ];
  const seenThreads: string[] = [];
  const client = {
    async *chat(threadId: string) {
      seenThreads.push(threadId);
      yield* chatEvents;
    },
  } as unknown as NeosaiderClient;

  let printed = "";
  const out = {
    write: (text: string) => {
      printed += text;
    },
    line: (text: string) => {
      printed += `${text}\n`;
    },
  };
  const session = { threadId: "cli" };

  await runCommand("I ran 30 minutes", { client, session, out });
  assert.equal(
    stripVTControlCharacters(printed),
    '→ gym_log_workout {"minutes":30}\n← gym_log_workout: ok\nLogged it.\n',
  );

  await runCommand("/thread morning", { client, session, out });
  await runCommand("hi", { client, session, out });
  assert.deepEqual(seenThreads, ["cli", "morning"]);
  assert.equal(await runCommand("/quit", { client, session, out }), "quit");
});

test("harness text reaches the CLI with terminal control characters neutralized", async (t) => {
  const osc52 = "\u001b]52;c;ZHVtbXk=\u0007\u009b2J";
  const toolResult = { type: "tool_result", name: "x", content: osc52 };
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.endsWith("/memories")
      ? Response.json([{ id: 1, kind: "fact", content: osc52 }])
      : new Response(
          `event: tool_result\ndata: ${JSON.stringify(toolResult)}\n\n`,
        ),
  );
  const client = createClient("http://harness.test", "token");

  const received: ChatStreamEvent[] = [];
  for await (const event of client.chat("cli", "hi")) received.push(event);
  const [memory] = await client.memories();

  const visibleEscape = String.raw`\x1b]52;c;ZHVtbXk=\x07\x9b2J`;
  assert.deepEqual(received, [{ ...toolResult, content: visibleEscape }]);
  assert.equal(memory?.content, visibleEscape);
});
