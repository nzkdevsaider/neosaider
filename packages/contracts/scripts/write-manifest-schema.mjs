import { writeFileSync } from "node:fs";
import { URL } from "node:url";
import { z } from "zod";
import { moduleManifestSchema } from "../dist/modules.js";

const target = new URL(
  "../../../docs/schemas/module-manifest.schema.json",
  import.meta.url,
);
writeFileSync(
  target,
  `${JSON.stringify(z.toJSONSchema(moduleManifestSchema, { io: "input" }), null, 2)}\n`,
);
