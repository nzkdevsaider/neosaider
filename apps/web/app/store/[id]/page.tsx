import type { CatalogEntry } from "@neosaider/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InstallForm } from "@/components/install-form";
import { Markdown } from "@/components/markdown";
import { NETWORK_LABELS } from "@/lib/labels";
import { harnessJson } from "@/lib/harness";

export const dynamic = "force-dynamic";

type DetailProps = { params: Promise<{ id: string }> };

export default async function StoreModulePage({ params }: DetailProps) {
  const { id } = await params;
  const entry = await harnessJson<CatalogEntry & { readme: string }>(
    `/catalog/${encodeURIComponent(id)}`,
  );
  if (!entry) notFound();
  const { manifest, installedVersion, readme, versions } = entry;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <article className="min-w-0 rounded-lg border border-rule bg-card p-6">
        <Markdown>{readme}</Markdown>
      </article>

      <aside className="flex flex-col gap-4" aria-label="Detalles del módulo">
        <div className="rounded-lg border border-rule bg-card p-5">
          <div className="flex items-center gap-3">
            <span aria-hidden className="text-3xl">
              {manifest.icon ?? "🧩"}
            </span>
            <div>
              <h1 className="text-lg font-semibold">{manifest.name}</h1>
              <p className="font-mono text-xs text-soft">
                v{manifest.version} · {manifest.license}
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">{manifest.description}</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-soft">Autor</dt>
            <dd>{manifest.author}</dd>
            <dt className="text-soft">Imagen</dt>
            <dd className="font-mono break-all">{manifest.image}</dd>
            <dt className="text-soft">Datos</dt>
            <dd className="font-mono">{manifest.dataPath}</dd>
            <dt className="text-soft">Versiones</dt>
            <dd className="font-mono">{versions.join(", ")}</dd>
            {manifest.repository && (
              <>
                <dt className="text-soft">Código</dt>
                <dd>
                  <a href={manifest.repository} className="text-link underline">
                    Repositorio
                  </a>
                </dd>
              </>
            )}
          </dl>
        </div>

        <div className="rounded-lg border border-rule bg-card p-5">
          <h2 className="text-sm font-semibold">Permisos</h2>
          <p className="mt-1 text-sm text-muted">
            {NETWORK_LABELS[manifest.permissions.network]}
          </p>
          <p className="mt-1 text-sm text-muted">
            Guarda sus datos en un volumen propio montado en{" "}
            <code className="font-mono">{manifest.dataPath}</code>. Desinstalar
            el módulo lo borra.
          </p>
        </div>

        {installedVersion ? (
          <div className="rounded-lg border border-rule bg-card p-5 text-sm">
            Instalado (v{installedVersion}).{" "}
            <Link
              href={`/modules/${manifest.id}`}
              className="text-link underline"
            >
              Gestionarlo
            </Link>
          </div>
        ) : (
          <InstallForm manifest={manifest} />
        )}
      </aside>
    </div>
  );
}
