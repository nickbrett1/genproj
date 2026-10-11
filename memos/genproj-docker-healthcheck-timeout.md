# Memo: the generated Docker HEALTHCHECK timeout must be configurable

Status: PR open. Author: goose. Date: 2026-10-11.
Branch: `fix/docker-healthcheck-timeout`, cut from `main` @ `4e7ebd4`.

## Defect

Every `docker-container` HEALTHCHECK emitter site hardcoded `--timeout=3s`:

- node images: `HEALTHCHECK ... CMD node -e "fetch(...)"`;
- non-node http: `HEALTHCHECK ... CMD curl -fsS ...`;
- `command:` healthchecks: `HEALTHCHECK ... CMD <cmd>`.

3s is too tight for a health endpoint that does real work behind the request.
A ported service (`notes-mcp`) failed its own generated smoke step and the
container restart-looped until the timeout was hand-loosened to 10s **in the
generated Dockerfile** — i.e. a fix that the next generation would erase.

## Fix — `healthcheckTimeout`, split default

New `docker-container` config key `healthcheckTimeout` (a duration string,
e.g. `"10s"`), threaded through all three emitter sites. Defaults are split by
probe type:

| Probe           | Default          | Why                                          |
| --------------- | ---------------- | -------------------------------------------- |
| `http:<path>`   | `10s`            | the app does real work behind the request    |
| `command:<cmd>` | `3s` (unchanged) | a local process; the old value was fine here |

An explicit `healthcheckTimeout` overrides both. (Shape note: `healthcheck` is
itself a string, e.g. `http:/healthz`, so the timeout is a sibling scalar, not
a nested object under `healthcheck`.)

## Files changed

- `src/generator/capability-template-utils.js` — resolves `healthcheckTimeout`
  (split default) and interpolates it into all three HEALTHCHECK sites.
- `src/catalog/catalog.json` — new `healthcheckTimeout` property + description.
- `src/generator/templates/deploy-readme.template` (+ rebuilt
  `templates.generated.js`) — documents the key in §8.
- `tests/generator/docker-healthcheck-timeout.test.js` — new: pins the http 10s
  default on both the node `fetch` and curl sites, the command 3s default, and
  an explicit override on each.

## Verification

- `npx vitest run` -> **876 passed**.
- `npm run lint` -> 0 errors.
- `npm run build:templates` -> only the deploy-readme entry changed.

## Scope

Independent follow-up to PR #76 (Python image fixes). Carries only the timeout
change and its test/doc/memo. The homepage opt-out change is a separate PR.
