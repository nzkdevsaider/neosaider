import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatStreamEvent, SuggestionEvent } from "@neosaider/contracts";
import {
  addPendingExtraction,
  listMemories,
  listPendingExtractions,
  openDatabase,
} from "@neosaider/storage";
import { AIMessage } from "@langchain/core/messages";
import {
  axis,
  fakeEmbeddings,
  ScriptedChatModel,
  structuredReply,
} from "./fakes.js";
import { createNeo } from "./neo.js";

const bagOfWordsEmbeddings = fakeEmbeddings();

test("chat streams tool calls and the answer, persists history and extracts memories", async () => {
  const db = openDatabase(":memory:");
  const neo = await createNeo({
    db,
    models: {
      chat: new ScriptedChatModel([
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call-1",
              name: "remember",
              args: { content: "The user trains at 6am", kind: "fact" },
            },
          ],
        }),
        new AIMessage("Noted, 6am it is."),
      ]),
      fast: new ScriptedChatModel([
        structuredReply({
          memories: [
            { content: "The user trains at 6am", kind: "fact" },
            { content: "The user is called Sebas", kind: "profile" },
          ],
        }),
      ]),
      embeddings: fakeEmbeddings({
        "The user trains at 6am": axis(2),
        "The user is called Sebas": axis(3),
      }),
    },
  });

  const events: ChatStreamEvent[] = [];
  for await (const event of neo.chat("t1", "I train at 6am"))
    events.push(event);

  assert.deepEqual(
    events.map((event) => event.type),
    ["tool_call", "tool_result", "token", "done"],
  );
  assert.deepEqual(events[2], { type: "token", content: "Noted, 6am it is." });

  const history = await neo.history("t1");
  assert.deepEqual(
    history.map((message) => message.role),
    ["user", "assistant", "tool", "assistant"],
  );

  await neo.memory.whenIdle();
  assert.deepEqual(
    listMemories(db).map((memory) => memory.content),
    ["The user trains at 6am", "The user is called Sebas"],
  );

  await neo.close();
});

test("event triggers run Neo on a fresh thread and emit a suggestion", async () => {
  const db = openDatabase(":memory:");
  const neo = await createNeo({
    db,
    models: {
      chat: new ScriptedChatModel([new AIMessage("Time for a 20 minute run.")]),
      fast: new ScriptedChatModel([]),
      embeddings: bagOfWordsEmbeddings,
    },
  });

  assert.throws(() =>
    neo.triggers.create({ kind: "cron", schedule: "not a cron", prompt: "x" }),
  );

  const trigger = neo.triggers.create({
    kind: "event",
    event: "session.start",
    prompt: "The user just connected. Suggest a workout.",
  });
  const suggestion = new Promise((resolve) =>
    neo.bus.once("suggestion", resolve),
  );
  neo.bus.emit("session.start");

  const { id, threadId } = (await suggestion) as SuggestionEvent;
  assert.deepEqual(await suggestion, {
    type: "suggestion",
    id,
    triggerId: trigger.id,
    threadId,
    content: "Time for a 20 minute run.",
  });
  assert.deepEqual(neo.notifications.pending(), [await suggestion]);
  assert.equal((await neo.history(threadId)).length, 2);

  const eightDaysLater = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  await neo.pruneProactiveThreads(eightDaysLater);
  assert.deepEqual(await neo.history(threadId), []);

  assert.equal(neo.triggers.delete(trigger.id), true);
  assert.equal(neo.bus.listenerCount("session.start"), 0);
  await neo.close();
});

test("without an embedding model Neo chats normally and keeps no memories", async () => {
  const db = openDatabase(":memory:");
  const neo = await createNeo({
    db,
    models: {
      chat: new ScriptedChatModel([new AIMessage("Hi!")]),
      fast: new ScriptedChatModel([]),
    },
  });

  const events: ChatStreamEvent[] = [];
  for await (const event of neo.chat("t1", "I train at 6am"))
    events.push(event);
  await neo.memory.whenIdle();

  assert.deepEqual(events, [
    { type: "token", content: "Hi!" },
    { type: "done" },
  ]);
  assert.deepEqual(listMemories(db), []);
  await neo.close();
});

