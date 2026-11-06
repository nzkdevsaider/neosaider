import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type {
  ChatStreamEvent,
  CatalogEntry,
  ModuleRegistration,
  ModuleStatus,
  SuggestionEvent,
  ThreadMessage,
  Trigger,
} from "@neosaider/contracts";
import {
  createCheckpointer,
  createTrigger,
  deleteDeliveredNotifications,
  deleteMemory,
  deleteModule,
  deleteTrigger,
  getInstallation,
  insertNotification,
  listMemories,
  listThreadIds,
  listTriggers,
  advanceNotificationCursor,
  listNotificationsAfter,
  listUndeliveredNotifications,
  markNotificationDelivered,
  notificationCursor,
  saveModule,
  type Db,
} from "@neosaider/storage";
import { Cron } from "croner";
import { createCatalog, emptyCatalog } from "./catalog.js";
import { createEventBus } from "./events.js";
import {
  buildNeoGraph,
  moduleToolRanThisTurn,
  type NeoGraph,
} from "./graph.js";
import { createMemoryManager } from "./memory.js";
import type { NeoModels } from "./models.js";
import { moduleAuthorization } from "./module-auth.js";
import { createModuleInstaller, maskSecrets } from "./module-installer.js";
import type { ModuleRuntime } from "./module-runtime.js";
import { createModuleManager, fetchModuleReadme } from "./modules.js";
import { describeNeosaider } from "./self-description.js";
import { assertValidSchedule, createScheduler } from "./scheduler.js";
import { createSchedulingTools, type TriggerApi } from "./scheduling.js";

export type Neo = Awaited<ReturnType<typeof createNeo>>;

const PROACTIVE_PREFIX = "proactive:";
const PROACTIVE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_SCHEDULE = "0 4 * * *";
const MODULE_RECONNECT_MS = 15_000;

const proactiveThreadTime = (threadId: string) =>
  Number(threadId.split(":").at(-1));

const threadConfig = (threadId: string) => ({
  configurable: { thread_id: threadId },
});

function lastExchange(messages: BaseMessage[]): BaseMessage[] {
  const start = messages.findLastIndex(HumanMessage.isInstance);
  return messages
    .slice(Math.max(start, 0))
    .filter(
      (message) =>
        HumanMessage.isInstance(message) ||
        (AIMessage.isInstance(message) && message.text.length > 0),
    );
}

function toThreadMessage(message: BaseMessage): ThreadMessage {
  if (HumanMessage.isInstance(message)) {
    return { role: "user", content: message.text };
  }
  if (ToolMessage.isInstance(message)) {
    return { role: "tool", content: message.text };
  }
  const toolCalls = AIMessage.isInstance(message)
    ? (message.tool_calls ?? []).map(({ name, args }) => ({ name, args }))
    : [];
  return {
    role: "assistant",
    content: message.text,
    ...(toolCalls.length && { toolCalls }),
  };
}

function* toolEvents(update: unknown): Generator<ChatStreamEvent> {
  for (const nodeUpdate of Object.values(update as Record<string, unknown>)) {
    const messages =
      (nodeUpdate as { messages?: BaseMessage[] } | null)?.messages ?? [];
    for (const message of messages) {
      if (AIMessage.isInstance(message)) {
        for (const call of message.tool_calls ?? []) {
          yield {
            type: "tool_call",
            ...(call.id && { id: call.id }),
            name: call.name,
            args: call.args,
          };
        }
      } else if (ToolMessage.isInstance(message)) {
        yield {
          type: "tool_result",
          id: message.tool_call_id,
          name: message.name ?? "",
          content: message.text,
        };
      }
    }
  }
}

type NeoOptions = {
  db: Db;
  models: NeoModels;
  runtime?: ModuleRuntime;
  catalogLocation?: string;
  moduleSecret?: string;
};

