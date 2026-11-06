import { z } from "zod";

export const moduleNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/, "lowercase letters, digits, '-' or '_'");

export const semverSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    "semantic version such as 1.2.3",
  );

const RESERVED_CONFIG_KEYS = /^(PORT|HOST|NEOSAIDER_.*)$/;

export const moduleConfigFieldSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,63}$/, "UPPER_SNAKE_CASE environment variable")
    .refine((key) => !RESERVED_CONFIG_KEYS.test(key), {
      message: "PORT, HOST and NEOSAIDER_* are reserved",
    }),
  description: z.string().min(1).max(300),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  default: z.string().optional(),
});
export type ModuleConfigField = z.infer<typeof moduleConfigFieldSchema>;

export const moduleNetworkSchema = z.enum(["isolated", "outbound"]);
export type ModuleNetwork = z.infer<typeof moduleNetworkSchema>;

export const moduleManifestSchema = z.object({
  id: moduleNameSchema,
  name: z.string().min(1).max(64),
  version: semverSchema,
  description: z.string().min(1).max(300),
  tags: z
    .array(z.string().regex(/^[a-z0-9-]{1,32}$/, "lowercase tag"))
    .max(10)
    .default([]),
  author: z.string().min(1).max(100),
  license: z.string().min(1).max(64),
  homepage: z.url().optional(),
  repository: z.url().optional(),
  icon: z.string().max(16).optional(),
  sdk: z.string().min(1).max(64),
  image: z
    .string()
    .regex(/^[\w.\-/:@]+$/, "Docker image reference")
    .max(255),
  port: z.number().int().min(1).max(65535).default(8080),
  dataPath: z.string().startsWith("/").default("/data"),
  config: z
    .array(moduleConfigFieldSchema)
    .default([])
    .refine(
      (fields) =>
        new Set(fields.map((field) => field.key)).size === fields.length,
      { message: "config keys must be unique" },
    ),
  permissions: z
    .object({ network: moduleNetworkSchema.default("isolated") })
    .default({ network: "isolated" }),
});
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export const catalogSchema = z.object({
  version: z.literal(1),
  modules: z.array(
    z.object({
      id: moduleNameSchema,
      versions: z
        .array(
          z.object({
            version: semverSchema,
            manifest: z.string().min(1),
            readme: z.string().min(1).optional(),
          }),
        )
        .min(1),
    }),
  ),
});
export type Catalog = z.infer<typeof catalogSchema>;

export type CatalogEntry = {
  manifest: ModuleManifest;
  versions: string[];
  installedVersion?: string;
};

export const catalogQuerySchema = z.object({
  q: z.string().max(100).optional(),
  tag: z.string().max(32).optional(),
});

export const moduleConfigValuesSchema = z.record(
  z.string(),
  z.string().max(4096),
);
export type ModuleConfigValues = z.infer<typeof moduleConfigValuesSchema>;

export const installModuleRequestSchema = z.object({
  id: moduleNameSchema,
  version: semverSchema.optional(),
  config: moduleConfigValuesSchema.default({}),
});
export type InstallModuleRequest = z.infer<typeof installModuleRequestSchema>;

export const updateModuleRequestSchema = z.object({
  version: semverSchema.optional(),
  acceptChanges: z.boolean().default(false),
});

export const updateModuleConfigSchema = z.object({
  config: moduleConfigValuesSchema,
});

export const uninstallModuleQuerySchema = z.object({
  keepData: z.enum(["true", "false"]).default("false"),
});

export const moduleLogsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(2000).default(200),
});

export const moduleRegistrationSchema = z.object({
  name: moduleNameSchema,
  transport: z.literal("http"),
  url: z.url(),
});
export type ModuleRegistration = z.infer<typeof moduleRegistrationSchema>;

export const installStateSchema = z.enum([
  "installing",
  "running",
  "stopped",
  "failed",
  "removing",
]);
export type InstallState = z.infer<typeof installStateSchema>;

export type ModuleInstallation = {
  state: InstallState;
  manifest: ModuleManifest;
  volume: string;
  container: string;
  config: ModuleConfigValues;
  error?: string;
  installedAt: string;
  updatedAt: string;
};

export type ModuleTool = { name: string; description: string };

export type ModuleStatus = {
  name: string;
  url?: string;
  available: boolean;
  error?: string;
  tools?: ModuleTool[];
  installation?: ModuleInstallation;
};

export const SECRET_MASK = "••••••";
