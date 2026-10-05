# Task: ship the host-side deploy gate into generated projects

## Goal

A generated `pydantic-agent` + `docker-container` project gets
`scripts/deploy-gate.sh` — a host-side script that brings the compose service up
and dials the just-deployed agent (`python -m agent.probe --agent <name>`),
failing the deploy when the agent is undialable/unreachable or its served card
disagrees with its registration. `deploy/README.md` §2 tells the operator to run
it after deploy, replacing the manual prose PR #71 added.

Reference: data-sourcing-agent **PR #12** (merge `9ad505f`), which added
`scripts/deploy-gate.sh` + a `deploy/README.md` section.
Fetched: https://raw.githubusercontent.com/nickbrett1/data-sourcing-agent/main/scripts/deploy-gate.sh

## Wiring decision (the honest cross-capability gate)

The script is attached to the **`pydantic-agent`** capability (it is that
agent's own probe, and `{{agentName}}` is the pydantic-agent placeholder), with
`when: (context) => context.capabilities.includes("docker-container")` so it is
emitted **only when the project actually has the probe AND a compose file**.

Note the assumption: `pydantic-agent` `requiresAny` a deployment capability and
today `docker-container` is the only one, so the `when` is currently always true
for a valid selection. It is still the right place to encode "probe + compose
file": if a second deployment capability is ever added (e.g. a non-compose one),
a pydantic-agent project on it will not get a `docker compose` script it cannot
run. The generator test asserts the predicate directly
(`true` with docker-container, `false` without) rather than generating an
invalid selection (which `generateAllFiles` refuses).

## What changed

- **new** `src/generator/templates/scripts-deploy-gate.sh.template`
  - copied from the reference; `AGENT_NAME` default templated to `{{agentName}}`
    (the pydantic-agent data generator sets `agentName = projectName`);
    `SERVICE` default `app`; `${VAR:-default}` (DEBIAN_FRONTEND-style) defaults
    for `AGENT_NAME`, `SERVICE`, `WAIT_SECONDS`, and an opt-in
    `LITELLM_MASTER_KEY` passthrough.
- `src/generator/capability-templates.js` — new `deploy-gate` descriptor under
  `pydantic-agent` (`scripts/deploy-gate.sh`, `isExecutable`, `when` above).
- `src/generator/file-generator.js` — bind + register `scripts-deploy-gate-sh`.
- `src/generator/capability-template-utils.js` — `deployGateSection` in the
  `docker-container` template data: the gate paragraph for a pydantic-agent
  project, empty otherwise (so a plain docker-container runbook never points at
  a script that is not there).
- `src/generator/templates/deploy-readme.template` §2 — the hand-written
  `python -m agent.probe --agent` prose is replaced by `{{deployGateSection}}`,
  which now instructs `./scripts/deploy-gate.sh`.
- `src/generator/templates.generated.js` — rebuilt (`npm run build:templates`,
  87 templates).
- `tests/generator/pydantic-agent.test.js` — new test pins emission, the
  `python -m agent.probe --agent` usage, `SERVICE="${SERVICE:-app}"`,
  `set -euo pipefail`, the templated `AGENT_NAME="${AGENT_NAME:-price-gate}"`
  (no `{{` left), the runbook pointer, the cross-capability `when`, and the
  absence (script + runbook mention) for a plain docker-container project.

## Verification

- `npx vitest run` — 871 passed (61 files)
- `prettier --check` — clean; `eslint` — 0 errors
- (`.sh` files get mode 100755 automatically via github-api's executable-bit
  commit, so no extra wiring for the executable bit.)

## Branch / commit / PR

- branch: `feat/pydantic-agent-deploy-gate` (off `origin/main` bd41163; PR #72
  confirmed **merged**, squash bd41163)
- commit: `ca38f39` (ship the host-side deploy gate)
- PR: **#73** — https://github.com/nickbrett1/genproj/pull/73 (open, base main)

## How the PR was created

No `$GITHUB_TOKEN`/`gh` in the environment and the remote is SSH, so the REST API
could not be used directly (as with #70–#72). Opened through MCPHub's raw GitHub
MCP server, authenticated server-side.
