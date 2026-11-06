import type { CatalogEntry } from "@neosaider/contracts";
import Link from "next/link";
import { ModuleCard } from "@/components/module-card";
import { harnessJson } from "@/lib/harness";

export const dynamic = "force-dynamic";

type StoreProps = { searchParams: Promise<{ q?: string; tag?: string }> };

function withQuery(path: string, params: { q?: string; tag?: string }) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value) as [string, string][],
  ).toString();
  return query ? `${path}?${query}` : path;
}

export default async function StorePage({ searchParams }: StoreProps) {
  const { q, tag } = await searchParams;
  const [entries, all] = await Promise.all([
    harnessJson<CatalogEntry[]>(withQuery("/catalog", { q, tag })),
    harnessJson<CatalogEntry[]>("/catalog"),
  ]);
  const tags = [
    ...new Set((all ?? []).flatMap((entry) => entry.manifest.tags)),
  ].sort();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-serif text-4xl">Tienda de módulos</h1>
        <p className="mt-1 text-muted">
          Módulos compatibles con el SDK de Neosaider. Cada uno se instala en su
          propio contenedor, con su propio volumen de datos.
        </p>
      </header>

      <form role="search" className="flex flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">
          Buscar módulos
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, descripción o etiqueta"
          className="min-w-0 flex-1 rounded-md border border-rule bg-card px-3 py-2 text-sm"
        />
        {tag && <input type="hidden" name="tag" value={tag} />}
        <button
          type="submit"
          className="rounded-md bg-ink px-4 py-2 text-sm text-paper"
        >
          Buscar
        </button>
      </form>

      {tags.length > 0 && (
        <nav aria-label="Filtrar por etiqueta" className="flex flex-wrap gap-2">
          {[undefined, ...tags].map((candidate) => (
            <Link
              key={candidate ?? "all"}
              href={withQuery("/store", { q, tag: candidate })}
              aria-current={tag === candidate ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${
                tag === candidate
                  ? "border-accent text-accent"
                  : "border-rule text-muted hover:text-ink"
              }`}
            >
              {candidate ?? "Todas"}
            </Link>
          ))}
        </nav>
      )}

      {entries && entries.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <li key={entry.manifest.id}>
              <ModuleCard entry={entry} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">
          No hay módulos que coincidan con la búsqueda.
        </p>
      )}
    </div>
  );
}
