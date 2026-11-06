import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addPendingExtraction,
  listMemories,
  listPendingExtractions,
  openDatabase,
} from "@neosaider/storage";
import {
  axis,
  fakeEmbeddings,
  ScriptedChatModel,
  structuredReply,
} from "./fakes.js";
import { createMemoryManager } from "./memory.js";

const YELLOW = "The user likes yellow";
const YELLOW_AGAIN = "The user likes yellow.";
const YELLOW_PARAPHRASE = "The user enjoys the colour yellow";
const BLUE_NOW = "The user's favorite color is now blue";
const NICKNAME = "The user wants to be called Sebas";

test("new memories are added, duplicates ignored and contradictions update the old memory", async () => {
  const db = openDatabase(":memory:");
  const fast = new ScriptedChatModel([
    structuredReply({ action: "none", memoryId: 1, content: null }),
    structuredReply({
      action: "update",
      memoryId: 1,
      content: "The user's favorite color is blue",
    }),
  ]);
  const memory = createMemoryManager(db, {
    chat: new ScriptedChatModel([]),
    fast,
    embeddings: fakeEmbeddings({
      [YELLOW]: axis(0),
      [YELLOW_AGAIN]: [1, 0.01, ...axis(0).slice(2)],
      [BLUE_NOW]: [0.8, 0.6, ...axis(0).slice(2)],
      [YELLOW_PARAPHRASE]: [0.9, 0.44, ...axis(0).slice(2)],
      [NICKNAME]: axis(5),
    }),
  });

  const actionOf = async (content: string, kind?: "profile" | "fact") =>
    (await memory.remember(content, kind))?.action;

  assert.equal(await actionOf(YELLOW), "added");
  assert.equal(await actionOf(YELLOW_AGAIN), "unchanged");
  assert.equal(fast.prompts.length, 0);

  assert.equal(await actionOf(YELLOW_PARAPHRASE), "unchanged");
  assert.equal(await actionOf(BLUE_NOW), "updated");
  assert.match(
    fast.prompts[1]!.at(-1)!.text,
    /#1 \[fact\] The user likes yellow/,
  );

  assert.equal(await actionOf(NICKNAME, "profile"), "added");

  assert.deepEqual(
    listMemories(db).map(({ kind, content }) => ({ kind, content })),
    [
      { kind: "fact", content: "The user's favorite color is blue" },
      { kind: "profile", content: NICKNAME },
    ],
  );
});

test("profile memories are always in context and facts are ranked by relevance", async () => {
  const db = openDatabase(":memory:");
  const memory = createMemoryManager(db, {
    chat: new ScriptedChatModel([]),
    fast: new ScriptedChatModel([]),
    embeddings: fakeEmbeddings({
      [NICKNAME]: axis(5),
      [YELLOW]: axis(0),
      "The user runs every morning": axis(9),
      "Paint my room": axis(0),
      "How many workouts this week?": axis(9),
    }),
  });
  await memory.remember(NICKNAME, "profile");
  await memory.remember(YELLOW);
  await memory.remember("The user runs every morning");

  const aboutPainting = await memory.recallContext("Paint my room");
  assert.match(
    aboutPainting,
    /always applies[^\n]*\n- The user wants to be called Sebas\n\nMemories that may be relevant[^\n]*\n- The user likes yellow\n- The user runs every morning$/,
  );

  const aboutWorkouts = await memory.recallContext(
    "How many workouts this week?",
  );
  assert.match(
    aboutWorkouts,
    /always applies[^\n]*\n- The user wants to be called Sebas\n\nMemories that may be relevant[^\n]*\n- The user runs every morning\n- The user likes yellow$/,
  );
});

test("extractions left pending by a restart are resumed", async () => {
  const db = openDatabase(":memory:");
  addPendingExtraction(db, "User: I love yellow");
  const memory = createMemoryManager(db, {
    chat: new ScriptedChatModel([]),
    fast: new ScriptedChatModel([
      structuredReply({ memories: [{ content: YELLOW, kind: "fact" }] }),
    ]),
    embeddings: fakeEmbeddings({ [YELLOW]: axis(0) }),
  });

  await memory.resumePending();

  assert.deepEqual(
    listMemories(db).map((saved) => saved.content),
    [YELLOW],
  );
  assert.deepEqual(listPendingExtractions(db), []);
});
