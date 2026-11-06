import { NextResponse, type NextRequest } from "next/server";
import { allowedHostnames, isRequestAllowed } from "@/lib/request-guard";

const allowed = allowedHostnames(process.env.NEOSAIDER_WEB_ALLOWED_HOSTS);

export function proxy(request: NextRequest) {
  const allowedRequest = isRequestAllowed(
    {
      pathname: request.nextUrl.pathname,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    },
    allowed,
  );
  return allowedRequest
    ? NextResponse.next()
    : new NextResponse("Forbidden", { status: 403 });
}
