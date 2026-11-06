import type { CatalogEntry } from "@neosaider/contracts";
import Link from "next/link";

export function ModuleCard({ entry }: { entry: CatalogEntry }) {
  const { manifest, installedVersion } = entry;
  return (
    <Link
      href={`/store/${manifest.id}`}
      className="flex h-full flex-col gap-3 rounded-lg border border-rule bg-card p-5 hover:border-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-2xl">
            {manifest.icon ?? "🧩"}
          </span>
          <div>
            <h2 className="font-semibold text-ink">{manifest.name}</h2>
            <p className="font-mono text-xs text-soft">v{manifest.version}</p>
          </div>
        </div>
        {installedVersion && (
          <span className="rounded bg-accent-tint px-2 py-0.5 text-xs text-accent">
            Instalado
          </span>
        )}
      </div>
      <p className="text-sm text-muted">{manifest.description}</p>
      {manifest.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Etiquetas">
          {manifest.tags.map((tag) => (
            <li
              key={tag}
              className="rounded border border-rule px-2 py-0.5 font-mono text-[0.7rem] text-soft"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
