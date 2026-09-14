# genproj

Turns a set of selected capabilities into a working repository — the files, the
devcontainer, the CI pipeline, the Doppler wiring, and the external services the
project needs.

Two halves, deliberately separate. A **catalog** describes what can be generated
and is public data any client can render. A **generator** turns a selection from
that catalog into files and side effects, and is a service, not a library.

## Endpoints

| Route                         | Auth   | Description                                                   |
| ----------------------------- | ------ | ------------------------------------------------------------- |
| `GET /healthz`                | none   | Liveness and the service version.                             |
| `GET /v1/catalog`             | none   | The capability catalog. `Cache-Control: public, max-age=300`. |
| `GET /v1/catalog/schema.json` | none   | JSON Schema for the catalog.                                  |
| `GET /v1/version`             | none   | Service version.                                              |
| `POST /v1/preview`            | none   | Preview the files a configuration would generate.             |
| `POST /v1/generate`           | secret | Create or update a repository.                                |
| `POST /v1/conflicts`          | secret | Report files that would conflict with existing ones.          |
| `POST /mcp`                   | PAT    | MCP server: `list_genproj_capabilities`, `generate_project`.  |

The catalog is deliberately public: it is what a UI renders before anyone signs
in. Preview is public too — it renders the same file set generation would
produce without touching GitHub or any external service.

The catalog is bundled into the Worker, so changing it means a deploy.
`/v1/catalog` is served with a short shared cache and no validator: a client that
wants to know whether its copy is stale re-fetches it. There is no catalog
version to compare against.

## How callers are trusted

Two boundaries, two mechanisms, and they do not overlap.

- **A server calling on a user's behalf** presents a shared secret in
  `x-service-secret`. Calls like this arrive over a Cloudflare service binding,
  which is an internal handle rather than a network address — and this Worker
  also has a public host, so the secret is what distinguishes a trusted caller
  from the internet. `x-user-email`, when present, is a label for logs and never
  authorises anything.
- **An MCP client** speaks to `POST /mcp` directly over the internet, with no
  intermediary to vouch for it, so it identifies itself with a personal access
  token in `Authorization: Bearer …` (or `X-API-Key`). Tokens are validated
  against the `API_KEYS_DB` D1 database, which is the same store the
  `/api-keys` page in the front-end issues from: one store, two consumers.

Preview is the deliberate exception — it needs no credential because it produces
nothing and touches nothing outside the process.

## The catalog

`src/catalog/catalog.json` is the single source of truth for what the generator
can apply, and it is what a UI renders. `src/catalog/schema.json` documents the
shape and `tests/catalog.test.js` pins the capability set, so any change to it is
deliberate.

Three fields exist so that clients do not have to hardcode behaviour:

- `selectedByDefault` — which capabilities are pre-selected.
- `authServices` — which external services a capability needs credentials for.
- `provides` — what a capability implies downstream, such as a language runtime.

## The generator

`src/generator/` holds the generator core:

- `file-generator.js` — the template engine and the per-capability file builders.
- `capability-template-utils.js` — the template data builders (`{{key}}` values).
- `capability-resolver.js` — dependency, conflict and ordering resolution.
- `preview-generator.js` — assembles the file tree and external-service changes.
- `genproj-errors.js`, `genproj-overwrite.js` — error types and merge policy.

Wiring a capability to the files it emits lives in
`src/generator/capability-templates.js`, not in the catalog, so the public
catalog stays free of file paths.

Templates live in `src/generator/templates/`. Workers bundle with esbuild, which
has no equivalent of Vite's `?raw` import suffix, so
`scripts/build-templates.mjs` materialises them into
`src/generator/templates.generated.js` — committed, and rebuilt on
`pretest`/`prebuild`.

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

CI is Buildkite (`.buildkite/pipeline.yml`): build and test on every push, deploy
to production on `main`. The deploy step resolves the Cloudflare credentials from
Doppler, generates `wrangler.jsonc` from `wrangler.template.jsonc`, **syncs the
project's Doppler secrets, and only then runs `wrangler deploy`**.

That order matters. `sync-doppler-secrets.sh` uses `wrangler versions secret
bulk`, which creates a new version carrying the secrets without putting it on
production traffic; `wrangler deploy` carries the current version's bindings
forward (`keep_vars` defaults to true), so it is what actually puts them live.
Syncing afterwards strands the secrets in a version nobody serves, the step still
reports success, and the Worker keeps running without them.

## Doppler

Secrets come from the `genproj` Doppler project:

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
