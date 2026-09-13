# genproj

The genproj service: the capability catalog and project generator, extracted from
[`ftn`](https://github.com/nickbrett1/ftn) so that `ftn`'s UI can be a thin,
data-driven client of it.

The extraction runs in phases. This repository currently serves **phase 0**: the
read-only surface. Generation, the MCP server and the capability templates move
here in later phases.

## Endpoints

| Route                         | Auth | Description                                                            |
| ----------------------------- | ---- | ---------------------------------------------------------------------- |
| `GET /healthz`                | none | Liveness, service version and the catalog version.                     |
| `GET /v1/catalog`             | none | The capability catalog. `ETag` + `Cache-Control: public, max-age=300`. |
| `GET /v1/catalog/schema.json` | none | JSON Schema for the catalog.                                           |
| `GET /v1/version`             | none | Service version and catalog version.                                   |

The catalog is deliberately public — the UI renders it before anyone signs in.
_Generating_ code requires authentication, as it always has; that lives on the
`/v1/generate` route in a later phase.

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
`wrangler.jsonc` from `wrangler.template.jsonc`, runs `wrangler deploy`, then
syncs the project's Doppler secrets.

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
