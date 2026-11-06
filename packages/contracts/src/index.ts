import { z } from "zod";

export * from "./modules.js";

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const triggerEventSchema = z.enum(["session.start"]);
export type TriggerEvent = z.infer<typeof triggerEventSchema>;

export const triggerDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cron"),
    schedule: z.string().min(1),
    prompt: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("event"),
    event: triggerEventSchema,
    prompt: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("once"),
    at: z.iso.datetime({ offset: true }),
    prompt: z.string().trim().min(1),
  }),
]);
export type TriggerDefinition = z.infer<typeof triggerDefinitionSchema>;

export type Trigger = TriggerDefinition & { id: number; createdAt: string };

export const memoryKindSchema = z.enum(["profile", "fact"]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export type Memory = {
  id: number;
  kind: MemoryKind;
  content: string;
  createdAt: string;
};

export type ThreadMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: { name: string; args: unknown }[];
};

export type ChatStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; id?: string; name: string; args: unknown }
  | { type: "tool_result"; id?: string; name: string; content: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type SuggestionEvent = {
  type: "suggestion";
  id: number;
  triggerId: number;
  threadId: string;
  content: string;
};

export const protocolCommandSchema = z.object({
  id: z.union([z.number(), z.string()]),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type ProtocolCommand = z.infer<typeof protocolCommandSchema>;

export const protocolSubscriptionSchema = z.looseObject({
  channels: z.array(z.string()).min(1),
});

export const threadStateUpdateSchema = z.object({
  values: z.record(z.string(), z.unknown()).nullish(),
  as_node: z.string().optional(),
});

export const threadHistoryRequestSchema = z.object({
  limit: z.number().int().positive().max(100).default(10),
  before: z
    .union([z.string(), z.looseObject({ checkpoint_id: z.string() })])
    .transform((before) =>
      typeof before === "string" ? before : before.checkpoint_id,
    )
    .nullish(),
});

export const eventsQuerySchema = z.object({
  client: z
    .string()
    .regex(/^[\w.-]{1,64}$/, "letters, digits, '.', '-' or '_'")
    .optional(),
});
