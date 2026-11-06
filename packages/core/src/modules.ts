import { ToolMessage } from "@langchain/core/messages";
import type {
  DynamicStructuredTool,
  StructuredToolInterface,
} from "@langchain/core/tools";
import { loadMcpTools } from "@langchain/mcp-adapters";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { ModuleRegistration, ModuleStatus } from "@neosaider/contracts";
import { listModules, type Db } from "@neosaider/storage";

export const MAX_TOOL_DESCRIPTION_LENGTH = 1024;
export const MAX_MODULE_ERROR_LENGTH = 300;
export const MAX_README_BYTES = 256 * 1024;
export const MAX_MCP_RESPONSE_BYTES = 2 * 1024 * 1024;

export type ModuleHeaders = (moduleName: string) => Record<string, string>;

const truncate = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

function limitBody(body: ReadableStream<Uint8Array>, maxBytes: number) {
  let size = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          controller.error(
            new Error(`module response exceeds ${maxBytes} bytes`),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export function sizeLimitedFetch(maxBytes: number): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new Error(`module response exceeds ${maxBytes} bytes`);
    }
    if (!response.body) return response;
    return new Response(limitBody(response.body, maxBytes), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

const withoutArtifact = (content: unknown) =>
  ToolMessage.isInstance(content)
    ? new ToolMessage({
        content: content.content,
        status: content.status,
        tool_call_id: content.tool_call_id,
        name: content.name,
      })
    : content;

export function toModuleTool(
  mcpTool: DynamicStructuredTool,
): DynamicStructuredTool {
  const callModule = mcpTool.func;
  mcpTool.description = truncate(
    mcpTool.description,
    MAX_TOOL_DESCRIPTION_LENGTH,
  );
  mcpTool.func = async (...args) => {
    const [content] = (await callModule(...args)) as [unknown, unknown];
    return [withoutArtifact(content), undefined];
  };
  return mcpTool;
}

export function usableModuleTools(
  tools: StructuredToolInterface[],
  reservedNames: ReadonlySet<string>,
): StructuredToolInterface[] {
  const nameCounts = new Map<string, number>();
  for (const { name } of tools) {
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  return tools.filter(
    ({ name }) => !reservedNames.has(name) && nameCounts.get(name) === 1,
  );
}

export async function fetchModuleReadme(
  url: string,
  headers: Record<string, string> = {},
): Promise<string | undefined> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
  if (!response?.ok || !response.body) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_README_BYTES) return undefined;
      chunks.push(chunk);
    }
  } catch {
    return undefined;
  }
  return Buffer.concat(chunks).toString("utf8");
}

type LoadedModule = {
  registration: ModuleRegistration;
  status: ModuleStatus;
  tools: StructuredToolInterface[];
  client: Client;
};

async function loadModule(
  module: ModuleRegistration,
  headers: Record<string, string>,
): Promise<LoadedModule> {
  const client = new Client({ name: "neosaider", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(module.url), {
        fetch: sizeLimitedFetch(MAX_MCP_RESPONSE_BYTES),
        requestInit: { headers },
      }),
    );
    const tools = (
      await loadMcpTools(module.name, client, {
        prefixToolNameWithServerName: true,
      })
    ).map(toModuleTool);
    return {
      registration: module,
      status: { name: module.name, url: module.url, available: true },
      tools,
      client,
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    return {
      registration: module,
      status: {
        name: module.name,
        url: module.url,
        available: false,
        error: truncate(
          error instanceof Error ? error.message : String(error),
          MAX_MODULE_ERROR_LENGTH,
        ),
      },
      tools: [],
      client,
    };
  }
}

export type ModuleManager = ReturnType<typeof createModuleManager>;

export function createModuleManager(
  db: Db,
  reservedToolNames: ReadonlySet<string> = new Set(),
  headersFor: ModuleHeaders = () => ({}),
) {
  const load = (module: ModuleRegistration) =>
    loadModule(module, headersFor(module.name));

  let loaded: LoadedModule[] = [];

  const usableTools = () =>
    new Set(
      usableModuleTools(
        loaded.flatMap((module) => module.tools),
        reservedToolNames,
      ),
    );

  async function close(): Promise<void> {
    await Promise.all(
      loaded.map(({ client }) => client.close().catch(() => undefined)),
    );
  }

  async function reload(): Promise<void> {
    await close();
    loaded = await Promise.all(listModules(db).map(load));
  }

  async function reconnectUnavailable(): Promise<boolean> {
    const unavailable = loaded.filter((module) => !module.status.available);
    if (!unavailable.length) return false;
    const retried = await Promise.all(
      unavailable.map((module) => load(module.registration)),
    );
    const recovered = retried.filter((module) => module.status.available);
    if (!recovered.length) return false;
    loaded = loaded.map(
      (module) =>
        recovered.find(
          (candidate) => candidate.status.name === module.status.name,
        ) ?? module,
    );
    return true;
  }

  return {
    reload,
    reconnectUnavailable,
    close,
    tools: () => [...usableTools()],
    statuses: (): ModuleStatus[] =>
      loaded.map(({ status, tools }) => ({
        ...status,
        tools: tools.map(({ name, description }) => ({ name, description })),
      })),
    catalog: () => {
      const usable = usableTools();
      return loaded.map(({ status, tools }) => ({
        status,
        tools: tools
          .filter((tool) => usable.has(tool))
          .map(({ name, description }) => ({ name, description })),
      }));
    },
  };
}