test("Neo's system prompt reflects the live state of the harness", async () => {
  const chat = new ScriptedChatModel([new AIMessage("ok")]);
  const neo = await createNeo({
    db: openDatabase(":memory:"),
    models: { chat, fast: new ScriptedChatModel([]) },
  });
  const systemPromptOfNextTurn = async () => {
    for await (const event of neo.chat("t1", "what can you do?")) void event;
    return chat.prompts.at(-1)?.[0]?.text ?? "";
  };

  const before = await systemPromptOfNextTurn();
  assert.match(before, /Long-term memory: Disabled/);
  assert.match(before, /Current tasks:\n- None\./);

  neo.triggers.create({
    kind: "event",
    event: "session.start",
    prompt: "Greet the user",
  });
  assert.match(
    await systemPromptOfNextTurn(),
    /- task #1 whenever a client connects: Greet the user/,
  );
  await neo.close();
});

test("Neo schedules a one-off reminder that fires once and is then removed", async () => {
  const chat = new ScriptedChatModel([
    new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "bad",
          name: "schedule_task",
          args: { task: "x", inSeconds: 1, cron: "* * * * *" },
        },
      ],
    }),
    new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "good",
          name: "schedule_task",
          args: { task: 'Remind the user: "Eres increíble"', inSeconds: 1 },
        },
      ],
    }),
    new AIMessage("Te lo recordaré en 1 segundo."),
    new AIMessage("¡Eres increíble!"),
  ]);
  const neo = await createNeo({
    db: openDatabase(":memory:"),
    models: { chat, fast: new ScriptedChatModel([]) },
  });
  const suggestion = new Promise<{ content: string }>((resolve) =>
    neo.bus.once("suggestion", resolve),
  );

  const results: string[] = [];
  for await (const event of neo.chat(
    "t1",
    'Recuérdame en 1 segundo: "Eres increíble"',
  )) {
    if (event.type === "tool_result") results.push(event.content);
  }

  assert.match(results[0]!, /exactly one of inSeconds, at or cron/);
  assert.match(
    results[1]!,
    /Scheduled task #1 once at .*: Remind the user: "Eres increíble"/,
  );
  assert.equal(neo.triggers.list()[0]?.kind, "once");

  assert.equal((await suggestion).content, "¡Eres increíble!");
  assert.match(
    chat.prompts.at(-1)!.at(-1)!.text,
    /Scheduled task #1 is due now/,
  );
  assert.deepEqual(neo.triggers.list(), []);
  await neo.close();
});

test("pending memory extractions wait for a successful run before retrying", async () => {
  const db = openDatabase(":memory:");
  addPendingExtraction(db, "User: I like tea");
  const fast = new ScriptedChatModel([
    structuredReply({ memories: [] }),
    structuredReply({
      memories: [{ content: "The user likes tea", kind: "fact" }],
    }),
  ]);
  const neo = await createNeo({
    db,
    models: {
      chat: new ScriptedChatModel([new AIMessage("Hi!")]),
      fast,
      embeddings: fakeEmbeddings({ "The user likes tea": axis(1) }),
    },
  });

  await neo.memory.whenIdle();
  assert.equal(fast.prompts.length, 0);
  assert.equal(listPendingExtractions(db).length, 1);

  for await (const event of neo.chat("t1", "hello")) void event;
  await neo.memory.whenIdle();

  assert.equal(fast.prompts.length, 2);
  assert.deepEqual(listPendingExtractions(db), []);
  assert.deepEqual(
    listMemories(db).map((memory) => memory.content),
    ["The user likes tea"],
  );
  await neo.close();
});
