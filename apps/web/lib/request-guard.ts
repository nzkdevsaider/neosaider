const DEFAULT_ALLOWED_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];
const HARNESS_PROXY_PREFIX = "/api/harness";
const CROSS_ORIGIN_FETCH_SITES = new Set(["cross-site", "same-site"]);

export type GuardedRequest = {
  pathname: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
};

export function allowedHostnames(extraHostnames = "") {
  return new Set(
    [...DEFAULT_ALLOWED_HOSTNAMES, ...extraHostnames.split(",")]
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hostnameOf(urlOrHost: string) {
  try {
    return new URL(
      urlOrHost.includes("://") ? urlOrHost : `http://${urlOrHost}`,
    ).hostname;
  } catch {
    return undefined;
  }
}

function isAllowedHostname(
  urlOrHost: string | null,
  allowed: ReadonlySet<string>,
) {
  const hostname = urlOrHost ? hostnameOf(urlOrHost) : undefined;
  return hostname !== undefined && allowed.has(hostname);
}

export function isRequestAllowed(
  request: GuardedRequest,
  allowed: ReadonlySet<string>,
) {
  if (!isAllowedHostname(request.host, allowed)) return false;
  if (!request.pathname.startsWith(HARNESS_PROXY_PREFIX)) return true;
  if (CROSS_ORIGIN_FETCH_SITES.has(request.secFetchSite ?? "")) return false;
  return request.origin === null || isAllowedHostname(request.origin, allowed);
}
