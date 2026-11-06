import {
  type BaseMessage,
  SystemMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
  memoryKindSchema,
  type Memory,
  type MemoryKind,
} from "@neosaider/contracts";
import {
  addPendingExtraction,
  countExtractionAttempt,
  deletePendingExtraction,
  insertMemory,
  listMemories,
  listPendingExtractions,
  searchMemories,
  updateMemory,
  type Db,
  type MemoryInput,
  type MemoryMatch,
  type PendingExtraction,
} from "@neosaider/storage";
import { z } from "zod";
import type { NeoModels } from "./models.js";

const RELATED_DISTANCE = 0.3;
const RELATED_LIMIT = 5;
const RECALL_LIMIT = 5;

const KIND_GUIDE = `"profile" is who the user is and how to treat them: name or nickname, how to address them, language, tone, pronouns.
"fact" is everything else worth keeping: preferences, likes and dislikes, routines, goals, people, ongoing projects.`;

const EXTRACTION_PROMPT = `You extract durable memories about the user from the latest exchange of a conversation.
Keep only what will still matter in future conversations. Ignore small talk, one-off requests and anything the assistant said about itself.
Write each memory as a short standalone sentence in the third person ("The user ..."), in English.
Classify each one:
${KIND_GUIDE}
Return an empty list when there is nothing durable.`;

const CONSOLIDATION_PROMPT = `You maintain the long-term memory of a personal assistant.
You receive one new memory about the user and the existing memories most similar to it.
Decide what to do:
- "none" when an existing memory already says the same thing.
- "update" when the new memory refines, corrects or contradicts an existing one. The new information wins. Give the id of that memory and its rewritten content.
- "add" when it is genuinely new information.
Content is a short standalone sentence in the third person, in English.`;

const extractionSchema = z.object({
  memories: z.array(
    z.object({
      content: z.string(),
      kind: memoryKindSchema,
    }),
  ),
});

const consolidationSchema = z.object({
  action: z.enum(["add", "update", "none"]),
  memoryId: z.number().int().nullable(),
  content: z.string().nullable(),
});

export type MemoryChange = {
  action: "added" | "updated" | "unchanged";
  memory: Memory;
};

const MODULE_OUTPUT_MARKER =
  "[A module tool ran during this exchange; nothing from it is profile information.]\n";

const normalizeText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const toTranscript = (exchange: BaseMessage[]) =>
  exchange
    .map(
      (message) =>
        `${message.type === "human" ? "User" : "Assistant"}: ${message.text}`,
    )
    .join("\n");

const formatList = (memories: Memory[]) =>
  memories.map((memory) => `- ${memory.content}`).join("\n");

function formatRecalled(profile: Memory[], facts: Memory[]): string {
  const sections = [];
  if (profile.length) {
    sections.push(
      `What you know about the user (always applies; address them accordingly):\n${formatList(profile)}`,
    );
  }
  if (facts.length) {
    sections.push(
      `Memories that may be relevant to this message:\n${formatList(facts)}`,
    );
  }
  return sections.join("\n\n");
}

const disabledMemoryManager = {
  remember: async (): Promise<MemoryChange | undefined> => undefined,
  recallContext: async (): Promise<string> => "",
  enqueueExtraction: async (): Promise<void> => undefined,
  resumePending: async (): Promise<void> => undefined,
  whenIdle: async (): Promise<void> => undefined,
  tools: [] as StructuredToolInterface[],
};

export type MemoryManager = ReturnType<typeof createMemoryManager>;