export async function createNeo({
  db,
  models,
  runtime,
  catalogLocation,
  moduleSecret,
}: NeoOptions) {
  const bus = createEventBus();
  const checkpointer = createCheckpointer(db);
  const memory = createMemoryManager(db, models);
  const catalog = catalogLocation
    ? createCatalog(catalogLocation)
    : emptyCatalog;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const scheduler = createScheduler(db, bus, fireTrigger);

  const triggers: TriggerApi = {
    list: () => listTriggers(db),
    create: (definition) => {
      if (definition.kind === "cron") assertValidSchedule(definition.schedule);
      const trigger = createTrigger(db, definition);
      scheduler.reload();
      return trigger;
    },
    delete: (id) => {
      const removed = deleteTrigger(db, id);
      if (removed) scheduler.reload();
      return removed;
    },
  };
  const builtInTools = [
    ...memory.tools,
    ...createSchedulingTools(triggers, timeZone),
  ];
  const builtInToolNames = new Set(builtInTools.map(({ name }) => name));
  const moduleHeaders = (name: string) =>
    moduleSecret && getInstallation(db, name)
      ? moduleAuthorization(moduleSecret, name)
      : {};
  const modules = createModuleManager(db, builtInToolNames, moduleHeaders);

  const build = (): NeoGraph =>
    buildNeoGraph({
      model: models.chat,
      builtInTools,
      moduleTools: modules.tools(),
      checkpointer,
      recall: memory.recallContext,
      instructions: () =>
        describeNeosaider({
          modules: modules.catalog(),
          memoryEnabled: models.embeddings !== undefined,
          triggers: listTriggers(db),
          now: new Date(),
          timeZone,
        }),
    });

  await modules.reload();
  let graph = build();

  async function reloadModules() {
    await modules.reload();
    graph = build();
    return moduleStatuses();
  }

  const installer = createModuleInstaller({
    db,
    catalog,
    runtime,
    onModulesChanged: reloadModules,
    moduleSecret,
  });

  function moduleStatuses(): ModuleStatus[] {
    const installations = new Map(
      installer
        .installations()
        .map((installation) => [installation.name, installation]),
    );
    const withInstallation = (status: ModuleStatus): ModuleStatus => {
      const installation = installations.get(status.name);
      installations.delete(status.name);
      return installation
        ? {
            ...status,
            installation: {
              ...installation,
              config: maskSecrets(installation.manifest, installation.config),
            },
          }
        : status;
    };
    const registered = modules.statuses().map(withInstallation);
    const pendingOnly = [...installations.keys()].map((name) =>
      withInstallation({ name, available: false }),
    );
    return [...registered, ...pendingOnly];
  }

  const reconnectTimer = setInterval(() => {
    void modules
      .reconnectUnavailable()
      .then((recovered) => {
        if (recovered) graph = build();
      })
      .catch((error: unknown) =>
        console.error("Module reconnection failed", error),
      );
  }, MODULE_RECONNECT_MS);
  reconnectTimer.unref();

  async function extractAfterRun(threadId: string): Promise<void> {
    const state = await graph.getState(threadConfig(threadId));
    const messages = (state.values.messages ?? []) as BaseMessage[];
    void memory.enqueueExtraction(lastExchange(messages), {
      fromModuleOutput: moduleToolRanThisTurn(messages, builtInToolNames),
    });
    void memory.resumePending();
  }

  async function* chat(
    threadId: string,
    message: string,
  ): AsyncGenerator<ChatStreamEvent> {
    const activeGraph = graph;
    try {
      const stream = await activeGraph.stream(
        { messages: [new HumanMessage(message)] },
        { ...threadConfig(threadId), streamMode: ["messages", "updates"] },
      );
      for await (const [mode, payload] of stream as AsyncIterable<
        [string, unknown]
      >) {
        if (mode === "messages") {
          const [chunk, metadata] = payload as [
            BaseMessage,
            { langgraph_node?: string },
          ];
          if (metadata.langgraph_node === "agent" && chunk.text) {
            yield { type: "token", content: chunk.text };
          }
        } else {
          yield* toolEvents(payload);
        }
      }
      await extractAfterRun(threadId);
      yield { type: "done" };
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function run(threadId: string, message: string): Promise<string> {
    const result = await graph.invoke(
      { messages: [new HumanMessage(message)] },
      threadConfig(threadId),
    );
    return (result.messages.at(-1) as BaseMessage | undefined)?.text ?? "";
  }

  async function history(threadId: string): Promise<ThreadMessage[]> {
    const state = await graph.getState(threadConfig(threadId));
    const messages = (state.values.messages ?? []) as BaseMessage[];
    return messages.map(toThreadMessage);
  }

  async function fireTrigger(trigger: Trigger): Promise<void> {
    const threadId = `${PROACTIVE_PREFIX}${trigger.id}:${Date.now()}`;
    const content = await run(
      threadId,
      `Scheduled task #${trigger.id} is due now. Your reply is delivered to the user as a notification, so write it directly to them. Task: ${trigger.prompt}`,
    );
    const notification = insertNotification(db, {
      triggerId: trigger.id,
      threadId,
      content,
    });
    bus.emit("suggestion", { type: "suggestion", ...notification });
    void memory.resumePending();
  }

  async function pruneProactiveThreads(now = new Date()): Promise<void> {
    const cutoff = now.getTime() - PROACTIVE_RETENTION_MS;
    const expired = listThreadIds(db, PROACTIVE_PREFIX).filter(
      (threadId) => proactiveThreadTime(threadId) < cutoff,
    );
    for (const threadId of expired) await checkpointer.deleteThread(threadId);
    deleteDeliveredNotifications(db, new Date(cutoff));
  }

  const retentionJob = new Cron(
    RETENTION_SCHEDULE,
    { protect: true, unref: true },
    () =>
      pruneProactiveThreads().catch((error: unknown) =>
        console.error("Retention sweep failed", error),
      ),
  );

  scheduler.reload();
  await pruneProactiveThreads();

  return {
    bus,
    memory,
    chat,
    run,
    history,
    graph: () => graph,
    checkpointer,
    extractAfterRun,
    threadIds: () =>
      listThreadIds(db, "").filter(
        (threadId) => !threadId.startsWith(PROACTIVE_PREFIX),
      ),
    modules: {
      statuses: moduleStatuses,
      register: async (module: ModuleRegistration) => {
        saveModule(db, module);
        return reloadModules();
      },
      unregister: async (name: string) => {
        const removed = deleteModule(db, name);
        if (removed) await reloadModules();
        return removed;
      },
      isManaged: (name: string) =>
        installer
          .installations()
          .some((installation) => installation.name === name),
      install: installer.install,
      update: installer.update,
      configure: installer.configure,
      uninstall: installer.uninstall,
      logs: installer.logs,
      readme: async (name: string) => {
        const status = moduleStatuses().find((module) => module.name === name);
        if (!status) return undefined;
        if (status.url && status.available) {
          const readme = await fetchModuleReadme(
            status.url.replace(/\/mcp$/, "/readme"),
            moduleHeaders(name),
          );
          if (readme !== undefined) return readme;
        }
        const fromCatalog = await catalog.find(name).catch(() => undefined);
        return fromCatalog ? catalog.readme(fromCatalog) : undefined;
      },
      whenIdle: installer.whenIdle,
    },
    catalog: {
      search: async (query: { q?: string; tag?: string }) => {
        const installed = new Map(
          installer
            .installations()
            .map((installation) => [
              installation.name,
              installation.manifest.version,
            ]),
        );
        return (await catalog.search(query)).map((module): CatalogEntry => ({
          manifest: module.latest.manifest,
          versions: module.versions.map((version) => version.version),
          ...(installed.has(module.id) && {
            installedVersion: installed.get(module.id),
          }),
        }));
      },
      get: async (id: string) => {
        const module = (await catalog.modules()).find(
          (candidate) => candidate.id === id,
        );
        if (!module) return undefined;
        const installation = installer
          .installations()
          .find((candidate) => candidate.name === id);
        return {
          manifest: module.latest.manifest,
          versions: module.versions.map((version) => version.version),
          ...(installation && {
            installedVersion: installation.manifest.version,
          }),
          readme: await catalog.readme(module.latest),
        };
      },
      refresh: catalog.refresh,
    },
    memories: {
      list: () => listMemories(db),
      delete: (id: number) => deleteMemory(db, id),
    },
    triggers,
    notifications: {
      pending: (client?: string): SuggestionEvent[] =>
        (client
          ? listNotificationsAfter(db, notificationCursor(db, client))
          : listUndeliveredNotifications(db)
        ).map((notification) => ({ type: "suggestion", ...notification })),
      acknowledge: (id: number, client?: string) => {
        markNotificationDelivered(db, id);
        if (client) advanceNotificationCursor(db, client, id);
      },
    },
    pruneProactiveThreads,
    reconcileModules: installer.reconcile,
    close: async () => {
      clearInterval(reconnectTimer);
      retentionJob.stop();
      scheduler.stop();
      await modules.close();
    },
  };
}
