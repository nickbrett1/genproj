# 018 — docker-container can attach to named external Docker networks

**Status: MERGED to `main` (2026-09-27).** Merged into `main` and pushed as a
**fast-forward** — no merge commit was created on `main`; no force-push and no
history rewrite.

- Pre-merge branch head: `f8f6b1b` (the head verified externally, build 194).
- `main` had **moved** since the branch was cut (branch base `5e49ec2`;
  `origin/main` had advanced to `c059e8b`, a dependabot dep-bump merge). Per the
  merge instruction the branch was **not merged while behind**: `origin/main`
  was merged _into the branch_ (merge commit `873c084`, clean — only
  `package.json` / `package-lock.json`) and the full suite was re-run green
  (819 passed / 60 files; lint 0 errors) before the merge to `main`.
- Merged `main` head: **`873c084817585b69944d3959c93aa76c4043d599`**.
- Push to the protected `main` succeeded; origin reported it _bypassed_ the
  required status check `buildkite/genproj` (the pushing identity has bypass
  rights). Branch protection was **not** disabled and no admin override was
  passed.
- Buildkite build **196** (`main`, `873c084`, the merge): **passed**. Both
  steps ran: `:hammer: Build and test (node)` (`build`) = passed, and
  `:rocket: Deploy (production)` (`deploy`) = passed (exit 0, `npx wrangler
deploy`), so the capability is **live** on the Worker.
- This status text was then committed to `main` as `719e2ff` (doc-only) — the
  final `main` head — triggering build **197** on `main`/`719e2ff`: also
  **passed**, `build` and `deploy` both green.
- **Live verification** against the deployed Worker (`POST /v1/preview`, a
  `docker-container` + `devcontainer-python` project): with
  `externalNetworks: ["ai_proxy"]` the emitted `docker-compose.yml` contains the
  service-level `networks: [ai_proxy]` plus the top-level `networks:` block with
  `external: true`; with the field absent the compose is **byte-identical**
  (1146 bytes) to the pre-feature baseline.

The branch `feat/docker-container-external-networks` is also pushed at
`873c084`. (Original note: implemented 2026-09-27; no PR was used — this
container has no `gh` and no GitHub token, so `git push` over SSH was the
mechanism.)

**Tests:** `npx vitest run --coverage` — 819 passed / 60 files (includes 15 new
in `tests/generator/docker-external-networks.test.js` and 1 new pin in
`tests/catalog.test.js`); coverage statements 92.66 / functions 93.22 /
lines 92.86 / branches 82.92, all above the gates. `npm run lint` — 0 errors.
Byte-identity for the empty case was also checked by diffing generated output
before and after the change (compose and README both identical).

**Cross-references:** `specs/003-genproj-docker-container/spec.md` (the
`docker-container` capability this extends), `specs/014-...` and
`specs/015-...` (the other recent `docker-container` defect records; this is a
feature gap, not a defect).

## Problem

`docker-container` emits a `docker-compose.yml` with no `networks:` key at
all, and its `configurationSchema` has no field for one. A generated container
therefore cannot join a **pre-existing external Docker network**.

Concrete motivating case (verified against the deployed Worker with a
side-effect-free `POST /v1/preview`): a NAS-hosted project
(`databento-discovery-mcp`) must join the existing `ai_proxy` network because
MCPHub reaches sibling MCP servers **by container name** on it
(`http://catalog-mcp:PORT/mcp`). Without membership the service is unreachable
and every NAS deploy needs a hand-edit to `docker-compose.yml`.

`networkMode` is only `bridge`/`host`, and `host` is **not** a substitute: host
mode drops `ports:` entirely and provides no name resolution on `ai_proxy`.

## Decision — field name

**`externalNetworks`**, an array of strings, default `[]`
(matching the shape the requester suggested and the naming of the existing
`dataMounts` / `aptPackages` / `envVars` array fields):

