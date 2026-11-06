import { hostname } from "node:os";
import type { ModuleNetwork } from "@neosaider/contracts";
import Docker from "dockerode";

export type RuntimeModuleSpec = {
  id: string;
  version: string;
  image: string;
  port: number;
  dataPath: string;
  network: ModuleNetwork;
  env: Record<string, string>;
  token?: string;
};

export type RunningModule = {
  container: string;
  volume: string;
  url: string;
};

export type ModuleRuntime = {
  available: () => Promise<boolean>;
  ensureImage: (image: string) => Promise<void>;
  run: (spec: RuntimeModuleSpec) => Promise<RunningModule>;
  start: (id: string, port: number) => Promise<RunningModule | undefined>;
  remove: (id: string, options: { keepData: boolean }) => Promise<void>;
  logs: (id: string, tail: number) => Promise<string>;
};

export const moduleResourceName = (id: string) => `neosaider-module-${id}`;

const ISOLATED_NETWORK = "neosaider-modules-isolated";
const OUTBOUND_NETWORK = "neosaider-modules-outbound";
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

type DockerRuntimeOptions = {
  docker?: Docker;
  composeNetwork?: string;
};

function isNotFound(error: unknown): boolean {
  return (error as { statusCode?: number }).statusCode === 404;
}

function demuxLogs(buffer: Buffer): string {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    chunks.push(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return offset === 0
    ? buffer.toString("utf8")
    : Buffer.concat(chunks).toString("utf8");
}

export function createDockerRuntime({
  docker = new Docker(),
  composeNetwork,
}: DockerRuntimeOptions = {}): ModuleRuntime {
  async function ensureModuleNetwork(
    name: string,
    internal: boolean,
  ): Promise<void> {
    const existing = await docker.listNetworks({ filters: { name: [name] } });
    if (!existing.some((network) => network.Name === name)) {
      await docker.createNetwork({
        Name: name,
        Internal: internal,
        Labels: { "neosaider.managed": "true" },
      });
    }
    const self = await docker
      .getContainer(hostname())
      .inspect()
      .catch(() => undefined);
    if (self && !self.NetworkSettings.Networks[name]) {
      await docker.getNetwork(name).connect({ Container: self.Id });
    }
  }

  async function urlOf(name: string, port: number): Promise<string> {
    if (composeNetwork) return `http://${name}:${port}/mcp`;
    const inspected = await docker.getContainer(name).inspect();
    const binding = inspected.NetworkSettings.Ports[`${port}/tcp`]?.[0];
    if (!binding) throw new Error(`${name} has no published port`);
    return `http://127.0.0.1:${binding.HostPort}/mcp`;
  }

  async function removeContainer(name: string): Promise<void> {
    await docker
      .getContainer(name)
      .remove({ force: true })
      .catch((error: unknown) => {
        if (!isNotFound(error)) throw error;
      });
  }

  return {
    available: () =>
      docker.ping().then(
        () => true,
        () => false,
      ),

    async ensureImage(image) {
      const present = await docker
        .getImage(image)
        .inspect()
        .then(
          () => true,
          (error: unknown) => {
            if (isNotFound(error)) return false;
            throw error;
          },
        );
      if (present) return;
      const stream = await docker.pull(image);
      await new Promise<void>((resolve, reject) =>
        docker.modem.followProgress(stream, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    },

    async run(spec) {
      const name = moduleResourceName(spec.id);
      await docker.createVolume({
        Name: name,
        Labels: { "neosaider.module": spec.id },
      });
      await removeContainer(name);

      const networkMode = composeNetwork
        ? spec.network === "isolated"
          ? ISOLATED_NETWORK
          : OUTBOUND_NETWORK
        : "bridge";
      if (composeNetwork) {
        await ensureModuleNetwork(networkMode, spec.network === "isolated");
      }

      const container = await docker.createContainer({
        name,
        Image: spec.image,
        Env: Object.entries({
          ...spec.env,
          PORT: String(spec.port),
          HOST: "0.0.0.0",
          NEOSAIDER_DATA_DIR: spec.dataPath,
          NEOSAIDER_ALLOWED_HOSTS: `${name},localhost,127.0.0.1`,
          ...(spec.token && { NEOSAIDER_MODULE_TOKEN: spec.token }),
        }).map(([key, value]) => `${key}=${value}`),
        Labels: {
          "neosaider.module": spec.id,
          "neosaider.version": spec.version,
        },
        ExposedPorts: { [`${spec.port}/tcp`]: {} },
        HostConfig: {
          Mounts: [{ Type: "volume", Source: name, Target: spec.dataPath }],
          RestartPolicy: { Name: "unless-stopped" },
          ReadonlyRootfs: true,
          Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges"],
          Memory: MEMORY_LIMIT_BYTES,
          NetworkMode: networkMode,
          ...(!composeNetwork && {
            PortBindings: {
              [`${spec.port}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: "" }],
            },
          }),
        },
      });
      await container.start();
      return {
        container: name,
        volume: name,
        url: await urlOf(name, spec.port),
      };
    },

    async start(id, port) {
      const name = moduleResourceName(id);
      const container = docker.getContainer(name);
      const inspected = await container.inspect().catch((error: unknown) => {
        if (isNotFound(error)) return undefined;
        throw error;
      });
      if (!inspected) return undefined;
      if (!inspected.State.Running) await container.start();
      return { container: name, volume: name, url: await urlOf(name, port) };
    },

    async remove(id, { keepData }) {
      const name = moduleResourceName(id);
      await removeContainer(name);
      if (keepData) return;
      await docker
        .getVolume(name)
        .remove()
        .catch((error: unknown) => {
          if (!isNotFound(error)) throw error;
        });
    },

    async logs(id, tail) {
      const output = await docker
        .getContainer(moduleResourceName(id))
        .logs({ stdout: true, stderr: true, tail, follow: false });
      return demuxLogs(Buffer.from(output));
    },
  };
}
