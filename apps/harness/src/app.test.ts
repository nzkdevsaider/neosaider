import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FakeEmbeddings,
  FakeListChatModel,
} from "@langchain/core/utils/testing";
import { createNeo } from "@neosaider/core";
import { insertNotification, openDatabase } from "@neosaider/storage";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const token = "test-token";
const auth = { Authorization: `Bearer ${token}` };

async function createTestApp() {
  const db = openDatabase(":memory:");
  const neo = await createNeo({
    db,
    models: {
      chat: new FakeListChatModel({ responses: ["Hello from Neo"] }),
      fast: new FakeListChatModel({ responses: ['{"memories": []}'] }),
      embeddings: new FakeEmbeddings(),
    },
  });
  const app = createApp({
    neo,
    apiToken: token,
    isLlmReachable: async () => false,
  });
  return { app, neo, db };
}

test("health is public, everything else requires the bearer token", async () => {
  const { app, neo } = await createTestApp();

  const health = await app.request("/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, llm: false });

  assert.equal((await app.request("/memories")).status, 401);
  assert.equal(
    (
      await app.request("/memories", {
        headers: { Authorization: "Bearer wrong" },
      })
    ).status,
    401,
  );
  assert.equal((await app.request("/memories", { headers: auth })).status, 200);
  await neo.close();
});

test("chat streams SSE events and the thread keeps its history", async () => {
  const { app, neo } = await createTestApp();

  const response = await app.request("/threads/t1/messages", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map(
      (line) =>
        JSON.parse(line.slice("data: ".length)) as {
          type: string;
          content?: string;
        },
    );
  assert.equal(
    events
      .filter((event) => event.type === "token")
      .map((event) => event.content)
      .join(""),
    "Hello from Neo",
  );
  assert.equal(events.at(-1)?.type, "done");

  const history = await app.request("/threads/t1", { headers: auth });
  assert.deepEqual(await history.json(), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hello from Neo" },
  ]);
  await neo.close();
});

test("invalid bodies and unknown ids are rejected", async () => {
  const { app, neo } = await createTestApp();
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  assert.equal(
    (await post("/threads/t1/messages", { message: "  " })).status,
    400,
  );
  assert.equal(
    (await post("/modules", { name: "Bad Name", transport: "http", url: "x" }))
      .status,
    400,
  );
  assert.equal(
    (
      await post("/modules", {
        name: "shell",
        transport: "stdio",
        command: "sh",
      })
    ).status,
    400,
  );
  assert.equal(
    (await post("/triggers", { kind: "cron", schedule: "nope", prompt: "x" }))
      .status,
    400,
  );

  const created = await post("/triggers", {
    kind: "cron",
    schedule: "0 7 * * *",
    prompt: "Morning",
  });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: number };

  const remove = (path: string) =>
    app.request(path, { method: "DELETE", headers: auth });
  assert.equal((await remove(`/triggers/${id}`)).status, 204);
  assert.equal((await remove(`/triggers/${id}`)).status, 404);
  assert.equal((await remove("/triggers/abc")).status, 404);
  assert.equal((await remove("/modules/missing")).status, 404);
  await neo.close();
});

test("mutations with a non-JSON body are rejected with 415", async () => {
  const { app, neo } = await createTestApp();
  const send = (path: string, init: RequestInit) =>
    app.request(path, {
      method: "POST",
      ...init,
      headers: { ...auth, ...init.headers },
    });

  const textPlain = await send("/modules/gym/update", {
    headers: { "Content-Type": "text/plain" },
    body: "x",
  });
  assert.equal(textPlain.status, 415);
  assert.equal(
    (await send("/agent/threads/t1/state", { body: "x" })).status,
    415,
  );
  assert.equal(
    (
      await send("/triggers", {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "kind=cron",
      })
    ).status,
    415,
  );

  const emptyThread = await send("/agent/threads", {});
  assert.equal(emptyThread.status, 200);
  assert.equal(
    (
      await send("/agent/threads/t1/state", {
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: "{}",
      })
    ).status,
    200,
  );
  await neo.close();
});

test("the API token must be usable in a Bearer header", () => {
  assert.throws(
    () => loadConfig({ NEOSAIDER_API_TOKEN: "<tu token>" }),
    /may only contain/,
  );
  assert.equal(
    loadConfig({ NEOSAIDER_API_TOKEN: "abc123" }).apiToken,
    "abc123",
  );
});

