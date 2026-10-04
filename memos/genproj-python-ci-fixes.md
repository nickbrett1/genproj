# Memo: fresh Python projects must pass their own first CI build

Status: proposed (PR open). Author: goose. Date: 2026-10-04.
Trigger: generated project `nas-reach-mcp` (2026-10-04) failed Buildkite build 1
and build 2; build 3 passed only after two manual fixes.

## Reproduction given

Capabilities: coding-agents, container-agent, devcontainer-python,
docker-container, buildkite, doppler, code-quality-python, dependabot.
language=python. docker-container.pythonDependencies =
["mcp>=1.2.0", "mcpo>=0.1.0", "httpx>=0.27.0"].

Exact CI sequence from the generated `.buildkite/pipeline.yml`
(`capability-template-utils.js` python step list, lines ~2883-2901):

1. `python -m pip install --no-cache-dir -e ".[dev]"`
2. `python -m pip install --no-cache-dir build`
3. `python -m build`
4. `ruff check src tests`
5. `pytest -q`

## Defect 1 — unsatisfiable documented example (`mcpo>=0.1.0`)

CONFIRMED. `mcpo` latest on PyPI is 0.0.20; there is no 0.1.x. The stale
specifier comes from genproj's own documentation example, which the user
copied into `pythonDependencies`:

- `src/catalog/catalog.json` (pythonDependencies description)
- `src/generator/templates/deploy-readme.template` (section 8)
- plus the same string is used as the fixture/assertion in
  `tests/generator/file-generator-python.test.js`.

genproj emits `pythonDependencies` verbatim, so it cannot "correct" user input,
but it must not document an unsatisfiable example. Fix = correct the documented
example everywhere to `mcpo>=0.0.20`.

## Defect 2 — non-deterministic ruff rule set

CONFIRMED, with a correction to the originally proposed remedy.

The generated `[tool.ruff]` set neither `target-version` nor `select`, so both
the target level and the enabled rule set were _inferred_, and the inference
depended on the surrounding config. Measured with ruff 0.16.10, reconciled
across both accounts:

```text
requires-python = ">=3.11"  -> UP017 fires (1 finding)
requires-python = ">=3.9"   -> UP017 does not fire
no pyproject at all         -> UP017 does not fire
```

ruff infers `target-version` from `requires-python`, and UP017 fires only when
the inferred version is >= 3.11. So **pinning `target-version = "py311"` alone
does not remove UP017** — it only makes the trigger explicit; the rule still
fires. That was the correction to the first proposed remedy. What actually made
behaviour non-deterministic was the _inference_, which flipped depending on
whether a pyproject was present. An explicit `select` is what freezes the rule
set; the durable fix therefore writes **both** `target-version = "py311"` (to
match `requires-python = ">=3.11"`) and an explicit `select`.

### Intended outcome (state plainly; not a regression)

The explicit `select` keeps the linting strength CI already applied, so local
lint now agrees with CI. A generated project whose author writes
`datetime.timezone.utc` will now fail `ruff check` **locally, in exactly the way
it fails in CI**. That is the intended outcome — the two environments agree —
and it must not be read as "this problem is now impossible": it is still a
finding, it is simply a _reproducible_ one.

## Durable fix — end-to-end check

`scripts/verify-generated-python-e2e.mjs` generates a project and runs the exact
5-command CI sequence in the generated directory (pyproject.toml PRESENT, real
PyPI resolution). Wired as `npm run test:e2e:python`.

## CI wiring (revised — the guard is now enforced)

An earlier draft left this unwired. That was wrong: the exact defect here is one
where a change shipped an unsatisfiable dependency specifier with nothing
catching it, so a guard that only runs when someone remembers the command is not
a guard. Implemented as **`.github/workflows/python-e2e.yml`**:

- **nightly** (`cron: "17 3 * * *"`) — catches e.g. a dependency being yanked
  from PyPI, independently of any change in this repo;
- **on push/PR touching `src/catalog/**`, `src/generator/**`,
  `scripts/verify-generated-python-e2e.mjs`, `package.json`** (plus
  `workflow_dispatch`).

Why GitHub Actions and not the Buildkite pipeline: this repository's
`.buildkite/pipeline.yml` is generated from `buildkite-pipeline.template` plus
the selected capabilities, and Buildkite's `if_changed` is an _agent-applied_
attribute that only takes effect when the agent uploads the pipeline — it does
not apply to a statically configured pipeline. Actions' native `schedule:` +
`paths:` filters express the floor directly and durably, and keep the generated
pipeline untouched.

Known limitation: GitHub pauses `schedule:` workflows in a repository after 60
days without activity, so the nightly leg can go quiet on an idle repo; the
path-triggered leg is unaffected. Re-enabling is a one-click action in the
Actions tab.

## Verification

Unit suite: `npx vitest run` -> **849 passed (61 files)**. `npm run lint` -> 0
errors.

End-to-end, using the real CI sequence and real PyPI resolution (re-run against
this tree while writing the PR):

```text
$ python -m pip install --no-cache-dir -e ".[dev]"   OK
$ python -m pip install --no-cache-dir build         OK
$ python -m build                                     OK (wheel + sdist)
$ python -m ruff check src tests                      All checks passed!
$ python -m pytest -q                                 1 passed
✓ generated Python project passed its own CI sequence.
```

The check also demonstrably catches Defect 1: with
`GENPROJ_E2E_DEPS='["mcpo>=0.1.0"]'` it fails exactly like build 1
(`No matching distribution found for mcpo>=0.1.0; from versions: ... 0.0.20`),
and it asserts the generated `pyproject.toml` pins both `[tool.ruff]
target-version` and `[tool.ruff.lint] select`.

## Deliberately left undone

- **No PyPI satisfiability validation of user-supplied `pythonDependencies` at
  generation time.** genproj emits the config verbatim; a network check on
  every generate (or preview) is a larger, slower change than this defect
  warrants. The e2e check is the guard instead.
- **Did not pin `mcp<2`.** The python template's `mainPy` is a stub that prints
  `"{__package__} is installed and importable."` and returns 0, and
  `file-generator.js` contains zero occurrences of `fastmcp`, `mcp.server`,
  `FastMCP` or `MCPServer`. Generated Python code never touches the MCP SDK, so
  the v2 `FastMCP` -> `MCPServer` rename cannot break a generated project. It is
  a trap for whoever writes the app, not a genproj bug — a docs note at most.
- **Did not touch the MicroPython ruff config** — it already pins
  `target-version = "py37"` (spec 009/010).

## Files changed

- `src/generator/file-generator.js` — generated `[tool.ruff]` now pins
  `target-version = "py311"` and an explicit `[tool.ruff.lint] select`.
- `src/catalog/catalog.json` — `pythonDependencies` example fixed to
  `mcpo>=0.0.20` (+ note that specifiers must exist on PyPI).
- `src/generator/templates/deploy-readme.template` — example fixed
  (`templates.generated.js` rebuilt).
- `tests/generator/file-generator-python.test.js` — fixture/assertion fixed +
  new determinism assertion.
- `scripts/verify-generated-python-e2e.mjs` — new end-to-end check.
- `package.json` — `test:e2e:python` script.
- `.github/workflows/python-e2e.yml` — nightly + path-triggered CI wiring.
