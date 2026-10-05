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
- [ ] Step 2: deploy-readme deploy-gate paragraph
- [ ] vitest run + prettier
- [ ] PR

## Branch / commit / PR

- branch: feat/pydantic-agent-probe-agent-scope
- step1 commit: (filled below)
- PR: (filled below)
