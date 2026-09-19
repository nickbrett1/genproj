# 009 — MicroPython firmware layout and the ruff target

**Status:** implemented and verified (2026-09-19). Commit
`5e56050` in this repo; regenerated repo
[`nickbrett1/galactic-unicorn`](https://github.com/nickbrett1/galactic-unicorn)
at commit `c58eb7a`.

This is a defect record, not a forward design: it writes down what the
`micropython` + `code-quality-python` capability pair got wrong, what the fix
is, and how it was verified, so the reasoning survives the code.

## Why

Two defects, both silent, were found by generating a real project
(`galactic-unicorn`, a Pimoroni Galactic Unicorn / RP2040 firmware repo driven
over `mpremote`) and reading what landed. The USB passthrough machinery
(cgroup-rule grant, dialout usermod, probing `find-board.sh`) was correct; the
problems were the Python-tooling capability disagreeing with the firmware
layout. A third, cosmetic defect was in the README.

The class of bug matters beyond one project: genproj's promise is that its
output is _known-working on first generation_. A linter that reports success
while linting nothing, and a syntax target that describes the wrong runtime,
both violate that promise without ever failing loudly.

## Defect 1 — layout collision: ruff linted none of the firmware

`code-quality-python` scaffolded a `src/`-layout host package
(`src/<pkg>/__init__.py`, `tests/test_smoke.py`) and emitted
`[tool.ruff] src = ["src", "tests"]`, while the CI/README command was
`ruff check src tests`.

MicroPython resolves modules from the filesystem root and `lib/` (which is on
the board's `sys.path`); nothing is imported from `src/`. So the firmware sits
at the repository root, outside `src/`, and `ruff check src tests` reported
green over an empty tree while none of the firmware was linted. A silently
green linter is worse than no linter.

**Decision (the two agree by construction):** `micropython` now gets its own
scaffold instead of a mutated host-package one:

- firmware at the root (`main.py`, `config.py`) plus a `lib/` for importable
  modules (`lib/example.py`);
- `ruff check .` as the lint command, so ruff follows the firmware wherever it
  is (`src/` and `tests/` too, for a host project);
- `[tool.ruff] src = [".", "lib"]` — ruff's `src` is only its first-party
  import resolver, not the set of files it checks, so pointing it at the root
  and `lib/` makes `import config` / `from example import ...` resolve as
  first-party.

The failure mode — "lint passes, firmware unlinted" — is gone: the lint command
covers the whole repository and the layout has no `src/` to hide in.

## Defect 2 — ruff targeted the container's Python, not the device's

The generated `pyproject.toml` said `requires-python = ">=3.11"` (the
devcontainer image) and set no `[tool.ruff] target-version`, so ruff linted
against the container's interpreter. The board runs **MicroPython 1.19.1**
(roughly CPython 3.4-era), so ruff would bless syntax the board cannot parse —
f-strings, walrus, `match`, positional-only parameters.

**`requires-python` and `target-version` mean different things, and here they
diverge:**

- `requires-python` describes the interpreter required to install/run the
  _distribution_. The firmware is not a host package — it is flashed to a
  board — so the claim was simply false for this project. The firmware
  `pyproject.toml` therefore **omits `requires-python`**. (The file still
  exists so `pip install -e ".[dev]"` installs the lint tooling into the
  devcontainer; `[tool.setuptools] packages = []` deliberately packages
  nothing, while `ruff` ships in the `dev` extra.)
- `target-version` describes the language the _linter_ should accept. That is
  the board's language, not the host's, so it is set explicitly:
  `target-version = "py37"`.

`py37` is ruff's **lowest** supported target and therefore a floor, not a
match: it rejects 3.8+ syntax (walrus, positional-only params, `match`) but
still accepts 3.5–3.7 constructs (f-strings, `async`/`await`, variable
annotations) the board may not parse. The generated README states that
residual gap explicitly (section "Linting firmware") rather than hiding it
behind a value that merely looks right.

## Defect 3 — README promised CI that was never selected

The README renders each selected capability's catalog `description`. The
`code-quality-python` description claimed "the CI test job runs
`ruff check src tests`". No CI capability (`buildkite`, `circleci`) was
selected for `galactic-unicorn`, so there was no CI test job.

**Fix:** the catalog description is now conditional — "Lint locally with
`ruff check` — and in CI when a CI capability is also selected" — and the
benefit no longer says "in CI". This is the single source of truth, so it
propagates to the README and any other surface that renders it.

## Related fixes made while in here

These are not one of the three defects but are part of making the pair
known-working:

- **CircleCI no longer emits a host `pytest -v` step for firmware.** A
  MicroPython project has no host test suite; `pytest -v` over an empty tree
  exits 5 ("no tests ran") and fails a build that has nothing wrong with it.
  The Buildkite pipeline already dropped it (and `python -m build`, which has
  no wheel to produce), so CircleCI now matches.
- **Root firmware is app-owned in the overwrite policy.** The new scaffold
  writes `main.py`, `config.py` and `lib/` at the repository root, which the
  `src/`/`tests/`/`scripts/`/`worker/`/`app/` prefix list did not cover, so a
  regeneration would have treated the owner's firmware as replaceable infra
  and clobbered it with the placeholder. `main.py`, `config.py` and `lib/` are
  now app-owned, so a diverged firmware file is preserved on regeneration.

## Verification

### Unit tests (genproj)

- `tests/generator/micropython.test.js` — the scaffold emits
  `pyproject.toml`, `main.py`, `config.py`, `lib/example.py` and **no**
  `src/`/`tests/`; ruff config is `src = [".", "lib"]` and
  `target-version = "py37"`; `requires-python` is gone; the README contains
  the "Linting firmware" section and no "CI test job"; a MicroPython CircleCI
  config has `ruff check .` and no `pytest -v`; a host Python project is
  unchanged (`src/` layout, `requires-python = ">=3.11"`).
- `tests/generator/genproj-overwrite.test.js` — `main.py`, `config.py` and
  `lib/example.py` are app-owned.

Full suite: `npx vitest run` → **632 passed, 4 failed**. The 4 failures are
pre-existing and unrelated (`tests/generator/container-agent.test.js`,
LiteLLM-URL-from-Doppler cases that fail in this environment on `main` before
these changes — confirmed by stashing the working tree and re-running).

Lint: `npx prettier --check` clean on all touched files; `npx eslint` reports
pre-existing warnings only, 0 errors.

### Runtime proof (target-version and layout actually take effect)

Using ruff 0.16.8 on the generated firmware tree:

- `ruff check .` → **All checks passed!** (covers `main.py`, `config.py`,
  `lib/example.py`).
- injecting a walrus operator (`:=`) into `lib/` → ruff **rejects** it:
  `invalid-syntax: Cannot use named assignment expression (:=) on Python 3.7
(syntax was added in Python 3.8)`. The `py37` floor is real, not cosmetic.
- an f-string alone → ruff **accepts** it, confirming the documented residual
  gap (MicroPython 1.19 may not parse it even though py37 does).
- `pip install -e ".[dev]"` into a clean venv **succeeds** with
  `[tool.setuptools] packages = []` and no `requires-python`, installing ruff.

### Regeneration (the shipped repo)

`nickbrett1/galactic-unicorn` was regenerated with the fixed code
(`overwrite: true`, capabilities `micropython` + `code-quality-python`, same
config). Result at commit `c58eb7a`:

- root `main.py`, `config.py`, `lib/` added; `src/` and `tests/` removed
  (genproj never deletes files, so the stale scaffold from the pre-fix
  generation was removed by hand — see "Regeneration caveat" below);
- `pyproject.toml` on `main`: `src = [".", "lib"]`, `target-version = "py37"`,
  no `requires-python`;
- `README.md` on `main`: no "CI test job"; lint command `ruff check .`;
  "Linting firmware" section present;
- `ruff check .` on a clone of `main` passes, and still catches injected
  newer-than-py37 syntax.

## Regeneration caveat — the deployed Worker is not this working tree

The MCP `genproj` tools are served by the **deployed** Worker
(`https://genproj.nick-brett1.workers.dev`, see `src/mcp/handler.js`), not by
this checkout. Immediately after the fix, `list_genproj_capabilities` still
returned the **old** `code-quality-python` description — i.e. regenerating via
the MCP tool at that moment would have produced the _pre-fix_ output and
overwritten the repo with broken content, which is exactly what the task
warned against.

So the regeneration above was run with genproj's **own** code path
(`generateProjectResult` → `ProjectGeneratorService` → `generateAllFiles`) from
this fixed working tree, using the deployment `GITHUB_TOKEN` from Doppler. That
is byte-for-byte the code the Worker runs; it is just executed locally ahead of
the deploy. The catalog is bundled into the Worker, so **changing it takes a
deploy** (`README.md` §Deployment) before the MCP tool serves the fix.

## Follow-ups

- **Deploy required for the live tool.** Push this commit to `genproj` `main`;
  Buildkite deploys on `main`. Until then the MCP `generate_project` tool still
  emits the old output. (Deployment is deliberately not performed here — see
  `.agents/.rules/git_guidelines.md`: no deployment commands.)
- `github-release` + `micropython` is still untested: the Buildkite python
  commands drop `python -m build` for firmware, but the release step's
  `dist/**` artifact glob would then match nothing. Not exercised by
  `galactic-unicorn` (no CI capability selected); worth an explicit case if a
  firmware repo ever selects `github-release`.
