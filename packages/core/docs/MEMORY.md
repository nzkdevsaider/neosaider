---
title: Long-term memory
description: How Neo extracts, consolidates, stores and recalls memories about the user with embeddings and sqlite-vec.
---

# Long-term memory

The memory manager lives in `src/memory.ts` (`createMemoryManager(db, models)`). Storage is in `@neosaider/storage` (`memories`, `memory_vectors`, `pending_extractions`); see [DATA-MODEL.md](../../storage/docs/DATA-MODEL.md).

## Kinds

| Kind      | Meaning                                                               | How it reaches the prompt                  |
| --------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `profile` | Who the user is and how to treat them: name, address, language, tone. | Always, in full.                           |
| `fact`    | Everything else: preferences, routines, goals, people, projects.      | Only the most similar to the user message. |

Memories are short third-person sentences in English ("The user ...").

## Recall before answering

The graph's `recall` node calls `recallContext(lastUserMessage)` before every `agent` call:

1. Embed the user message.
2. Search `memory_vectors` (cosine distance) for `5 + <number of profile memories>` neighbours, keep only `fact` ones, take the first 5.
3. Build the context: a "What you know about the user" section with every `profile` memory and a "Memories that may be relevant to this message" section with the facts. Empty sections are omitted.

The `recall` tool runs the same fact search for an arbitrary query.

## Extraction queue

After every chat run (`chat` or `extractAfterRun` from the Agent Streaming Protocol) Neo takes the last exchange (from the last human message on, keeping human messages and assistant messages with text) and:

1. Writes the transcript to `pending_extractions` (`addPendingExtraction`). When a module tool ran in that turn, the transcript starts with a marker line and every memory extracted from it is stored as `fact`, never `profile`, so module output cannot reach the always-injected profile section.
2. Asks the `fast` model, with structured output, for a list of `{ content, kind }` memories (the list may be empty).
3. Consolidates each memory (below).
4. Deletes the pending row on success. On failure it increments `attempts` and logs the error.

All extraction and `remember` work runs through one promise queue (`serialized`), so consolidations never race. `whenIdle()` resolves when the queue is empty; the harness awaits it on shutdown.

## Consolidation

For each candidate memory:

1. Embed it and search the 5 nearest memories; keep those with cosine distance below `0.3`.
2. If one of them has the same normalised text (lowercase, punctuation collapsed), it is `unchanged`.
3. If none are related, insert it (`added`).
4. Otherwise ask the `fast` model to decide `add`, `update` (with the target id and rewritten content) or `none`. An unknown id falls back to the closest memory. `update` rewrites content, kind and embedding; if the row no longer exists the memory is added instead.

The `remember` tool uses the same path with kind `fact` by default.

## Retry semantics

- `listPendingExtractions` only returns rows with fewer than 3 attempts, so a transcript is tried at most three times and then left in the table.
- Pending extractions are resumed by `resumePending()`, which Neo calls after each successful chat run and after each trigger run. Nothing is retried at startup: a restart with the LLM down does not burn attempts; the first successful run proves the model is reachable.
- Rows already in flight are skipped, so a resume never processes a transcript twice concurrently.

## Embeddings and sqlite-vec

- `memory_vectors` is a `vec0` virtual table created lazily on the first insert, with the dimensions of that first embedding and `distance_metric=cosine`. Its `rowid` is the memory id.
- If a later embedding has a different number of dimensions, storage throws: changing the embedding model requires re-embedding memories.
- Deleting a memory deletes its vector in the same transaction.

## Running without an embed model

When `models.embeddings` is undefined (for example `NEO_EMBED_MODEL=` empty in the harness):

- `createMemoryManager` returns a disabled manager: no tools, empty recall context, extraction and resume are no-ops.
- The system prompt tells Neo that memory is disabled and to explain it if the user asks to remember something.
- Chat works normally.
