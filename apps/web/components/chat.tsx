"use client";

import { HttpAgentServerAdapter, useStream } from "@langchain/react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ThreadSummary = { id: string; title: string; updatedAt: string | null };

type ChatMessage = {
  id?: string;
  type: string;
  content: unknown;
  tool_calls?: { name: string; args: unknown }[];
};

const AGENT_PATH = "/api/harness/agent";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string }) =>
      block.type === "text" ? (block.text ?? "") : "",
    )
    .join("");
}

function Message({ message }: { message: ChatMessage }) {
  const text = textOf(message.content).trim();
  if (message.type === "tool") {
    return (
      <p className="font-mono text-xs text-soft">
        ↳ resultado de tool · {text.slice(0, 160)}
      </p>
    );
  }
  const isUser = message.type === "human";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser ? "bg-ink text-paper" : "border border-rule bg-card text-ink"
        }`}
      >
        {message.tool_calls?.map((call, index) => (
          <p key={index} className="font-mono text-xs text-soft">
            → {call.name}
          </p>
        ))}
        {text}
      </div>
    </div>
  );
}

export function Chat() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [selection, setSelection] = useState(0);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [draft, setDraft] = useState("");

  const refreshThreads = useCallback(async () => {
    const response = await fetch(`${AGENT_PATH}/threads`);
    if (response.ok) setThreads((await response.json()) as ThreadSummary[]);
  }, []);

  const transport = useMemo(
    () =>
      new HttpAgentServerAdapter({
        apiUrl: window.location.origin,
        paths: {
          commands: (id) => `${AGENT_PATH}/threads/${id}/commands`,
          stream: (id) => `${AGENT_PATH}/threads/${id}/stream/events`,
          state: (id) => `${AGENT_PATH}/threads/${id}/state`,
        },
      }),
    [selection],
  );

  function openThread(id: string | null) {
    setThreadId(id);
    setSelection((current) => current + 1);
  }

  const stream = useStream({
    transport,
    threadId,
    onThreadId: setThreadId,
  });
  const messages = stream.messages as unknown as ChatMessage[];

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads, stream.isLoading]);

  function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || stream.isLoading) return;
    setDraft("");
    void stream.submit({ messages: [{ type: "human", content: text }] });
  }

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside aria-label="Conversaciones" className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => openThread(null)}
          className="rounded-md border border-rule bg-card px-3 py-2 text-left text-sm font-medium hover:border-accent"
        >
          + Nueva conversación
        </button>
        <ul className="flex flex-col gap-1">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => openThread(thread.id)}
                aria-current={thread.id === threadId ? "true" : undefined}
                className={`w-full truncate rounded px-3 py-1.5 text-left text-sm ${
                  thread.id === threadId
                    ? "bg-accent-tint text-accent"
                    : "text-muted hover:text-ink"
                }`}
              >
                {thread.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section aria-label="Chat con Neo" className="flex min-h-[70vh] flex-col">
        <div className="flex flex-1 flex-col gap-3 pb-4" aria-live="polite">
          {messages.length === 0 && (
            <p className="mt-16 text-center font-serif text-2xl text-soft italic">
              ¿En qué te ayudo hoy?
            </p>
          )}
          {messages.map((message, index) => (
            <Message key={message.id ?? index} message={message} />
          ))}
          {stream.error ? (
            <p role="alert" className="text-sm text-danger">
              {String(stream.error)}
            </p>
          ) : null}
        </div>
        <form onSubmit={send} className="sticky bottom-4 flex gap-2">
          <label htmlFor="message" className="sr-only">
            Mensaje para Neo
          </label>
          <input
            id="message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Escribe a Neo…"
            autoComplete="off"
            className="flex-1 rounded-md border border-rule bg-card px-4 py-3 text-sm"
          />
          <button
            type="submit"
            disabled={stream.isLoading || !draft.trim()}
            className="rounded-md bg-accent px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {stream.isLoading ? "…" : "Enviar"}
          </button>
        </form>
      </section>
    </div>
  );
}
