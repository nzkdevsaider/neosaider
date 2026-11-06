import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StateSnapshot } from "@langchain/langgraph";
import {
  StreamChannel,
  matchesSubscription,
  type ProtocolEvent,
} from "@langchain/langgraph/stream";
import {
  protocolCommandSchema,
  protocolSubscriptionSchema,
  threadHistoryRequestSchema,
  threadStateUpdateSchema,
  type ProtocolCommand,
} from "@neosaider/contracts";
import type { Neo } from "@neosaider/core";
import { Hono } from "hono";

type SubscribeParams = Parameters<typeof matchesSubscription>[1];

const SSE_HEADERS = {
  "cache-control": "no-cache, no-transform",
  "content-type": "text/event-stream",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

const UNTITLED = "New conversation";
const TITLE_LENGTH = 80;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function toJsonSafe(value: unknown): unknown {
  if (BaseMessage.isInstance(value)) {
    const { type, data } = value.toDict();
    return toJsonSafe({ ...data, type });
  }
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]),
    );
  }
  return value;
}

const threadConfig = (threadId: string, checkpointId?: string) => ({
  configurable: {
    thread_id: threadId,
    checkpoint_ns: "",
    ...(checkpointId && { checkpoint_id: checkpointId }),
  },
});

function toCheckpoint(config: RunnableConfig | undefined, threadId: string) {
  const checkpointId = config?.configurable?.checkpoint_id;
  if (typeof checkpointId !== "string") return null;
  return {
    thread_id: threadId,
    checkpoint_id: checkpointId,
    checkpoint_ns: config?.configurable?.checkpoint_ns ?? "",
    checkpoint_map: null,
  };
}

const hasCheckpoint = (snapshot: StateSnapshot) =>
  toCheckpoint(snapshot.config, "") !== null;

function serializeThreadState(snapshot: StateSnapshot, threadId: string) {
  return {
    values: toJsonSafe(snapshot.values ?? {}),
    next: [...(snapshot.next ?? [])],
    tasks: (snapshot.tasks ?? []).map((task) => ({
      id: task.id,
      name: task.name,
      error: task.error == null ? null : String(task.error),
      interrupts: task.interrupts ?? [],
      path: task.path ?? null,
      checkpoint: null,
      state: null,
      result: task.result == null ? null : toJsonSafe(task.result),
    })),
    checkpoint: toCheckpoint(snapshot.config, threadId),
    metadata: { ...snapshot.metadata },
    created_at: snapshot.createdAt ?? null,
    parent_checkpoint: toCheckpoint(snapshot.parentConfig, threadId),
  };
}

function titleOf(values: unknown): string {
  const messages = isRecord(values) ? values.messages : undefined;
  if (!Array.isArray(messages)) return UNTITLED;
  const firstHuman = messages.find(
    (message) => BaseMessage.isInstance(message) && message.type === "human",
  ) as BaseMessage | undefined;
  return firstHuman?.text.trim().slice(0, TITLE_LENGTH) || UNTITLED;
}