test("notifications fired while no client was connected are delivered on connect", async () => {
  const { app, neo, db } = await createTestApp();
  const missed = insertNotification(db, {
    triggerId: 1,
    threadId: "proactive:1:0",
    content: "Drink water",
  });

  const response = await app.request("/events", { headers: auth });
  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();
  const { value } = await reader.read();
  await reader.cancel();

  assert.match(
    value!,
    new RegExp(
      `^event: suggestion\ndata: .*"Drink water".*\nid: ${missed.id}\n`,
    ),
  );
  assert.deepEqual(neo.notifications.pending(), []);
  await neo.close();
});

test("the Agent Streaming Protocol runs Neo and exposes the thread state", async () => {
  const { app, neo } = await createTestApp();
  const send = (path: string, body: unknown) =>
    app.request(`/agent${path}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  assert.equal(
    (await app.request("/agent/threads/p1/state", { headers: auth })).status,
    404,
  );
  const bootstrapped = await send("/threads/p1/state", {});
  assert.equal(bootstrapped.status, 200);
  assert.deepEqual(
    ((await bootstrapped.json()) as { values: { messages: unknown[] } }).values
      .messages,
    [],
  );

  const events = await send("/threads/p1/stream/events", {
    channels: ["values"],
  });
  assert.equal(events.headers.get("content-type"), "text/event-stream");
  const started = await send("/threads/p1/commands", {
    id: 1,
    method: "run.start",
    params: { input: { messages: [{ type: "human", content: "hi" }] } },
  });
  const { type, result } = (await started.json()) as {
    type: string;
    result: { run_id: string };
  };
  assert.equal(type, "success");
  assert.ok(result.run_id);

  const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader();
  let received = "";
  while (!received.includes("Hello from Neo")) {
    const { value, done } = await reader.read();
    assert.ok(!done, "stream ended before the answer arrived");
    received += value;
  }
  await reader.cancel();
  assert.match(received, /^id: \d+\nevent: message\ndata: \{"type":"event"/);

  await neo.memory.whenIdle();
  const state = (await (
    await app.request("/agent/threads/p1/state", { headers: auth })
  ).json()) as { values: { messages: { type: string }[] } };
  assert.deepEqual(
    state.values.messages.map(({ type }) => type),
    ["human", "ai"],
  );
  assert.match(JSON.stringify(state.values.messages[1]), /Hello from Neo/);

  const history = await send("/threads/p1/history", { limit: 2 });
  assert.equal(((await history.json()) as unknown[]).length, 2);

  const threads = await app.request("/agent/threads", { headers: auth });
  assert.deepEqual(
    ((await threads.json()) as { id: string; title: string }[]).map(
      ({ id, title }) => ({ id, title }),
    ),
    [{ id: "p1", title: "hi" }],
  );

  const unknown = await send("/threads/p1/commands", {
    id: 2,
    method: "agent.getTree",
  });
  assert.equal(
    ((await unknown.json()) as { error: string }).error,
    "unknown_command",
  );

  assert.equal((await app.request("/agent/threads")).status, 401);
  const preflight = await app.request("/agent/threads/p1/commands", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  await neo.close();
});

test("every known client receives each notification once", async () => {
  const { app, neo, db } = await createTestApp();
  const firstEvent = async (client: string) => {
    const response = await app.request(`/events?client=${client}`, {
      headers: auth,
    });
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();
    const { value } = await reader.read();
    await reader.cancel();
    return value!;
  };
  assert.deepEqual(neo.notifications.pending("laptop"), []);
  assert.deepEqual(neo.notifications.pending("phone"), []);

  insertNotification(db, {
    triggerId: 1,
    threadId: "proactive:1:0",
    content: "Drink water",
  });

  assert.match(await firstEvent("laptop"), /"Drink water"/);
  assert.match(await firstEvent("phone"), /"Drink water"/);
  assert.deepEqual(neo.notifications.pending("laptop"), []);
  assert.deepEqual(neo.notifications.pending("phone"), []);
  assert.equal(
    (await app.request("/events?client=no%20spaces", { headers: auth })).status,
    400,
  );
  await neo.close();
});

test("one Agent Streaming Protocol subscription follows consecutive runs", async () => {
  const db = openDatabase(":memory:");
  const neo = await createNeo({
    db,
    models: {
      chat: new FakeListChatModel({
        responses: ["First answer", "Second answer"],
      }),
      fast: new FakeListChatModel({ responses: ['{"memories": []}'] }),
      embeddings: new FakeEmbeddings(),
    },
  });
  const app = createApp({
    neo,
    apiToken: token,
    isLlmReachable: async () => false,
  });
  const send = (path: string, body: unknown) =>
    app.request(`/agent${path}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const start = (id: number, content: string) =>
    send("/threads/r1/commands", {
      id,
      method: "run.start",
      params: { input: { messages: [{ type: "human", content }] } },
    });

  const subscribe = async () =>
    (await send("/threads/r1/stream/events", { channels: ["values"] }))
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();
  const readUntil = async (
    reader: ReadableStreamDefaultReader<string>,
    text: string,
  ) => {
    let received = "";
    while (!received.includes(text)) received += (await reader.read()).value;
    return received;
  };
  const seqs = (received: string) =>
    [...received.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));

  const reader = await subscribe();
  await start(1, "one");
  const firstRun = seqs(await readUntil(reader, "First answer"));
  await start(2, "two");
  await readUntil(reader, "Second answer");
  await reader.cancel();

  const lateReader = await subscribe();
  const replayed = seqs(await readUntil(lateReader, "Second answer"));
  await lateReader.cancel();
  assert.ok(Math.min(...replayed) > Math.max(...firstRun));
  await neo.close();
});