export function createMemoryManager(db: Db, models: NeoModels) {
  if (!models.embeddings) return disabledMemoryManager;
  const embeddings = models.embeddings;

  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  async function decide(candidate: MemoryInput, related: MemoryMatch[]) {
    const existing = related
      .map((memory) => `#${memory.id} [${memory.kind}] ${memory.content}`)
      .join("\n");
    return models.fast
      .withStructuredOutput(consolidationSchema)
      .invoke([
        new SystemMessage(CONSOLIDATION_PROMPT),
        new HumanMessage(
          `New memory [${candidate.kind}]: ${candidate.content}\n\nExisting memories:\n${existing}`,
        ),
      ]);
  }

  async function consolidate(candidate: MemoryInput): Promise<MemoryChange> {
    const embedding = await embeddings.embedQuery(candidate.content);
    const related = searchMemories(db, embedding, RELATED_LIMIT).filter(
      (memory) => memory.distance < RELATED_DISTANCE,
    );
    const sameText = related.find(
      (memory) =>
        normalizeText(memory.content) === normalizeText(candidate.content),
    );
    if (sameText) return { action: "unchanged", memory: sameText };
    const [closest] = related;
    if (!closest) {
      return {
        action: "added",
        memory: insertMemory(db, candidate, embedding),
      };
    }

    const decision = await decide(candidate, related);
    const target =
      related.find((memory) => memory.id === decision.memoryId) ?? closest;
    if (decision.action === "none") {
      return { action: "unchanged", memory: target };
    }
    if (decision.action === "update") {
      const content = decision.content?.trim() || candidate.content;
      const updated = updateMemory(
        db,
        target.id,
        { kind: candidate.kind, content },
        await embeddings.embedQuery(content),
      );
      if (updated) return { action: "updated", memory: updated };
    }
    return { action: "added", memory: insertMemory(db, candidate, embedding) };
  }

  const remember = (content: string, kind: MemoryKind = "fact") =>
    serialized(() => consolidate({ kind, content: content.trim() }));

  async function recall(
    query: string,
    limit = RECALL_LIMIT,
  ): Promise<Memory[]> {
    const embedding = await embeddings.embedQuery(query);
    const profileCount = listMemories(db, "profile").length;
    return searchMemories(db, embedding, limit + profileCount)
      .filter((memory) => memory.kind === "fact")
      .slice(0, limit);
  }

  async function recallContext(query: string): Promise<string> {
    return formatRecalled(listMemories(db, "profile"), await recall(query));
  }

  async function extractMemories(transcript: string): Promise<void> {
    const fromModuleOutput = transcript.startsWith(MODULE_OUTPUT_MARKER);
    const { memories } = await models.fast
      .withStructuredOutput(extractionSchema)
      .invoke([
        new SystemMessage(EXTRACTION_PROMPT),
        new HumanMessage(transcript),
      ]);
    for (const memory of memories) {
      if (memory.content.trim()) {
        await consolidate({
          kind: fromModuleOutput ? "fact" : memory.kind,
          content: memory.content.trim(),
        });
      }
    }
  }

  const inFlight = new Set<number>();

  function processPending({ id, transcript }: PendingExtraction) {
    inFlight.add(id);
    return serialized(() => extractMemories(transcript))
      .then(
        () => deletePendingExtraction(db, id),
        (error: unknown) => {
          countExtractionAttempt(db, id);
          console.error("Memory extraction failed", error);
        },
      )
      .finally(() => inFlight.delete(id));
  }

  function enqueueExtraction(
    exchange: BaseMessage[],
    { fromModuleOutput = false } = {},
  ): Promise<void> {
    const transcript = `${fromModuleOutput ? MODULE_OUTPUT_MARKER : ""}${toTranscript(exchange)}`;
    return processPending({
      id: addPendingExtraction(db, transcript),
      transcript,
    });
  }

  async function resumePending(): Promise<void> {
    await Promise.all(
      listPendingExtractions(db)
        .filter((pending) => !inFlight.has(pending.id))
        .map(processPending),
    );
  }

  const tools = [
    tool(
      async ({ content, kind }) => {
        const change = await remember(content, kind);
        return change.action === "unchanged"
          ? `Already known: ${change.memory.content}`
          : `Memory ${change.action}: ${change.memory.content}`;
      },
      {
        name: "remember",
        description:
          "Save something about the user for future conversations. Duplicates are ignored and outdated memories are updated.",
        schema: z.object({
          content: z
            .string()
            .describe(
              'Standalone sentence in English, in the third person, e.g. "The user likes yellow"',
            ),
          kind: memoryKindSchema.describe(KIND_GUIDE),
        }),
      },
    ),
    tool(
      async ({ query }) => {
        const memories = await recall(query);
        return memories.length
          ? formatList(memories)
          : "Nothing remembered about that.";
      },
      {
        name: "recall",
        description:
          "Search older memories about the user that are not already in your instructions.",
        schema: z.object({ query: z.string() }),
      },
    ),
  ];

  return {
    remember,
    recallContext,
    enqueueExtraction,
    resumePending,
    whenIdle: () => queue.then(() => undefined),
    tools,
  };
}
