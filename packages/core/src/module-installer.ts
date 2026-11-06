import {
  SECRET_MASK,
  type ModuleConfigValues,
  type ModuleInstallation,
  type ModuleManifest,
} from "@neosaider/contracts";
import {
  deleteInstallation,
  deleteModule,
  getInstallation,
  listInstallations,
  saveInstallation,
  saveModule,
  setInstallationState,
  type Db,
} from "@neosaider/storage";
import semver from "semver";
import { moduleAuthorization, moduleToken } from "./module-auth.js";
import type { ModuleCatalog } from "./catalog.js";
import { moduleResourceName, type ModuleRuntime } from "./module-runtime.js";

export const SUPPORTED_SDK_VERSION = "0.1.0";

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 500;

export class ModuleInstallError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503,
  ) {
    super(message);
  }
}

type InstallerOptions = {
  db: Db;
  catalog: ModuleCatalog;
  runtime?: ModuleRuntime;
  onModulesChanged: () => Promise<unknown>;
  healthTimeoutMs?: number;
  moduleSecret?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const baseUrlOf = (mcpUrl: string) => mcpUrl.replace(/\/mcp$/, "");

export function maskSecrets(
  manifest: ModuleManifest,
  config: ModuleConfigValues,
): ModuleConfigValues {
  const secrets = new Set(
    manifest.config.filter((field) => field.secret).map((field) => field.key),
  );
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      key,
      secrets.has(key) ? SECRET_MASK : value,
    ]),
  );
}

function resolveConfigValues(
  manifest: ModuleManifest,
  requested: ModuleConfigValues,
  previous: ModuleConfigValues = {},
): ModuleConfigValues {
  const known = new Set(manifest.config.map((field) => field.key));
  const unknown = Object.keys(requested).filter((key) => !known.has(key));
  if (unknown.length) {
    throw new ModuleInstallError(
      `Unknown configuration: ${unknown.join(", ")}`,
      400,
    );
  }
  const values: ModuleConfigValues = {};
  const missing: string[] = [];
  for (const field of manifest.config) {
    const candidate = requested[field.key];
    const value =
      candidate === SECRET_MASK || candidate === undefined
        ? previous[field.key]
        : candidate;
    if (value !== undefined && value !== "") values[field.key] = value;
    else if (field.required && field.default === undefined) {
      missing.push(field.key);
    }
  }
  if (missing.length) {
    throw new ModuleInstallError(
      `Missing required configuration: ${missing.join(", ")}`,
      400,
    );
  }
  return values;
}

function imageRepository(image: string): string {
  const withoutDigest = image.split("@")[0]!;
  const tagSeparator = withoutDigest.lastIndexOf(":");
  return tagSeparator > withoutDigest.lastIndexOf("/")
    ? withoutDigest.slice(0, tagSeparator)
    : withoutDigest;
}

function capabilityChanges(
  installed: ModuleManifest,
  next: ModuleManifest,
): string[] {
  const changes: string[] = [];
  if (
    installed.permissions.network === "isolated" &&
    next.permissions.network === "outbound"
  ) {
    changes.push("network access widens from isolated to outbound");
  }
  const nextFields = new Map(next.config.map((field) => [field.key, field]));
  for (const field of installed.config) {
    if (field.secret && nextFields.get(field.key)?.secret === false) {
      changes.push(`${field.key} is no longer secret`);
    }
  }
  const installedRepository = imageRepository(installed.image);
  const nextRepository = imageRepository(next.image);
  if (installedRepository !== nextRepository) {
    changes.push(
      `image repository changes from ${installedRepository} to ${nextRepository}`,
    );
  }
  return changes;
}

export type ModuleInstaller = ReturnType<typeof createModuleInstaller>;

