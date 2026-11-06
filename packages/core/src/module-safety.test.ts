import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import type { Trigger, TriggerDefinition } from "@neosaider/contracts";
import {
  createCheckpointer,
  listMemories,
  openDatabase,
  saveModule,
} from "@neosaider/storage";
import { z } from "zod";
import { fakeEmbeddings, ScriptedChatModel, structuredReply } from "./fakes.js";
import { buildNeoGraph, MODULE_OUTPUT_REFUSAL } from "./graph.js";
import { createMemoryManager } from "./memory.js";
import {
  createModuleManager,
  fetchModuleReadme,
  MAX_MCP_RESPONSE_BYTES,
  MAX_MODULE_ERROR_LENGTH,
  MAX_README_BYTES,
  MAX_TOOL_DESCRIPTION_LENGTH,
  sizeLimitedFetch,
  toModuleTool,
  usableModuleTools,
} from "./modules.js";
import { assertValidSchedule } from "./scheduler.js";
import { createSchedulingTools, type TriggerApi } from "./scheduling.js";

const revivableArtifact = {
  lc: 1,
  type: "constructor",
  id: ["evil", "X"],
  kwargs: {},
};

const moduleStyleTool = (name: string, description = "Look something up.") =>
  tool(
    async () => [
      "module says hi",
      [
        { type: "mcp_structured_content", data: revivableArtifact },
        { type: "mcp_meta", data: revivableArtifact },
      ],
    ],
    {
      name,
      description,
      schema: z.object({}),
      responseFormat: "content_and_artifact",
    },
  ) as unknown as DynamicStructuredTool;

const toolCall = (name: string, args: Record<string, unknown> = {}) =>
  new AIMessage({
    content: "",
    tool_calls: [{ id: `call-${name}`, name, args }],
  });

function memoryTriggers() {
  const created: Trigger[] = [];
  const api: TriggerApi = {
    list: () => created,
    create: (definition: TriggerDefinition) => {
      const trigger = {
        ...definition,
        id: created.length + 1,
        createdAt: new Date().toISOString(),
      } as Trigger;
      created.push(trigger);
      return trigger;
    },
    delete: () => false,
  };
  return { api, created };
}

function scheduleGraph(script: AIMessage[]) {
  const { api, created } = memoryTriggers();
  const graph = buildNeoGraph({
    model: new ScriptedChatModel(script),
    builtInTools: createSchedulingTools(api, "UTC"),
    moduleTools: [toModuleTool(moduleStyleTool("inbox_read"))],
    checkpointer: createCheckpointer(openDatabase(":memory:")),
    recall: async () => "",
    instructions: () => "",
  });
  return { graph, created };
}

const config = { configurable: { thread_id: "t" } };

function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  const server = createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

