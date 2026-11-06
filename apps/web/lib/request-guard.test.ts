import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedHostnames,
  isRequestAllowed,
  type GuardedRequest,
} from "./request-guard.ts";

const allowed = allowedHostnames();
const proxyRequest = (overrides: Partial<GuardedRequest> = {}) => ({
  pathname: "/api/harness/memories",
  host: "127.0.0.1:3001",
  origin: null,
  secFetchSite: null,
  ...overrides,
});

test("loopback hosts are allowed on any port", () => {
  for (const host of [
    "127.0.0.1:3001",
    "localhost:3001",
    "[::1]:3001",
    "LOCALHOST",
  ]) {
    assert.equal(isRequestAllowed(proxyRequest({ host }), allowed), true, host);
  }
});

test("rebound, container and missing hosts are rejected on every route", () => {
  for (const host of ["attacker.example:3001", "web:3001", "", null, "a b"]) {
    for (const pathname of ["/", "/modules", "/api/harness/memories"]) {
      assert.equal(
        isRequestAllowed(proxyRequest({ host, pathname }), allowed),
        false,
        `${host} ${pathname}`,
      );
    }
  }
});

test("NEOSAIDER_WEB_ALLOWED_HOSTS extends the allowlist", () => {
  const extended = allowedHostnames(" neo.lan , Other.Lan ");
  assert.equal(
    isRequestAllowed(proxyRequest({ host: "neo.lan:3001" }), extended),
    true,
  );
  assert.equal(
    isRequestAllowed(proxyRequest({ host: "other.lan" }), extended),
    true,
  );
  assert.equal(
    isRequestAllowed(proxyRequest({ host: "127.0.0.1" }), extended),
    true,
  );
  assert.equal(
    isRequestAllowed(proxyRequest({ host: "web:3001" }), extended),
    false,
  );
});

test("the harness proxy rejects cross-site and same-site fetches", () => {
  for (const secFetchSite of ["cross-site", "same-site"]) {
    assert.equal(
      isRequestAllowed(proxyRequest({ secFetchSite }), allowed),
      false,
    );
  }
  for (const secFetchSite of ["same-origin", "none", null]) {
    assert.equal(
      isRequestAllowed(proxyRequest({ secFetchSite }), allowed),
      true,
    );
  }
  assert.equal(
    isRequestAllowed(
      proxyRequest({ pathname: "/", secFetchSite: "cross-site" }),
      allowed,
    ),
    true,
  );
});

test("the harness proxy rejects foreign origins", () => {
  for (const origin of ["https://evil.example", "http://web:3001", "null"]) {
    assert.equal(
      isRequestAllowed(proxyRequest({ origin }), allowed),
      false,
      origin,
    );
  }
  for (const origin of ["http://127.0.0.1:3001", "http://localhost:3000"]) {
    assert.equal(
      isRequestAllowed(proxyRequest({ origin }), allowed),
      true,
      origin,
    );
  }
});