export function createModuleInstaller({
  db,
  catalog,
  runtime,
  onModulesChanged,
  healthTimeoutMs = HEALTH_TIMEOUT_MS,
  moduleSecret,
}: InstallerOptions) {
  const credentialsFor = (moduleId: string) =>
    moduleSecret ? moduleAuthorization(moduleSecret, moduleId) : {};

  const pending = new Set<Promise<void>>();

  function requireRuntime(): ModuleRuntime {
    if (!runtime) {
      throw new ModuleInstallError(
        "Docker is not available, so modules cannot be installed or removed",
        503,
      );
    }
    return runtime;
  }

  async function waitUntilServing(url: string, manifest: ModuleManifest) {
    const base = baseUrlOf(url);
    const deadline = Date.now() + healthTimeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const headers = credentialsFor(manifest.id);
        const health = await fetch(`${base}/health`, {
          headers,
          signal: AbortSignal.timeout(2000),
        });
        if (health.ok) {
          const served = (await (
            await fetch(`${base}/manifest`, {
              headers,
              signal: AbortSignal.timeout(2000),
            })
          ).json()) as Partial<ModuleManifest>;
          if (
            served.id !== manifest.id ||
            served.version !== manifest.version
          ) {
            throw new Error(
              `the container serves ${served.id}@${served.version}, expected ${manifest.id}@${manifest.version}`,
            );
          }
          return;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("the container")
        ) {
          throw error;
        }
        lastError = error;
      }
      await sleep(HEALTH_INTERVAL_MS);
    }
    throw new Error(
      `the module did not become healthy in ${healthTimeoutMs / 1000}s${lastError ? `: ${String(lastError)}` : ""}`,
    );
  }

  async function deploy(manifest: ModuleManifest, config: ModuleConfigValues) {
    const activeRuntime = requireRuntime();
    try {
      await activeRuntime.ensureImage(manifest.image);
      const running = await activeRuntime.run({
        id: manifest.id,
        version: manifest.version,
        image: manifest.image,
        port: manifest.port,
        dataPath: manifest.dataPath,
        network: manifest.permissions.network,
        env: config,
        token: moduleSecret && moduleToken(moduleSecret, manifest.id),
      });
      await waitUntilServing(running.url, manifest);
      saveModule(db, {
        name: manifest.id,
        transport: "http",
        url: running.url,
      });
      setInstallationState(db, manifest.id, "running");
    } catch (error) {
      setInstallationState(
        db,
        manifest.id,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    await onModulesChanged();
  }

  function track(task: Promise<void>) {
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }

  async function resolveManifest(id: string, version?: string) {
    const found = await catalog.find(id, version);
    if (!found) {
      throw new ModuleInstallError(
        `${id}${version ? `@${version}` : ""} is not in the catalog`,
        404,
      );
    }
    if (!semver.satisfies(SUPPORTED_SDK_VERSION, found.manifest.sdk)) {
      throw new ModuleInstallError(
        `${id} needs SDK ${found.manifest.sdk}, this harness supports ${SUPPORTED_SDK_VERSION}`,
        400,
      );
    }
    return found.manifest;
  }

  function begin(manifest: ModuleManifest, config: ModuleConfigValues) {
    const name = moduleResourceName(manifest.id);
    const installation = saveInstallation(db, {
      manifest,
      state: "installing",
      volume: name,
      container: name,
      config,
    });
    track(deploy(manifest, config));
    return installation;
  }

  async function install(request: {
    id: string;
    version?: string;
    config: ModuleConfigValues;
  }): Promise<ModuleInstallation> {
    requireRuntime();
    const current = getInstallation(db, request.id);
    if (current && current.state !== "failed") {
      throw new ModuleInstallError(`${request.id} is already installed`, 409);
    }
    const manifest = await resolveManifest(request.id, request.version);
    return begin(manifest, resolveConfigValues(manifest, request.config));
  }

  async function update(
    id: string,
    version?: string,
    { acceptChanges = false }: { acceptChanges?: boolean } = {},
  ) {
    requireRuntime();
    const current = getInstallation(db, id);
    if (!current) throw new ModuleInstallError(`${id} is not installed`, 404);
    const manifest = await resolveManifest(id, version);
    const changes = capabilityChanges(current.manifest, manifest);
    if (changes.length && !acceptChanges) {
      throw new ModuleInstallError(
        `Updating ${id} to ${manifest.version} needs confirmation: ${changes.join("; ")}`,
        409,
      );
    }
    return begin(manifest, resolveConfigValues(manifest, {}, current.config));
  }

  function configure(id: string, requested: ModuleConfigValues) {
    requireRuntime();
    const current = getInstallation(db, id);
    if (!current) throw new ModuleInstallError(`${id} is not installed`, 404);
    return begin(
      current.manifest,
      resolveConfigValues(current.manifest, requested, current.config),
    );
  }

  async function uninstall(id: string, { keepData }: { keepData: boolean }) {
    const activeRuntime = requireRuntime();
    if (!getInstallation(db, id)) return false;
    setInstallationState(db, id, "removing");
    deleteModule(db, id);
    await onModulesChanged();
    await activeRuntime.remove(id, { keepData });
    deleteInstallation(db, id);
    return true;
  }

  async function reconcile(): Promise<void> {
    if (!runtime || !(await runtime.available())) return;
    for (const installation of listInstallations(db)) {
      if (installation.state === "removing") {
        await runtime.remove(installation.manifest.id, { keepData: false });
        deleteInstallation(db, installation.manifest.id);
        continue;
      }
      if (installation.state === "installing") {
        track(deploy(installation.manifest, installation.config));
        continue;
      }
      try {
        const running = await runtime.start(
          installation.manifest.id,
          installation.manifest.port,
        );
        if (!running) {
          setInstallationState(
            db,
            installation.manifest.id,
            "failed",
            "the container no longer exists; update or reinstall the module",
          );
          continue;
        }
        saveModule(db, {
          name: installation.manifest.id,
          transport: "http",
          url: running.url,
        });
        setInstallationState(db, installation.manifest.id, "running");
      } catch (error) {
        setInstallationState(
          db,
          installation.manifest.id,
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    await onModulesChanged();
  }

  async function logs(id: string, tail: number) {
    const activeRuntime = requireRuntime();
    if (!getInstallation(db, id)) {
      throw new ModuleInstallError(`${id} is not installed`, 404);
    }
    return activeRuntime.logs(id, tail);
  }

  return {
    install,
    update,
    configure,
    uninstall,
    reconcile,
    logs,
    installations: () => listInstallations(db),
    whenIdle: () => Promise.all([...pending]).then(() => undefined),
  };
}
