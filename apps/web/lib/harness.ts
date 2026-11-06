import "server-only";

const harnessUrl = () =>
  (process.env.NEOSAIDER_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function harnessFetch(path: string, init: RequestInit = {}) {
  const token = process.env.NEOSAIDER_API_TOKEN;
  if (!token) throw new Error("NEOSAIDER_API_TOKEN is not configured");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${harnessUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export async function harnessJson<T>(path: string): Promise<T | undefined> {
  const response = await harnessFetch(path);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}
