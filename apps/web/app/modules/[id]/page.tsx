import type { ModuleStatus } from "@neosaider/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { harnessFetch, harnessJson } from "@/lib/harness";
import { NETWORK_LABELS, STATE_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

type InstalledModuleProps = { params: Promise<{ id: string }> };

export default async function InstalledModulePage({
  params,
}: InstalledModuleProps) {
  const { id } = await params;
  const module = (await harnessJson<ModuleStatus[]>("/modules"))?.find(
    (candidate) => candidate.name === id,
  );
  if (!module) notFound();
  const readmeResponse = await harnessFetch(
    `/modules/${encodeURIComponent(id)}/readme`,
  );
  const readme = readmeResponse.ok ? await readmeResponse.text() : undefined;
  const installation = module.installation;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <article className="min-w-0 rounded-lg border border-rule bg-card p-6">
        {readme ? (
          <Markdown>{readme}</Markdown>
        ) : (
          <p className="text-muted">Este módulo no publica README.</p>
        )}
      </article>

      <aside className="flex flex-col gap-4" aria-label="Estado del módulo">
        <div className="rounded-lg border border-rule bg-card p-5 text-sm">
          <h1 className="text-lg font-semibold">
            {installation?.manifest.name ?? module.name}
          </h1>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-soft">Estado</dt>
            <dd>
              {installation ? STATE_LABELS[installation.state] : "Externo"} ·{" "}
              {module.available ? "conectado" : "sin conexión"}
            </dd>
            {installation && (
              <>
                <dt className="text-soft">Versión</dt>
                <dd className="font-mono">{installation.manifest.version}</dd>
                <dt className="text-soft">Volumen</dt>
                <dd className="font-mono break-all">{installation.volume}</dd>
                <dt className="text-soft">Datos en</dt>
                <dd className="font-mono">{installation.manifest.dataPath}</dd>
                <dt className="text-soft">Instalado</dt>
                <dd>{installation.installedAt}</dd>
              </>
            )}
            {module.url && (
              <>
                <dt className="text-soft">URL</dt>
                <dd className="font-mono break-all">{module.url}</dd>
              </>
            )}
          </dl>
          {installation && (
            <p className="mt-3 text-xs text-muted">
              {NETWORK_LABELS[installation.manifest.permissions.network]}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-rule bg-card p-5 text-sm">
          <h2 className="font-semibold">Tools para Neo</h2>
          {module.tools?.length ? (
            <ul className="mt-2 flex flex-col gap-2">
              {module.tools.map((tool) => (
                <li key={tool.name}>
                  <code className="font-mono text-xs">{tool.name}</code>
                  <p className="text-xs text-muted">{tool.description}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">
              Sin tools disponibles ahora mismo.
            </p>
          )}
        </div>

        <Link href="/modules" className="text-sm text-link underline">
          ← Volver a módulos
        </Link>
      </aside>
    </div>
  );
}
