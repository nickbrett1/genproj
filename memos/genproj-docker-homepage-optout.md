# Memo: the Homepage integration is opt-out end to end

Status: PR open. Author: goose. Date: 2026-10-11.
Branch: `fix/docker-homepage-optout`, cut from `main` @ `4e7ebd4`.

## Context — the toggle already existed, half-wired

The `docker-container` capability already had a `homepage` boolean (default
`true`, `config.homepage !== false`). It already dropped the `homepage.*`
container labels from `docker-compose.yml` when set false. So the premise
"unconditionally emits homepage.* labels" was not accurate for the labels.

What was **not** covered by the toggle:

- **`deploy/homepage-services.yaml` was emitted unconditionally** — with its
  full `widget:` block — even at `homepage: false`. So opting out dropped the
  labels but still emitted a Homepage artifact.
- **No test** pinned the opt-out at all.
- **Not documented** as the opt-out (catalog had a bare `{"type":"boolean",
"default":true}`).

Why the opt-out matters on this estate: Homepage _prepends_ label-discovered
services and cannot sort them alphabetically, so the generated service renders
icon-less and out of order, while every other MCP server is a manual
`services.yaml` entry. `homepage: false` is the escape hatch.

## Fix

- `src/generator/capability-templates.js` — the `homepage-snippet` descriptor
  gains a `when(context)` predicate (`homepage !== false`). The `when` hook and
  its "descriptor without one is emitted exactly as before" contract already
  existed in `collectSingleTemplateFile`, so no engine change was needed.
- `src/generator/capability-template-utils.js` — the generated deploy README's
  §5 is now a `homepageDashboard` variable: it tells the reader to append the
  snippet when enabled, and states the opt-out (and that neither the labels nor
  the snippet were generated) when disabled. The README must not point at a file
  that does not exist.
- `src/catalog/catalog.json` — the `homepage` property is documented as the
  opt-out (labels **and** snippet).
- `src/generator/templates/deploy-readme.template` (+ rebuilt
  `templates.generated.js`) — §5 templated.
- `tests/generator/docker-homepage-optout.test.js` — new: default and explicit
  `true` emit labels + snippet; `false` emits **no** `homepage.*` label and
  **no** `deploy/homepage-services.yaml`; watchtower labels survive.

## Verification

- `npx vitest run` -> **875 passed (62 files)**.
- `npm run lint` -> 0 errors.
- `npm run build:templates` -> only the deploy-readme entry changed.

## Scope

Follow-up to PR #77. No new config option was added — `homepage: false` was
already the shape; this PR makes it complete and tested.
