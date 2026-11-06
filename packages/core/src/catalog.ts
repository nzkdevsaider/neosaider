import { open, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  catalogSchema,
  moduleManifestSchema,
  type ModuleManifest,
} from "@neosaider/contracts";
import semver from "semver";

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_DOCUMENT_BYTES = 1024 * 1024;

export type CatalogVersion = {
  version: string;
  manifest: ModuleManifest;
  readmeUrl?: URL;
};

export type CatalogModule = {
  id: string;
  latest: CatalogVersion;
  versions: CatalogVersion[];
};

export type ModuleCatalog = ReturnType<typeof createCatalog>;

export function toCatalogUrl(location: string): URL {
  return /^[a-z][a-z0-9+.-]+:\/\//i.test(location)
    ? new URL(location)
    : pathToFileURL(location);
}

function tooLarge(url: URL): Error {
  return new Error(`${url.href} is larger than ${MAX_DOCUMENT_BYTES} bytes`);
}

function assertReadableFile(
  stats: { isFile(): boolean; size: number },
  url: URL,
) {
  if (!stats.isFile()) throw new Error(`${url.href} is not a regular file`);
  if (stats.size > MAX_DOCUMENT_BYTES) throw tooLarge(url);
}

async function readLocalFile(url: URL): Promise<string> {
  assertReadableFile(await stat(url), url);
  const file = await open(url);
  try {
    assertReadableFile(await file.stat(), url);
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}

async function readLimitedBody(response: Response, url: URL) {
  if (Number(response.headers.get("content-length")) > MAX_DOCUMENT_BYTES) {
    throw tooLarge(url);
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of response.body ?? []) {
    received += chunk.byteLength;
    if (received > MAX_DOCUMENT_BYTES) throw tooLarge(url);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readText(url: URL): Promise<string> {
  if (url.protocol === "file:") return readLocalFile(url);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported catalog URL: ${url.href}`);
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.redirected && new URL(response.url).origin !== url.origin) {
    await response.body?.cancel();
    throw new Error(`${url.href} redirected outside its origin`);
  }
  if (!response.ok) {
    throw new Error(`${url.href} responded ${response.status}`);
  }
  return readLimitedBody(response, url);
}

function resolveFromCatalog(reference: string, catalogUrl: URL): URL {
  const url = new URL(reference, catalogUrl);
  const sameSource =
    catalogUrl.protocol === "file:"
      ? url.protocol === "file:"
      : url.origin === catalogUrl.origin;
  if (!sameSource) {
    throw new Error(`${url.href} is outside the catalog at ${catalogUrl.href}`);
  }
  return url;
}

async function loadModules(catalogUrl: URL): Promise<CatalogModule[]> {
  const catalog = catalogSchema.parse(JSON.parse(await readText(catalogUrl)));
  const modules = await Promise.all(
    catalog.modules.map(async (entry): Promise<CatalogModule | undefined> => {
      try {
        const versions = await Promise.all(
          entry.versions.map(async (version) => {
            const manifest = moduleManifestSchema.parse(
              JSON.parse(
                await readText(
                  resolveFromCatalog(version.manifest, catalogUrl),
                ),
              ),
            );
            if (
              manifest.id !== entry.id ||
              manifest.version !== version.version
            ) {
              throw new Error(
                `manifest ${manifest.id}@${manifest.version} does not match ${entry.id}@${version.version}`,
              );
            }
            return {
              version: version.version,
              manifest,
              ...(version.readme && {
                readmeUrl: resolveFromCatalog(version.readme, catalogUrl),
              }),
            };
          }),
        );
        versions.sort((a, b) => semver.rcompare(a.version, b.version));
        return { id: entry.id, latest: versions[0]!, versions };
      } catch (error) {
        console.warn(`Skipping catalog module ${entry.id}:`, error);
        return undefined;
      }
    }),
  );
  return modules.filter((module) => module !== undefined);
}

export function createCatalog(location: string) {
  const catalogUrl = toCatalogUrl(location);
  let cached: { at: number; modules: Promise<CatalogModule[]> } | undefined;

  function modules(): Promise<CatalogModule[]> {
    if (!cached || Date.now() - cached.at > CACHE_TTL_MS) {
      const loading = loadModules(catalogUrl);
      cached = { at: Date.now(), modules: loading };
      loading.catch(() => {
        if (cached?.modules === loading) cached = undefined;
      });
    }
    return cached.modules;
  }

  async function search(query: { q?: string; tag?: string } = {}) {
    const text = query.q?.trim().toLowerCase();
    return (await modules()).filter(({ latest: { manifest } }) => {
      if (query.tag && !manifest.tags.includes(query.tag)) return false;
      if (!text) return true;
      return [
        manifest.id,
        manifest.name,
        manifest.description,
        ...manifest.tags,
      ]
        .join(" ")
        .toLowerCase()
        .includes(text);
    });
  }

  async function find(id: string, version?: string) {
    const module = (await modules()).find((candidate) => candidate.id === id);
    if (!module) return undefined;
    return version
      ? module.versions.find((candidate) => candidate.version === version)
      : module.latest;
  }

  async function readme(version: CatalogVersion): Promise<string> {
    if (!version.readmeUrl) {
      return `# ${version.manifest.name}\n\n${version.manifest.description}\n`;
    }
    return readText(version.readmeUrl);
  }

  return {
    location: catalogUrl.href,
    modules,
    search,
    find,
    readme,
    refresh: () => {
      cached = undefined;
    },
  };
}

export const emptyCatalog: ModuleCatalog = {
  location: "",
  modules: async () => [],
  search: async () => [],
  find: async () => undefined,
  readme: async (version) => `# ${version.manifest.name}
`,
  refresh: () => undefined,
};
