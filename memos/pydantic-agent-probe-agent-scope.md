# Task: sync probe to --agent scoping + add deploy-gate doc

## Goal

Follow-up to PR #70 (merged, squash 6a6d9a2). Two additive changes:

1. Sync `pydantic-agent-probe-py.template` + `pydantic-agent-probe-tests-py.template`
   to the latest reference (data-sourcing-agent main, PR #10, merge 94b5ed9),
   which adds repeatable `--agent NAME` / `only=` scoping. Rebuild
   `templates.generated.js`. Extend the generator test for the new symbols.
2. Add a deploy-gate paragraph to `deploy-readme.template` telling the operator
   to confirm the new agent is dialable with
   `python -m agent.probe --agent <agent-name>`.

## Reference (re-fetched, main @ 2026-10-05)

- `agent/probe.py` sha256 aa9ebf76c027eb0562901a564d3198a528ba039f963cffc1c87432c1a7ce310a (434 lines)
- `tests/test_probe.py` sha256 4192d841a98dc152c4983a4a61839df5d95376909accd1698e78379b9811edd1 (427 lines)

Pre-scoping SHA (what PR #70 shipped): probe a1f5fdde…, tests 224f7703….

## Progress log

- [x] Branched `feat/pydantic-agent-probe-agent-scope` off `origin/main` (06892cf)
- [x] Step 1: copied both reference files byte-for-byte, rebuilt
      templates.generated.js, extended generator test
- [x] Step 2: deploy-readme deploy-gate paragraph (rebuilt generated.js)
- [x] vitest run (870 passed) + prettier (clean) + eslint (0 errors)
- [x] PR #71 opened (REST via MCPHub raw github MCP; no GITHUB_TOKEN in env)

## Branch / commit / PR

- branch: feat/pydantic-agent-probe-agent-scope (off origin/main 06892cf)
- step1 commit: 0e181b5 (sync probe to --agent scoping)
- step2 commit: c5bbd9a (deploy gate doc)
- PR: **#71** — https://github.com/nickbrett1/genproj/pull/71 (open, base main)

## Note on PR creation

`$GITHUB_TOKEN` is not present in the environment and the git remote is SSH,
so the REST API could not be called with a token directly. As with PR #70, the
PR was opened through MCPHub's raw GitHub MCP server
(`http://nas:8781/mcp/github`, tool `create_pull_request`), which is authenticated
server-side and needs no local token.
