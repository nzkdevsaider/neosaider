import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
  END,
  getCurrentTaskInput,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

const NeoState = new StateSchema({
  messages: MessagesValue,
  memoryContext: z.string().default(""),
});

const TOOLS_REFUSED_AFTER_MODULE_OUTPUT = new Set([
  "schedule_task",
  "cancel_scheduled_task",
  "remember",
]);

export const MODULE_OUTPUT_REFUSAL =
  "Refused: a module tool already ran in this turn, so its output may be steering this action. Ask the user to request it again in a new message.";

export function moduleToolRanThisTurn(
  messages: BaseMessage[],
  builtInToolNames: ReadonlySet<string>,
): boolean {
  const turnStart = messages.findLastIndex(HumanMessage.isInstance);
  return messages
    .slice(turnStart + 1)
    .some(
      (message) =>
        ToolMessage.isInstance(message) &&
        !builtInToolNames.has(message.name ?? ""),
    );
}

function refuseAfterModuleOutput(
  builtInTool: StructuredToolInterface,
  builtInToolNames: ReadonlySet<string>,
): StructuredToolInterface {
  return tool(
    async (input, config) => {
      const { messages } = getCurrentTaskInput<{ messages: BaseMessage[] }>(
        config,
      );
      return moduleToolRanThisTurn(messages, builtInToolNames)
        ? MODULE_OUTPUT_REFUSAL
        : builtInTool.invoke(input, config);
    },
    {
      name: builtInTool.name,
      description: builtInTool.description,
      schema: builtInTool.schema,
    },
  );
}

type NeoGraphOptions = {
  model: BaseChatModel;
  builtInTools: StructuredToolInterface[];
  moduleTools: StructuredToolInterface[];
  checkpointer: BaseCheckpointSaver;
  recall: (query: string) => Promise<string>;
  instructions: () => string;
};

const systemPrompt = (instructions: string, memoryContext: string) =>
  memoryContext ? `${instructions}\n\n${memoryContext}` : instructions;

export function buildNeoGraph({
  model,
  builtInTools,
  moduleTools,
  checkpointer,
  recall,
  instructions,
}: NeoGraphOptions) {
  const builtInToolNames = new Set(builtInTools.map(({ name }) => name));
  const tools = [
    ...builtInTools.map((builtInTool) =>
      TOOLS_REFUSED_AFTER_MODULE_OUTPUT.has(builtInTool.name)
        ? refuseAfterModuleOutput(builtInTool, builtInToolNames)
        : builtInTool,
    ),
    ...moduleTools,
  ];
  const modelWithTools =
    tools.length && model.bindTools ? model.bindTools(tools) : model;

  const recallMemories = async (state: typeof NeoState.State) => {
    const lastUserMessage = state.messages.findLast(HumanMessage.isInstance);
    return {
      memoryContext: lastUserMessage ? await recall(lastUserMessage.text) : "",
    };
  };

  const callModel = async (state: typeof NeoState.State) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(systemPrompt(instructions(), state.memoryContext)),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  return new StateGraph(NeoState)
    .addNode("recall", recallMemories)
    .addNode("agent", callModel)
    .addNode("tools", new ToolNode(tools, { handleToolErrors: true }))
    .addEdge(START, "recall")
    .addEdge("recall", "agent")
    .addConditionalEdges("agent", toolsCondition, ["tools", END])
    .addEdge("tools", "agent")
    .compile({ checkpointer });
}

export type NeoGraph = ReturnType<typeof buildNeoGraph>;
