import { zValidator } from "@hono/zod-validator";
import {
  catalogQuerySchema,
  chatRequestSchema,
  eventsQuerySchema,
  installModuleRequestSchema,
  moduleLogsQuerySchema,
  moduleRegistrationSchema,
  triggerDefinitionSchema,
  uninstallModuleQuerySchema,
  updateModuleConfigSchema,
  updateModuleRequestSchema,
  type SuggestionEvent,
} from "@neosaider/contracts";
import { ModuleInstallError, type Neo } from "@neosaider/core";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { createAgentProtocol } from "./agent-protocol.js";

const KEEPALIVE_MS = 25_000;

type AppOptions = {
  neo: Neo;
  apiToken: string;
  isLlmReachable: () => Promise<boolean>;
};

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const isJsonContentType = (contentType: string | undefined) =>
  contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";

const parseId = (raw: string) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

export function createApp({ neo, apiToken, isLlmReachable }: AppOptions) {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof ModuleInstallError) {
      return c.json({ error: error.message }, error.status);
    }
    console.error(error);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/health", async (c) =>
    c.json({ ok: true, llm: await isLlmReachable() }),
  );

  app.use("/agent/*", cors());
  app.use("*", bearerAuth({ token: apiToken }));
  app.use("*", async (c, next) => {
    const contentType = c.req.header("content-type");
    const carriesBody =
      contentType !== undefined ||
      Number(c.req.header("content-length") ?? 0) > 0 ||
      c.req.header("transfer-encoding") !== undefined;
    if (
      BODY_METHODS.has(c.req.method) &&
      carriesBody &&
      !isJsonContentType(contentType)
    ) {
      return c.json({ error: "Content-Type must be application/json" }, 415);
    }
    await next();
  });

  app.route("/agent", createAgentProtocol(neo));

  app.get("/threads/:threadId", async (c) =>
    c.json(await neo.history(c.req.param("threadId"))),
  );

  app.post(
    "/threads/:threadId/messages",
    zValidator("json", chatRequestSchema),
    (c) => {
      const threadId = c.req.param("threadId");
      const { message } = c.req.valid("json");
      return streamSSE(c, async (stream) => {
        for await (const event of neo.chat(threadId, message)) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      });
    },
  );

  app.get("/events", zValidator("query", eventsQuerySchema), (c) => {
    const { client } = c.req.valid("query");
    return streamSSE(c, async (stream) => {
      const deliver = async (event: SuggestionEvent) => {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: String(event.id),
        });
        neo.notifications.acknowledge(event.id, client);
      };
      for (const pending of neo.notifications.pending(client)) {
        await deliver(pending);
      }
      const forward = (event: SuggestionEvent) => void deliver(event);
      neo.bus.on("suggestion", forward);
      stream.onAbort(() => {
        neo.bus.off("suggestion", forward);
      });
      neo.bus.emit("session.start");
      while (!stream.aborted) {
        await stream.sleep(KEEPALIVE_MS);
        await stream.writeSSE({ event: "ping", data: "" });
      }
    });
  });

  app.get("/catalog", zValidator("query", catalogQuerySchema), async (c) =>
    c.json(await neo.catalog.search(c.req.valid("query"))),
  );

  app.get("/catalog/:id", async (c) => {
    const entry = await neo.catalog.get(c.req.param("id"));
    return entry ? c.json(entry) : c.notFound();
  });

  app.get("/modules", (c) => c.json(neo.modules.statuses()));

  app.post(
    "/modules",
    zValidator("json", moduleRegistrationSchema),
    async (c) => {
      const module = c.req.valid("json");
      if (neo.modules.isManaged(module.name)) {
        return c.json(
          { error: `${module.name} is an installed module; update it instead` },
          409,
        );
      }
      const statuses = await neo.modules.register(module);
      return c.json(
        statuses.find((status) => status.name === module.name),
        201,
      );
    },
  );

  app.post(
    "/modules/install",
    zValidator("json", installModuleRequestSchema),
    async (c) => c.json(await neo.modules.install(c.req.valid("json")), 202),
  );

  app.post(
    "/modules/:name/update",
    zValidator("json", updateModuleRequestSchema),
    async (c) => {
      const { version, acceptChanges } = c.req.valid("json");
      return c.json(
        await neo.modules.update(c.req.param("name"), version, {
          acceptChanges,
        }),
        202,
      );
    },
  );

  app.patch(
    "/modules/:name/config",
    zValidator("json", updateModuleConfigSchema),
    (c) =>
      c.json(
        neo.modules.configure(c.req.param("name"), c.req.valid("json").config),
        202,
      ),
  );

  app.get("/modules/:name/readme", async (c) => {
    const readme = await neo.modules.readme(c.req.param("name"));
    return readme === undefined
      ? c.notFound()
      : c.body(readme, 200, { "content-type": "text/markdown; charset=utf-8" });
  });

  app.get(
    "/modules/:name/logs",
    zValidator("query", moduleLogsQuerySchema),
    async (c) =>
      c.text(
        await neo.modules.logs(c.req.param("name"), c.req.valid("query").tail),
      ),
  );

  app.delete(
    "/modules/:name",
    zValidator("query", uninstallModuleQuerySchema),
    async (c) => {
      const name = c.req.param("name");
      const removed = neo.modules.isManaged(name)
        ? await neo.modules.uninstall(name, {
            keepData: c.req.valid("query").keepData === "true",
          })
        : await neo.modules.unregister(name);
      return removed ? c.body(null, 204) : c.notFound();
    },
  );

  app.get("/triggers", (c) => c.json(neo.triggers.list()));

  app.post("/triggers", zValidator("json", triggerDefinitionSchema), (c) => {
    try {
      return c.json(neo.triggers.create(c.req.valid("json")), 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  app.delete("/triggers/:id", (c) => {
    const id = parseId(c.req.param("id"));
    return id && neo.triggers.delete(id) ? c.body(null, 204) : c.notFound();
  });

  app.get("/memories", (c) => c.json(neo.memories.list()));

  app.delete("/memories/:id", (c) => {
    const id = parseId(c.req.param("id"));
    return id && neo.memories.delete(id) ? c.body(null, 204) : c.notFound();
  });

  return app;
}
