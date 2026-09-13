# genproj

The genproj service: the capability catalog and project generator, extracted from
[`ftn`](https://github.com/nickbrett1/ftn) so that `ftn`'s UI can be a thin,
data-driven client of it.

The extraction runs in phases. This repository currently serves the catalog
surface, project generation, the conflict check and its own MCP server. `ftn` no
longer generates projects; its `preview`, `generate` and `conflicts` routes proxy
here over a Cloudflare service binding. What remains is deleting the generator
from `ftn`.

## Endpoints

| Route                         | Auth   | Description                                                            |
| ----------------------------- | ------ | ---------------------------------------------------------------------- |
| `GET /healthz`                | none   | Liveness, service version and the catalog version.                     |
| `GET /v1/catalog`             | none   | The capability catalog. `ETag` + `Cache-Control: public, max-age=300`. |
| `GET /v1/catalog/schema.json` | none   | JSON Schema for the catalog.                                           |
| `GET /v1/version`             | none   | Service version and catalog version.                                   |
| `POST /v1/preview`            | none   | Preview the files a configuration would generate.                      |
| `POST /v1/generate`           | secret | Create or update a repository.                                         |
| `POST /v1/conflicts`          | secret | Report files that would conflict with existing ones.                   |
| `POST /mcp`                   | PAT    | MCP server: `list_genproj_capabilities`, `generate_project`.           |

The catalog is deliberately public — the UI renders it before anyone signs in.
Preview is public too: it renders the same file set generation would produce
without touching GitHub or any external service.

There are two different callers, authenticated two different ways:

- **`ftn`**, proxying a signed-in user's request, presents a shared secret
  (`x-service-secret`). A service binding is an internal handle rather than a
  network address, and this Worker also has a public host, so the secret is what
  distinguishes a call from `ftn` from a call from the internet.
- **An MCP client** speaks to `POST /mcp` directly, with a personal access token
  in `Authorization: Bearer …` (or `X-API-Key`). It has no `ftn` in the path to
  vouch for it, so it identifies itself. The tokens are the `pat_…` values the
  `ftn` `/api-keys` UI issues, validated against the shared `API_KEYS_DB`
  database — one store, two consumers, no second source of truth.

`catalogVersion` is a content hash of the capability list, so a client can tell
whether its cached copy is stale. `/v1/catalog` returns it as a strong `ETag` and
answers `304 Not Modified` to `If-None-Match`.

## The catalog

`src/catalog/catalog.json` is the single source of truth for the capabilities the
generator can apply, and it is what the UI renders. It was ported from `ftn`'s
`webapp/src/lib/config/capabilities.js` — metadata only; the server-side
`templates[]`/`templateId` entries belong to the generator and move here with it.

Three fields exist to replace hardcodes that used to live in the UI:

- `selectedByDefault` — previously the UI's `category === 'core'` check.
- `authServices` — previously a bespoke auth-service lookup map.
- `provides` — previously a hardcoded devcontainer → SonarCloud language mapping.

`src/catalog/schema.json` documents the shape; `tests/catalog.test.js` pins the
capability set so any change to it is deliberate.

## The generator

`src/generator/` holds the generator core, moved verbatim from `ftn`'s
`webapp/src/lib/{utils,server}`:

- `file-generator.js` — the template engine and the per-capability file builders.
- `capability-template-utils.js` — the template data builders (`{{key}}` values).
- `capability-resolver.js` — dependency, conflict and ordering resolution.
- `preview-generator.js` — assembles the file tree and external-service changes.
- `genproj-errors.js`, `genproj-overwrite.js` — error types and merge policy.

Templates live in `src/generator/templates/`. `ftn` inlined them with Vite's
`?raw` import suffix; Workers bundle with esbuild, so `scripts/build-templates.mjs`
materialises them into `src/generator/templates.generated.js`, which is committed
and rebuilt on `pretest`/`prebuild`.

Two former disagreements with `ftn` are resolved here:

- The generator used to resolve dependencies against a **second, stale registry**
  (`utils/capabilities.js`) whose IDs no longer matched the catalog, so dependency
  and conflict resolution silently did nothing for most capabilities.
  `capability-resolver.js` now resolves against the catalog itself.
- The capability → template wiring that lived alongside the metadata in
  `config/capabilities.js` moved to `src/generator/capability-templates.js`, so
  the public catalog stays free of file paths.

## Development

```bash
npm install
npm run dev          # wrangler dev
npm test             # vitest, with coverage gates (statements/functions/lines 80%, branches 75%)
npm run lint         # prettier --check && eslint
./scripts/cloud_login.sh          # authenticate Cloudflare + Doppler
./scripts/setup-wrangler-config.sh dev   # wrangler.template.jsonc -> wrangler.jsonc
```

## Deployment

CI is Buildkite (`.buildkite/pipeline.yml`), triggered by a GitHub webhook: build
and test on every push, and deploy to production on `main`. The deploy step
resolves the Cloudflare credentials from Doppler (`common`/`dev`), generates
`wrangler.jsonc` from `wrangler.template.jsonc`, **syncs the project's Doppler
secrets, and only then runs `wrangler deploy`**.

That order matters. `sync-doppler-secrets.sh` uses `wrangler versions secret
bulk`, which creates a new version carrying the secrets without putting it on
production traffic; `wrangler deploy` carries the current version's bindings
forward (`keep_vars` defaults to true), so it is what actually puts them live.
Syncing afterwards strands the secrets in a version nobody serves, the step
still reports success, and the Worker keeps running without them.

## Doppler

This project uses Doppler for secrets in its own `genproj` project:

```bash
doppler setup --project genproj --config dev
```

If the project does not exist in your Doppler workplace yet, create it first:

```bash
doppler projects create genproj
doppler configs create dev --project genproj
```

### Env-var precedence (read this if `doppler run` hits the wrong project)

Doppler resolves its target as **environment variables > `doppler.yaml` >
`~/.doppler` scoped config**. If your shell — or the session that launched the
devcontainer (e.g. an agent runtime) — exports `DOPPLER_PROJECT` /
`DOPPLER_CONFIG` / `DOPPLER_ENVIRONMENT`, those silently override this repo's
`doppler.yaml` and every `doppler` command targets the wrong project. The
devcontainer's post-create setup pins this repo's context (`genproj`/`dev`) in
`~/.bashrc` and `~/.zshrc` and warns at setup if resolution still mismatches. To
force the correct context manually:

```bash
unset DOPPLER_PROJECT DOPPLER_CONFIG DOPPLER_ENVIRONMENT
doppler setup --no-interactive --project genproj --config dev
```
