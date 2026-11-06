"use client";

import type { SuggestionEvent } from "@neosaider/contracts";
import { useEffect, useState } from "react";

const VISIBLE_MS = 15_000;

export function Notifications() {
  const [items, setItems] = useState<SuggestionEvent[]>([]);

  useEffect(() => {
    const source = new EventSource("/api/harness/events?client=web");
    const onSuggestion = (event: MessageEvent<string>) => {
      const suggestion = JSON.parse(event.data) as SuggestionEvent;
      setItems((current) => [...current, suggestion]);
      setTimeout(
        () =>
          setItems((current) =>
            current.filter((item) => item.id !== suggestion.id),
          ),
        VISIBLE_MS,
      );
    };
    source.addEventListener("suggestion", onSuggestion);
    return () => source.close();
  }, []);

  if (!items.length) return null;
  return (
    <section
      aria-label="Notificaciones"
      aria-live="polite"
      className="fixed right-4 bottom-4 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-md border border-rule bg-card p-3 text-sm shadow-lg"
        >
          <p className="mb-1 font-mono text-[0.65rem] tracking-widest text-soft uppercase">
            Neo · aviso
          </p>
          <p className="text-ink">{item.content}</p>
          <button
            type="button"
            onClick={() =>
              setItems((current) => current.filter(({ id }) => id !== item.id))
            }
            className="mt-2 text-xs text-link hover:underline"
          >
            Cerrar
          </button>
        </div>
      ))}
    </section>
  );
}