```jsonc
"externalNetworks": { "type": "array", "items": { "type": "string" }, "default": [] }
```

The array's **declared order is preserved** in the emitted list, because
attachment order is meaningful to Docker (it affects the container's default
route / DNS resolution order across networks). Emission is a pure function of
the selected capability set + configuration; nothing here depends on caller
selection order.

Expected emission when non-empty (a service-level attachment plus a top-level
declaration, `external: true` so Compose never tries to create the network):

```yaml
services:
  app:
    networks:
      - ai_proxy
networks:
  ai_proxy:
    external: true
```

## Decision — `networkMode: host` interaction

**Rejected as invalid configuration**, loudly, at generation time.

`docker compose` rejects a service that sets both `network_mode:` and
`networks:`. The alternative — silently suppressing the `networks:` emission
when `networkMode: host` — would leave a project that _looks_ like it joins
`ai_proxy` while the generated compose quietly does not, which is exactly the
"looks fine and is silently wrong" failure the generation guards in
`src/generator/project-validation.js` exist to prevent. So this is a new guard,
`validateDockerNetworks`, alongside `validatePrimaryLanguage` and friends:

- `docker-container` selected **and** `networkMode === "host"` **and**
  `externalNetworks` non-empty → `ValidationError` naming the conflict and the
  fix (drop the external networks, or use `networkMode: bridge`).

Defence in depth: the template-data builder also treats `externalNetworks` as
empty whenever `networkMode === "host"`, so even a path that bypasses the
guards (e.g. an unauthenticated preview, which does not run the guards) can
never emit a compose file containing both keys.

## Strictly additive / byte-identity

With the default (empty array) the emitted `docker-compose.yml` is
**byte-identical** to before this change: no `networks:` key, no empty
mapping, no extra blank line. This is pinned by a regression test that
generates one project with no `externalNetworks` key and one with an explicit
`[]`, and asserts the two compose strings are equal (and contain no
`networks:`).

The single new template placeholder (`{{composeNetworks}}`) is appended after
`{{composeLabels}}` and renders to `""` in the default case, so the composer's
existing `normalizeYamlBlankLines` trailing-newline trim keeps the output
identical. The deploy README's new token is likewise inline and empty by
default, so `deploy/README.md` is also byte-identical for the empty case.

## deploy/README.md

Section 6 ("Networking notes") gains a bullet when `externalNetworks` is
non-empty, naming the network(s) and stating the consequence explicitly:
**`docker-compose.yml` is generated — a network block added by hand is
overwritten on regeneration; declare external networks with the
`externalNetworks` configuration instead.**

## What changed (implemented)

- `src/catalog/catalog.json` — `docker-container.configurationSchema` gains
  `externalNetworks` (array of strings, default `[]`).
- `specs/003-genproj-docker-container/contracts/docker-container.capability.json`
  — same field, kept in step with the source of truth (this third copy is
  otherwise already drifted; see spec 014).
- `src/generator/capability-template-utils.js` — `getDockerContainerTemplateData`
  builds `composeNetworks` (service attachment + top-level declaration, or `""`)
  and `externalNetworksDocs` (README bullet, or `""`); host mode suppresses both.
- `src/generator/templates/docker-compose.template` — `{{composeNetworks}}`.
- `src/generator/templates/deploy-readme.template` — `{{externalNetworksDocs}}`.
- `src/generator/project-validation.js` — `validateDockerNetworks` guard.
- `src/generator/file-generator.js` — `generateAllFiles` runs the new guard.
- `src/generator/templates.generated.js` — regenerated
  (`npm run build:templates`).
- Tests in `tests/generator/docker-external-networks.test.js` (byte-identity,
  emission + YAML validity, multiple networks, host rejection, template-data
  suppression, README documentation).

## Verification

- Unit tests green (see the PR / commit for the run).
- The requester can re-run `POST /v1/preview` against the deployed Worker once
  the merge auto-deploys, to confirm end-to-end.