function encodeEvent(event: ProtocolEvent): Uint8Array {
  return new TextEncoder().encode(
    `id: ${event.seq}\nevent: message\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

function createThreadSession(neo: Neo, threadId: string) {
  let log = StreamChannel.local<ProtocolEvent>();
  let nextSeq = 0;
  let activeRun: { abort: (reason?: unknown) => void } | undefined;

  function rotateLog() {
    const previous = log;
    log = StreamChannel.local<ProtocolEvent>();
    previous.close();
    return log;
  }

  function publish(runLog: StreamChannel<ProtocolEvent>, event: ProtocolEvent) {
    const params = event.params as Record<string, unknown>;
    runLog.push({
      ...event,
      type: "event",
      seq: nextSeq++,
      params: {
        ...params,
        data: toJsonSafe(params.data),
        ...("interrupts" in params && {
          interrupts: toJsonSafe(params.interrupts),
        }),
      },
    } as ProtocolEvent);
  }

  async function startRun(
    input: unknown,
    runId: string,
    runLog: StreamChannel<ProtocolEvent>,
  ) {
    activeRun?.abort("Starting a new run.");
    const run = await neo
      .graph()
      .streamEvents(
        input as Parameters<ReturnType<Neo["graph"]>["invoke"]>[0],
        {
          version: "v3",
          configurable: { thread_id: threadId, run_id: runId },
        },
      );
    activeRun = run;
    try {
      for await (const event of run) publish(runLog, event);
      await neo.extractAfterRun(threadId);
    } catch (error) {
      console.error(`Run ${runId} on thread ${threadId} failed`, error);
    } finally {
      if (activeRun === run) activeRun = undefined;
    }
  }

  function handleCommand(command: ProtocolCommand) {
    if (command.method !== "run.start") {
      return {
        type: "error",
        id: command.id,
        error: "unknown_command",
        message: `Unsupported command: ${command.method}`,
      };
    }
    const runId = randomUUID();
    void startRun(command.params.input ?? null, runId, rotateLog());
    return { type: "success", id: command.id, result: { run_id: runId } };
  }

  function stream(subscription: SubscribeParams): ReadableStream<Uint8Array> {
    let cursor = log.iterate();
    return new ReadableStream({
      async pull(controller) {
        for (;;) {
          const { value: event, done } = await cursor.next();
          if (done) {
            cursor = log.iterate();
            continue;
          }
          if (matchesSubscription(event, subscription)) {
            controller.enqueue(encodeEvent(event));
            return;
          }
        }
      },
      cancel() {
        void cursor.return?.(undefined);
      },
    });
  }

  return { handleCommand, stream };
}

export function createAgentProtocol(neo: Neo) {
  const sessions = new Map<string, ReturnType<typeof createThreadSession>>();
  const sessionFor = (threadId: string) => {
    let session = sessions.get(threadId);
    if (!session) {
      session = createThreadSession(neo, threadId);
      sessions.set(threadId, session);
    }
    return session;
  };
  const currentState = (threadId: string) =>
    neo.graph().getState(threadConfig(threadId));
  const notFound = (threadId: string) => ({
    error: "not_found",
    message: `Thread ${threadId} not found`,
  });

  const api = new Hono();

  api.get("/threads", async (c) => {
    const threads = await Promise.all(
      neo.threadIds().map(async (id) => {
        const state = await currentState(id);
        return {
          id,
          title: titleOf(state.values),
          updatedAt: state.createdAt ?? null,
        };
      }),
    );
    threads.sort((a, b) =>
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
    return c.json(threads);
  });

  api.post("/threads", (c) => {
    const now = new Date().toISOString();
    return c.json({
      thread_id: randomUUID(),
      status: "idle",
      metadata: {},
      values: {},
      created_at: now,
      updated_at: now,
    });
  });

  api.delete("/threads/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    sessions.delete(threadId);
    await neo.checkpointer.deleteThread(threadId);
    return c.body(null, 204);
  });

  api.post(
    "/threads/:threadId/commands",
    zValidator("json", protocolCommandSchema),
    (c) =>
      c.json(
        sessionFor(c.req.param("threadId")).handleCommand(c.req.valid("json")),
      ),
  );

  api.post(
    "/threads/:threadId/stream/events",
    zValidator("json", protocolSubscriptionSchema),
    (c) =>
      c.newResponse(
        sessionFor(c.req.param("threadId")).stream(
          c.req.valid("json") as SubscribeParams,
        ),
        { headers: SSE_HEADERS },
      ),
  );

  api.get("/threads/:threadId/state", async (c) => {
    const threadId = c.req.param("threadId");
    const snapshot = await currentState(threadId);
    return hasCheckpoint(snapshot)
      ? c.json(serializeThreadState(snapshot, threadId))
      : c.json(notFound(threadId), 404);
  });

  api.post(
    "/threads/:threadId/state",
    zValidator("json", threadStateUpdateSchema),
    async (c) => {
      const threadId = c.req.param("threadId");
      const { values, as_node } = c.req.valid("json");
      try {
        await neo
          .graph()
          .updateState(
            threadConfig(threadId),
            values ?? { messages: [] },
            as_node ?? "__start__",
          );
      } catch (error) {
        return c.json(
          { error: "invalid_state_update", message: String(error) },
          422,
        );
      }
      return c.json(
        serializeThreadState(await currentState(threadId), threadId),
      );
    },
  );

  api.post(
    "/threads/:threadId/history",
    zValidator("json", threadHistoryRequestSchema),
    async (c) => {
      const threadId = c.req.param("threadId");
      if (!hasCheckpoint(await currentState(threadId))) {
        return c.json(notFound(threadId), 404);
      }
      const { limit, before } = c.req.valid("json");
      const history = [];
      for await (const snapshot of neo
        .graph()
        .getStateHistory(threadConfig(threadId), {
          limit,
          ...(before && { before: threadConfig(threadId, before) }),
        })) {
        history.push(serializeThreadState(snapshot, threadId));
      }
      return c.json(history);
    },
  );

  return api;
}
