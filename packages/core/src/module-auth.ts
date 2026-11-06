import { createHmac } from "node:crypto";

export const moduleToken = (secret: string, moduleId: string) =>
  createHmac("sha256", secret)
    .update(`neosaider-module:${moduleId}`)
    .digest("hex");

export const moduleAuthorization = (secret: string, moduleId: string) => ({
  Authorization: `Bearer ${moduleToken(secret, moduleId)}`,
});
