"use client";

import type { ModuleManifest } from "@neosaider/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfigFields, readConfig } from "@/components/config-fields";
import { harnessRequest } from "@/lib/client-api";

export function InstallForm({ manifest }: { manifest: ModuleManifest }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function install(formData: FormData) {
    setBusy(true);
    setError(undefined);
    const result = await harnessRequest("/modules/install", {
      method: "POST",
      body: {
        id: manifest.id,
        version: manifest.version,
        config: readConfig(manifest.config, formData),
      },
    });
    setBusy(false);
    if (result.error) setError(result.error);
    else router.push("/modules");
  }

  return (
    <form
      action={install}
      className="flex flex-col gap-4 rounded-lg border border-rule bg-card p-5"
    >
      <h2 className="text-sm font-semibold">Instalar</h2>
      <ConfigFields fields={manifest.config} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Instalando…" : `Instalar ${manifest.name}`}
      </button>
    </form>
  );
}