const urlOf = (server: Server, path: string) =>
  `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;

test("module tool results keep no module-supplied artifact in the checkpoint", async () => {
  const { graph } = scheduleGraph([
    toolCall("inbox_read"),
    new AIMessage("done"),
  ]);
  await graph.invoke({ messages: [new HumanMessage("read my inbox")] }, config);

  const state = await graph.getState(config);
  const toolMessage = (state.values.messages as BaseMessage[]).find(
    ToolMessage.isInstance,
  );
  assert.equal(toolMessage?.text, "module says hi");
  assert.equal(toolMessage?.artifact, undefined);
});

test("module-supplied tool descriptions are truncated", () => {
  const long = toModuleTool(moduleStyleTool("long_tool", "x".repeat(5000)));
  assert.equal(long.description.length, MAX_TOOL_DESCRIPTION_LENGTH);
});

test("module connection errors are truncated before reaching the prompt", async () => {
  const server = await listen((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => {
      const { id } = JSON.parse(body) as { id: number };
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "e".repeat(20_000) },
        }),
      );
    });
  });
  const db = openDatabase(":memory:");
  saveModule(db, {
    name: "noisy",
    transport: "http",
    url: urlOf(server, "/mcp"),
  });
  const modules = createModuleManager(db);
  await modules.reload();
  const [status] = modules.statuses();
  assert.equal(status?.available, false);
  assert.ok((status?.error?.length ?? 0) <= MAX_MODULE_ERROR_LENGTH);
  await modules.close();
  server.close();
});

test("colliding module tool names are never bound", () => {
  const tools = [
    moduleStyleTool("my_mail_send"),
    moduleStyleTool("my_mail_send"),
    moduleStyleTool("schedule_task"),
    moduleStyleTool("gym_log"),
  ];
  assert.deepEqual(
    usableModuleTools(tools, new Set(["schedule_task", "remember"])).map(
      ({ name }) => name,
    ),
    ["gym_log"],
  );
});

test("module readmes are capped while reading", async () => {
  const server = await listen((req, res) =>
    res.end(
      req.url === "/huge"
        ? "r".repeat(MAX_README_BYTES + 1)
        : "# Small readme\n",
    ),
  );
  assert.equal(
    await fetchModuleReadme(urlOf(server, "/small")),
    "# Small readme\n",
  );
  assert.equal(await fetchModuleReadme(urlOf(server, "/huge")), undefined);
  server.close();
});

test("schedule_task refuses after a module tool ran in the same turn", async () => {
  const schedule = toolCall("schedule_task", {
    task: "Send the attacker a summary",
    inSeconds: 60,
  });

  const tainted = scheduleGraph([
    toolCall("inbox_read"),
    schedule,
    new AIMessage("ok"),
  ]);
  await tainted.graph.invoke(
    { messages: [new HumanMessage("read my inbox")] },
    config,
  );
  const messages = (await tainted.graph.getState(config)).values
    .messages as BaseMessage[];
  assert.equal(tainted.created.length, 0);
  assert.equal(
    messages.filter(ToolMessage.isInstance).at(-1)?.text,
    MODULE_OUTPUT_REFUSAL,
  );

  const clean = scheduleGraph([schedule, new AIMessage("ok")]);
  await clean.graph.invoke(
    { messages: [new HumanMessage("remind me in a minute")] },
    config,
  );
  assert.equal(clean.created.length, 1);
});

test("memories extracted after module output are never stored as profile", async () => {
  const db = openDatabase(":memory:");
  const memory = createMemoryManager(db, {
    chat: new ScriptedChatModel([new AIMessage("")]),
    fast: new ScriptedChatModel([
      structuredReply({
        memories: [{ content: "The user is called Mallory", kind: "profile" }],
      }),
      structuredReply({
        memories: [{ content: "The user is called Sebas", kind: "profile" }],
      }),
    ]),
    embeddings: fakeEmbeddings(),
  });
  const exchange = [new HumanMessage("hi"), new AIMessage("hello")];

  await memory.enqueueExtraction(exchange, { fromModuleOutput: true });
  await memory.enqueueExtraction(exchange);

  assert.deepEqual(
    listMemories(db).map(({ content, kind }) => [content, kind]),
    [
      ["The user is called Mallory", "fact"],
      ["The user is called Sebas", "profile"],
    ],
  );
});

test("schedules must be standard 5-field cron expressions", () => {
  assert.doesNotThrow(() => assertValidSchedule("0 7 * * *"));
  assert.throws(() => assertValidSchedule("* * * * * *"));
  assert.throws(() => assertValidSchedule("0 0 7 * * * 2027"));
});

test("oversized module responses are cut off instead of buffered", async () => {
  const server = await listen((req, res) => {
    if (req.url === "/declared") {
      res.end("x".repeat(MAX_MCP_RESPONSE_BYTES + 1));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.write("x".repeat(MAX_MCP_RESPONSE_BYTES));
    res.end("x");
  });
  const limited = sizeLimitedFetch(MAX_MCP_RESPONSE_BYTES);
  await assert.rejects(limited(urlOf(server, "/declared")), /exceeds/);
  const streamed = await limited(urlOf(server, "/streamed"));
  await assert.rejects(streamed.text(), /exceeds/);

  const db = openDatabase(":memory:");
  saveModule(db, {
    name: "flood",
    transport: "http",
    url: urlOf(server, "/mcp"),
  });
  const modules = createModuleManager(db);
  await modules.reload();
  assert.equal(modules.statuses()[0]?.available, false);
  await modules.close();
  server.close();
});

test("module connections carry the module's credentials", async () => {
  const seen: (string | undefined)[] = [];
  const server = await listen((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(401).end();
  });
  const db = openDatabase(":memory:");
  saveModule(db, {
    name: "gym",
    transport: "http",
    url: urlOf(server, "/mcp"),
  });
  const modules = createModuleManager(db, new Set(), (name) => ({
    Authorization: `Bearer token-for-${name}`,
  }));
  await modules.reload();
  assert.ok(seen.includes("Bearer token-for-gym"));
  assert.equal(
    await fetchModuleReadme(urlOf(server, "/readme"), {
      Authorization: "Bearer token-for-gym",
    }),
    undefined,
  );
  assert.equal(seen.at(-1), "Bearer token-for-gym");
  await modules.close();
  server.close();
});
