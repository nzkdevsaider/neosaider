import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

export type NeoModels = {
  chat: BaseChatModel;
  fast: BaseChatModel;
  embeddings?: EmbeddingsInterface;
};

export type LlmSettings = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  fastModel: string;
  embedModel?: string;
};

const LOCAL_MAX_RETRIES = 1;

export function createModels(settings: LlmSettings): NeoModels {
  const connection = {
    apiKey: settings.apiKey,
    configuration: { baseURL: settings.baseUrl },
    maxRetries: LOCAL_MAX_RETRIES,
  };
  return {
    chat: new ChatOpenAI({ ...connection, model: settings.chatModel }),
    fast: new ChatOpenAI({
      ...connection,
      model: settings.fastModel,
      temperature: 0,
    }),
    ...(settings.embedModel && {
      embeddings: new OpenAIEmbeddings({
        ...connection,
        model: settings.embedModel,
      }),
    }),
  };
}

export async function isLlmReachable(
  settings: Pick<LlmSettings, "baseUrl" | "apiKey">,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${settings.baseUrl.replace(/\/$/, "")}/models`,
      {
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        signal: AbortSignal.timeout(2000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
