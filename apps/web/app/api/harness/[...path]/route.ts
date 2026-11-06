import type { NextRequest } from "next/server";
import { harnessFetch } from "@/lib/harness";

const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "last-event-id"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control"];

async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody =
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.headers.has("content-type");
  const upstream = await harnessFetch(
    `/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
    {
      method: request.method,
      headers,
      signal: request.signal,
      ...(hasBody && {
        body: request.body,
        duplex: "half",
      }),
    } as RequestInit,
  );
  const responseHeaders = new Headers({ "x-accel-buffering": "no" });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
