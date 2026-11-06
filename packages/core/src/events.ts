import { EventEmitter } from "node:events";
import type { SuggestionEvent } from "@neosaider/contracts";

type NeoEvents = {
  "session.start": [];
  suggestion: [SuggestionEvent];
};

export const createEventBus = () => new EventEmitter<NeoEvents>();

export type EventBus = ReturnType<typeof createEventBus>;
