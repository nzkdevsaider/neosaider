"use client";

import type { CatalogEntry, ModuleStatus } from "@neosaider/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfigFields, readConfig } from "@/components/config-fields";
import { Dialog } from "@/components/dialog";
import { harnessRequest } from "@/lib/client-api";
import { STATE_LABELS } from "@/lib/labels";

const REFRESH_MS = 3000;

type Action =
  | { kind: "configure"; module: ModuleStatus }
  | { kind: "logs"; module: ModuleStatus }
  | { kind: "uninstall"; module: ModuleStatus }
  | {
      kind: "confirmUpdate";
      module: ModuleStatus;
      version: string;
      changes: string;
    };

const STATE_STYLES = {
  installing: "bg-accent-tint text-accent",
  running: "bg-[rgba(47,125,79,0.1)] text-success",
  stopped: "bg-paper text-muted",
  failed: "bg-[rgba(180,35,24,0.08)] text-danger",
  removing: "bg-paper text-muted",
};

function StateBadge({ module }: { module: ModuleStatus }) {
  const state = module.installation?.state;
  if (!state) {
    return (
      <span className="rounded bg-paper px-2 py-0.5 text-xs text-muted">
        Externo · {module.available ? "conectado" : "sin conexión"}
      </span>
    );
  }
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${STATE_STYLES[state]}`}>
      {STATE_LABELS[state]}
      {state === "running" && !module.available && " · reconectando"}
    </span>
  );
}

export function ModulesManager() {
  const [modules, setModules] = useState<ModuleStatus[]>();
  const [latest, setLatest] = useState<Record<string, string>>({});
  const [action, setAction] = useState<Action>();
  const [message, setMessage] = useState<string>();

  const refresh = useCallback(async () => {
    const [statuses, catalog] = await Promise.all([
      harnessRequest<ModuleStatus[]>("/modules"),
      harnessRequest<CatalogEntry[]>("/catalog"),
    ]);
    if (statuses.data) setModules(statuses.data);
    if (catalog.data) {
      setLatest(
        Object.fromEntries(
          catalog.data.map((entry) => [
            entry.manifest.id,
            entry.manifest.version,
          ]),
        ),
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function run(promise: Promise<{ error?: string }>, success: string) {
    const result = await promise;
    setMessage(result.error ?? success);
    setAction(undefined);
    await refresh();
  }

  async function update(
    module: ModuleStatus,
    version: string,
    acceptChanges = false,
  ) {
    const result = await harnessRequest(`/modules/${module.name}/update`, {
      method: "POST",
      body: { version, acceptChanges },
    });
    if (result.status === 409 && !acceptChanges) {
      setAction({
        kind: "confirmUpdate",
        module,
        version,
        changes: result.error ?? "",
      });
      return;
    }
    await run(
      Promise.resolve(result),
      `Actualizando ${module.name} a v${version}…`,
    );
  }

  if (!modules) return <p className="text-muted">Cargando módulos…</p>;
  if (!modules.length) {
    return (
      <p className="text-muted">
        No hay módulos instalados.{" "}
        <Link href="/store" className="text-link underline">
          Explora la tienda
        </Link>
        .
      </p>
    );
  }

  return (
    <>
      {message && (
        <p
          role="status"
          className="mb-4 rounded-md border border-rule bg-card px-4 py-2 text-sm"
        >
          {message}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {modules.map((module) => {
          const installation = module.installation;
          const newer =
            installation &&
            latest[module.name] &&
            latest[module.name] !== installation.manifest.version
              ? latest[module.name]
              : undefined;
          const busy =
            installation?.state === "installing" ||
            installation?.state === "removing";
          return (
            <li
              key={module.name}
              className="flex flex-col gap-3 rounded-lg border border-rule bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden>{installation?.manifest.icon ?? "🧩"}</span>
                  <Link
                    href={`/modules/${module.name}`}
                    className="font-semibold text-ink hover:underline"
                  >
                    {installation?.manifest.name ?? module.name}
                  </Link>
                  {installation && (
                    <span className="font-mono text-xs text-soft">
                      v{installation.manifest.version}
                    </span>
                  )}
                  <StateBadge module={module} />
                </div>
                <p className="mt-1 font-mono text-xs break-all text-soft">
                  {installation ? `volumen ${installation.volume}` : module.url}
                </p>
                {(installation?.error ?? module.error) && (
                  <p className="mt-1 text-xs text-danger">
                    {installation?.error ?? module.error}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {newer && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void update(module, newer)}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Actualizar a v{newer}
                  </button>
                )}
                {installation && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setAction({ kind: "configure", module })}
                      className="rounded-md border border-rule px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      Configurar
                    </button>
                    <button
                      type="button"
                      onClick={() => setAction({ kind: "logs", module })}
                      className="rounded-md border border-rule px-3 py-1.5 text-xs"
                    >
                      Logs
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAction({ kind: "uninstall", module })}
                  className="rounded-md border border-danger px-3 py-1.5 text-xs text-danger disabled:opacity-50"
                >
                  {installation ? "Desinstalar" : "Quitar"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        title={`Configurar ${action?.module.name ?? ""}`}
        open={action?.kind === "configure"}
        onClose={() => setAction(undefined)}
      >
        {action?.kind === "configure" && action.module.installation && (
          <form
            action={(formData) => {
              const installation = action.module.installation!;
              void run(
                harnessRequest(`/modules/${action.module.name}/config`, {
                  method: "PATCH",
                  body: {
                    config: readConfig(installation.manifest.config, formData),
                  },
                }),
                `Aplicando la configuración de ${action.module.name}…`,
              );
            }}
            className="flex flex-col gap-4"
          >
            <ConfigFields
              fields={action.module.installation.manifest.config}
              values={action.module.installation.config}
            />
            <p className="text-xs text-soft">
              Guardar recrea el contenedor; sus datos se conservan.
            </p>
            <button
              type="submit"
              className="self-end rounded-md bg-ink px-4 py-2 text-sm text-paper"
            >
              Guardar
            </button>
          </form>
        )}
      </Dialog>

      <Dialog
        title={`Actualizar ${action?.module.name ?? ""}`}
        open={action?.kind === "confirmUpdate"}
        onClose={() => setAction(undefined)}
      >
        {action?.kind === "confirmUpdate" && (
          <div className="flex flex-col gap-4 text-sm">
            <p>
              La versión v{action.version} amplía los permisos del módulo.
              Revisa los cambios antes de continuar:
            </p>
            <p className="rounded bg-paper p-3 font-mono text-xs break-words">
              {action.changes}
            </p>
            <button
              type="button"
              onClick={() => void update(action.module, action.version, true)}
              className="self-end rounded-md bg-danger px-4 py-2 text-white"
            >
              Aceptar los cambios y actualizar
            </button>
          </div>
        )}
      </Dialog>

      <Dialog
        title={`Logs de ${action?.module.name ?? ""}`}
        open={action?.kind === "logs"}
        onClose={() => setAction(undefined)}
      >
        {action?.kind === "logs" && <Logs name={action.module.name} />}
      </Dialog>

      <Dialog
        title={`Desinstalar ${action?.module.name ?? ""}`}
        open={action?.kind === "uninstall"}
        onClose={() => setAction(undefined)}
      >
        {action?.kind === "uninstall" && (
          <UninstallConfirmation
            module={action.module}
            onConfirm={(keepData) =>
              void run(
                harnessRequest(
                  `/modules/${action.module.name}?keepData=${keepData}`,
                  { method: "DELETE" },
                ),
                `${action.module.name} se ha quitado.`,
              )
            }
          />
        )}
      </Dialog>
    </>
  );
}

function Logs({ name }: { name: string }) {
  const [logs, setLogs] = useState<string>();
  useEffect(() => {
    void harnessRequest<string>(`/modules/${name}/logs?tail=200`).then(
      (result) => setLogs(result.data ?? result.error ?? ""),
    );
  }, [name]);
  return (
    <pre className="max-h-96 overflow-auto rounded bg-ink p-3 font-mono text-xs whitespace-pre-wrap text-paper">
      {logs ?? "Cargando…"}
    </pre>
  );
}

function UninstallConfirmation({
  module,
  onConfirm,
}: {
  module: ModuleStatus;
  onConfirm: (keepData: boolean) => void;
}) {
  const [keepData, setKeepData] = useState(false);
  if (!module.installation) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Se quitará el registro de este módulo externo. Su servidor y sus datos
          no se tocan.
        </p>
        <button
          type="button"
          onClick={() => onConfirm(true)}
          className="self-end rounded-md bg-danger px-4 py-2 text-white"
        >
          Quitar
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        Se borrará el contenedor de{" "}
        <strong>{module.installation.manifest.name}</strong>
        {keepData ? (
          "."
        ) : (
          <>
            {" "}
            y <strong>todos sus datos</strong> (volumen{" "}
            <code className="font-mono">{module.installation.volume}</code>).
            Esta acción no se puede deshacer.
          </>
        )}
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={keepData}
          onChange={(event) => setKeepData(event.target.checked)}
        />
        Conservar los datos para una futura reinstalación
      </label>
      <button
        type="button"
        onClick={() => onConfirm(keepData)}
        className="self-end rounded-md bg-danger px-4 py-2 text-white"
      >
        {keepData
          ? "Desinstalar y conservar datos"
          : "Desinstalar y borrar datos"}
      </button>
    </div>
  );
}