test("the store lists the development catalog and refuses installs without Docker", async () => {
  const db = openDatabase(":memory:");
  const neo = await createNeo({
    db,
    models: {
      chat: new FakeListChatModel({ responses: ["ok"] }),
      fast: new FakeListChatModel({ responses: ['{"memories": []}'] }),
    },
    catalogLocation: fileURLToPath(
      new URL("../../../modules/catalog.json", import.meta.url),
    ),
  });
  const app = createApp({
    neo,
    apiToken: token,
    isLlmReachable: async () => false,
  });
  const get = (path: string) => app.request(path, { headers: auth });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const store = (await (await get("/catalog")).json()) as {
    manifest: { id: string; image: string };
  }[];
  assert.deepEqual(
    store.map(({ manifest }) => manifest.id),
    ["gym"],
  );
  assert.equal(
    ((await (await get("/catalog?tag=fitness")).json()) as unknown[]).length,
    1,
  );
  assert.deepEqual(await (await get("/catalog?q=finanzas")).json(), []);

  const detail = (await (await get("/catalog/gym")).json()) as {
    readme: string;
    versions: string[];
  };
  assert.match(detail.readme, /^# Gym/);
  assert.deepEqual(detail.versions, ["0.1.0"]);
  assert.equal((await get("/catalog/ghost")).status, 404);

  const refused = await post("/modules/install", { id: "gym" });
  assert.equal(refused.status, 503);
  assert.match(((await refused.json()) as { error: string }).error, /Docker/);
  assert.equal((await post("/modules/install", { id: "Bad Id" })).status, 400);
  assert.equal((await get("/modules/ghost/readme")).status, 404);
  assert.equal(
    (await app.request("/modules/ghost", { method: "DELETE", headers: auth }))
      .status,
    404,
  );
  assert.equal((await app.request("/catalog")).status, 401);
  await neo.close();
});

test("module updates forward the capability acknowledgement", async () => {
  const { neo } = await createTestApp();
  const calls: unknown[][] = [];
  const spied = createApp({
    neo: {
      ...neo,
      modules: {
        ...neo.modules,
        update: async (...args: unknown[]) => {
          calls.push(args);
          return {} as Awaited<ReturnType<typeof neo.modules.update>>;
        },
      },
    },
    apiToken: token,
    isLlmReachable: async () => false,
  });
  const update = (body: unknown) =>
    spied.request("/modules/gym/update", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  assert.equal((await update({})).status, 202);
  assert.equal(
    (await update({ version: "0.2.0", acceptChanges: true })).status,
    202,
  );
  assert.deepEqual(calls, [
    ["gym", undefined, { acceptChanges: false }],
    ["gym", "0.2.0", { acceptChanges: true }],
  ]);
  await neo.close();
});
