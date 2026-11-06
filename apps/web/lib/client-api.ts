type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

export async function harnessRequest<T = unknown>(
  path: string,
  { method = "GET", body }: RequestOptions = {},
): Promise<{ data?: T; error?: string; status?: number }> {
  const response = await fetch(`/api/harness${path}`, {
    method,
    ...(body !== undefined && {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const text = await response.text();
  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const parsed = isJson && text ? (JSON.parse(text) as unknown) : text;
  if (!response.ok) {
    const message =
      (parsed as { error?: unknown } | undefined)?.error ??
      (typeof parsed === "string" && parsed) ??
      response.statusText;
    return {
      error: typeof message === "string" ? message : JSON.stringify(message),
      status: response.status,
    };
  }
  return { data: parsed as T };
}
