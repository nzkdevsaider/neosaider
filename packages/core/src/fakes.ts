import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import {
  BaseChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

const DIMENSIONS = 16;

export class ScriptedChatModel extends BaseChatModel {
  private turn = 0;
  readonly prompts: BaseMessage[][] = [];

  constructor(
    private readonly script: (AIMessage | AIMessageChunk)[],
    params: BaseChatModelParams = {},
  ) {
    super(params);
  }

  _llmType() {
    return "scripted";
  }

  override bindTools() {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.prompts.push(messages);
    const message = this.script[Math.min(this.turn++, this.script.length - 1)]!;
    return { generations: [{ message, text: message.text }] };
  }
}

export const structuredReply = (args: Record<string, unknown>) =>
  new AIMessageChunk({
    content: "",
    tool_calls: [{ id: "structured", name: "extract", args }],
  });

export const axis = (index: number, weight = 1) => {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[index] = weight;
  return vector;
};

function bagOfWords(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/\w+/g) ?? []) {
    const bucket =
      [...word].reduce((sum, char) => sum + char.charCodeAt(0), 0) % DIMENSIONS;
    vector[bucket]! += 1;
  }
  return vector;
}

export function fakeEmbeddings(
  known: Record<string, number[]> = {},
): EmbeddingsInterface {
  const embed = (text: string) => known[text] ?? bagOfWords(text);
  return {
    embedQuery: async (text) => embed(text),
    embedDocuments: async (texts) => texts.map(embed),
  };
}
