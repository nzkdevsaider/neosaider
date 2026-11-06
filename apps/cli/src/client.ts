import type {
  ChatStreamEvent,
  Memory,
  ModuleRegistration,
  ModuleStatus,
  SuggestionEvent,
  ThreadMessage,
  Trigger,
  TriggerDefinition,
} from "@neosaider/contracts";
import { parseServerSentEvents } from "./sse.js";

export class ApiError extends Error {}

const TERMINAL_CONTROL_CHARACTER = /[^\P{Cc}\n\t]/gu;

const neutralizeControlCharacters = (text: string) =>
  text.replace(
    TERMINAL_CONTROL_CHARACTER,
    (character) =>
      `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );

const parseNeutralizedJson = (text: string): unknown =>
  JSON.parse(text, (_key, value: unknown) =>
    typeof value === "string" ? neutralizeControlCharacters(value) : value,
  );

export type NeosaiderClient = ReturnType<typeof createClient>;

export function createClient(baseUrl: string, token: string) {
  const root = baseUrl.replace(/\/$/, "");

  async function send(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(`${root}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...(signal && { signal }),
    });
    if (!response.ok) {
      const detail = neutralizeControlCharacters(await response.text());
      throw new ApiError(`${method} ${path} → ${detail || response.status}`);
    }
    return response;
  }

  const json = async <T>(method: string, path: string, body?: unknown) =>
    parseNeutralizedJson(await (await send(method, path, body)).text()) as T;

  async function* events<T>(response: Response): AsyncGenerator<T> {
    if (!response.body) return;
    const chunks = response.body.pipeThrough(new TextDecoderStream());
    for await (const { data } of parseServerSentEvents(chunks)) {
      if (data) yield parseNeutralizedJson(data) as T;
    }
  }

  return {
    health: async () =>
      (await fetch(`${root}/health`)).json() as Promise<{
        ok: boolean;
        llm: boolean;
      }>,
    chat: async function* (threadId: string, message: string) {
      const response = await send(
        "POST",
        `/threads/${encodeURIComponent(threadId)}/messages`,
        { message },
      );
      yield* events<ChatStreamEvent>(response);
    },
    suggestions: async function* (signal: AbortSignal, clientName: string) {
      yield* events<SuggestionEvent | { type: "ping" }>(
        await send(
          "GET",
          `/events?client=${encodeURIComponent(clientName)}`,
          undefined,
          signal,
        ),
      );
    },
    history: (threadId: string) =>
      json<ThreadMessage[]>("GET", `/threads/${encodeURIComponent(threadId)}`),
    modules: () => json<ModuleStatus[]>("GET", "/modules"),
    addModule: (module: ModuleRegistration) =>
      json<ModuleStatus>("POST", "/modules", module),
    removeModule: (name: string) =>
      send("DELETE", `/modules/${encodeURIComponent(name)}?keepData=true`),
    triggers: () => json<Trigger[]>("GET", "/triggers"),
    addTrigger: (definition: TriggerDefinition) =>
      json<Trigger>("POST", "/triggers", definition),
    removeTrigger: (id: string) =>
      send("DELETE", `/triggers/${encodeURIComponent(id)}`),
    memories: () => json<Memory[]>("GET", "/memories"),
    removeMemory: (id: string) =>
      send("DELETE", `/memories/${encodeURIComponent(id)}`),
  };
}
