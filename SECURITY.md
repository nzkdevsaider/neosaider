# Security Policy

Neosaider is a local-first harness for one user on one machine. This document explains what it protects, what it does not, and how to report a vulnerability.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Use the repository's private vulnerability reporting (the **Security** tab, then **Report a vulnerability**). Include:

- the affected project (`apps/harness`, `apps/web`, `packages/core`, a module, and so on);
- the steps to reproduce it and the impact you expect;
- the commit or version you tested.

You will get an acknowledgement as soon as the maintainer can read the report. The project has no fixed response time, because it is maintained on a best-effort basis.

## Supported versions

Only the latest commit on `main` receives fixes.

## Security model

- **One token, one user.** A single `NEOSAIDER_API_TOKEN` protects every harness route except `GET /health`. There are no accounts, roles or per-client permissions. Whoever holds the token controls the harness.
- **The web UI has no login.** It keeps the token on the Next.js server, proxies the calls and listens only on `127.0.0.1`. Anyone who can reach that port controls the harness.
- **Web UI request checks.** `apps/web/proxy.ts` answers `403` to requests whose `Host` is not `localhost`, `127.0.0.1`, `[::1]` or listed in `NEOSAIDER_WEB_ALLOWED_HOSTS`, and rejects cross-site requests on `/api/harness/*`.
- **Hardened module containers.** Modules run with a read-only file system (except `/data` and a 64 MB `/tmp`), no Linux capabilities, `no-new-privileges` and a 256 MB memory limit. On an isolated network they have no egress.
- **Limited Docker access.** Under Docker Compose, the harness reaches Docker only through `docker-socket-proxy` on an internal network. Modules cannot reach `web`, `docker-proxy` or `ollama`.
- **Local data.** Everything is stored in one SQLite file. It is not encrypted at rest.

Read [Architecture](./docs/ARCHITECTURE.md) for the full list of decisions and risks.

## Known limits

These are by design, so they are not vulnerabilities by themselves:

- A leaked token lets an attacker create containers through the harness. Treat it like a password and rotate it if it leaks.
- Locally (without Compose), module containers publish their port on `127.0.0.1` and are not isolated from the network.
- `/agent/*` allows CORS from any origin because every request still needs the token and no cookies are used.
- On a multi-user host, every local OS user can reach the web UI.
- A module is code you choose to run. Install modules only from a catalog you trust, because the hardening limits the damage but does not make an untrusted module safe.

## Deployment advice

- Generate the token with `openssl rand -hex 32` and never commit your `.env`.
- Do not expose the harness or the web UI to the internet. If you need remote access, put them behind a VPN or an HTTPS reverse proxy with its own authentication.
- Keep Docker, Node.js and the model server up to date.
