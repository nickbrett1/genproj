# Task: re-sync probe to cold-registry retry (data-sourcing-agent PR #11)

## Goal

Follow-up to PR #71 (merged, squash 0458003). Re-fetch the latest reference
`agent/probe.py` + `tests/test_probe.py` and byte-copy into the two templates,
rebuild `templates.generated.js`, extend the generator test for the new symbols,
run vitest + prettier, open the PR.

## Reference (re-fetched, data-sourcing-agent main @ 2026-10-05, PR #11 merge 37da432)

- `agent/probe.py` sha256 21cf18ee04e2852e29b06c77ecef921a2748a9cd924e81e521d32d44311669f1 (466 lines)
- `tests/test_probe.py` sha256 cf9b8f8ee8e421328bd2343bd94ad6fb45880695bc9b369c9e590736d0aa7372 (468 lines)

Pre-sync (what PR #71 shipped): probe aa9ebf76… (434 lines), tests 4192d841… (427 lines).

Change: the registry read moves into a new `_read_registry` helper with a
dedicated `REGISTRY_TIMEOUT = 15.0` and `REGISTRY_ATTEMPTS = 2`, retrying a cold
proxy's slow first `GET /v1/agents` once; per-card dials stay short.

## Branch / PR

- PR #71 confirmed **MERGED** (squash 0458003 on origin/main), so this re-sync
  gets a fresh branch off origin/main.
- branch: `feat/pydantic-agent-probe-cold-registry` (off origin/main 0458003)
- step1 commit: 3fae86e (sync probe to cold-registry retry)
- PR: **#72** — https://github.com/nickbrett1/genproj/pull/72 (open, base main,
  head sha a746ebb)

## Progress log

- [x] Fetched both reference files; confirmed diff matches PR #11 description
- [x] Byte-copied into `pydantic-agent-probe-py.template` + `-tests-py.template`
      (verified byte-identical via cmp)
- [x] Rebuilt `templates.generated.js` (`npm run build:templates`, 86 templates)
- [x] Extended generator test: `_read_registry`, `REGISTRY_TIMEOUT`,
      `test_probe_retries_a_cold_registry_read`
- [x] vitest run (870 passed) + prettier (clean) + eslint (0 errors)
- [x] PR #72 opened (MCPHub raw GitHub MCP, `create_pull_request`)

## How the PR was created

No `$GITHUB_TOKEN`/`gh` in the environment and the remote is SSH, so the REST
API could not be used directly. As with #70/#71, the PR was opened through
MCPHub's raw GitHub MCP server (`http://nas:8781/mcp/github`, tool
`github-create_pull_request`), authenticated server-side.
