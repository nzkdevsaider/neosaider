---
title: Module catalog
description: Format of the catalog that feeds the store and how to publish a module in it.
---

# Module catalog

The Neosaider store reads a **catalog**: a JSON file versioned in Git that lists the available modules and points at each version's manifest and README. The harness downloads it from `NEOSAIDER_CATALOG_URL`, which can be an HTTPS URL (for example, the `raw` URL of a GitHub repository) or a local path, and caches it for five minutes.

If `NEOSAIDER_CATALOG_URL` is not set, the harness uses [`modules/catalog.json`](../modules/catalog.json), the monorepo's development catalog.

## Format

```json
{
  "version": 1,
  "modules": [
    {
      "id": "gym",
      "versions": [
        {
          "version": "0.1.0",
          "manifest": "./gym/neosaider.module.json",
          "readme": "./gym/README.md"
        }
      ]
    }
  ]
}
```

| Field                  | Required | Description                                                     |
| ---------------------- | -------- | --------------------------------------------------------------- |
| `version`              | yes      | Version of the catalog format. Currently `1`.                   |
| `modules[].id`         | yes      | Module identifier; matches the `id` in its manifest.            |
| `modules[].versions[]` | yes      | Published versions. The store offers the highest one by semver. |
| `versions[].version`   | yes      | Semver version; matches the `version` in the manifest.          |
| `versions[].manifest`  | yes      | URL of that version's `neosaider.module.json`.                  |
| `versions[].readme`    | no       | URL of the Markdown README the store shows.                     |

Relative URLs are resolved against the location of the catalog itself, so the same file works as a local path and as a remote URL. A resolved URL must keep the catalog's protocol and, for `http`/`https`, its origin: a remote catalog cannot point at `file:` paths or other hosts. The catalog, each manifest and each README are limited to 1 MiB, and local ones must be regular files.

The catalog does not repeat the name, description, tags or image: the **manifest is the single source of truth** (see [Manifest](../packages/module-sdk/docs/CREATING-A-MODULE.md#manifest)). The harness downloads the manifests of each module's latest version to render the store and searches by name, description and tags.

## Validation

The harness validates the catalog and each manifest with the zod schemas from `@neosaider/contracts`. An invalid entry is left out of the store with a warning in the log, without breaking the rest. At install time it also checks that:

- the manifest's `id` and `version` match the catalog entry;
- the manifest's `sdk` range is compatible with the SDK version the harness supports;
- the container, once started, returns that same manifest from `GET /manifest`.

## Publishing a module

1. Build the module with [`@neosaider/module-sdk`](../packages/module-sdk/docs/CREATING-A-MODULE.md) and its manifest.
2. Publish the image to a registry reachable by whoever will install it (for example, `ghcr.io/<user>/neosaider-module-<id>:<version>`) and put that reference in the manifest's `image` field.
3. Copy the manifest and the README into the module's folder in the catalog repository, for example `<id>/<version>/`.
4. Add the version to `versions[]` in its `catalog.json` entry (or create the entry) and open a pull request.

A published version is never modified: to fix something, publish a new version. That way an existing installation can always download exactly what it installed.

## Development catalog

`modules/catalog.json` lists the monorepo's modules and points at their manifests inside `modules/<id>/`. Their images are local (`neosaider/module-<id>:<version>`) and are built with:

```sh
docker compose --profile modules build
```
