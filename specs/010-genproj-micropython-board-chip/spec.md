# 010 — MicroPython: decouple board/product from chip, and stop asserting CI

**Status:** implemented and verified (2026-09-19).

This is a defect record, the companion to
[`009-genproj-micropython-lint`](../009-genproj-micropython-lint/spec.md). 009
fixed the layout, the ruff target and the README CI claim (D1–D3). This one
fixes the fourth defect found in the same generation — the `micropython.board`
enum conflating a **product** with a **chip** — and tightens the D3 wording so
the Ruff copy cannot mention CI when none was selected.

Origin: the design memo for `galactic-unicorn` (v1.4 §2) and the defect memo
`genproj-micropython-defects`. Evidence for the board's actual silicon:
`mpremote ... exec 'import os; print(os.uname().machine)'` →
`Raspberry Pi Pico W with RP2040`.

## Defect 4 — the `board` enum asserts a chip inside a product name

**Observed.** The `micropython.board` enum offered `galactic-unicorn` labelled
`"Pimoroni Galactic Unicorn (RP2040)"`, and the generated README asserted the
same (`This repo targets the **Pimoroni Galactic Unicorn** (RP2040)`).

**Why it is a trap.** _Galactic Unicorn_ is a **product**; _RP2040_ is one chip
it has shipped with. Boards sold today are Pico 2 W / RP2350, for which the
label is quietly wrong. It fails in the worst way — _plausibly_: the wrong
`.uf2` is selected with no warning, and the failure surfaces at flash time, far
from the label that caused it. The `2e8a:0005` USB PID does **not** help: it
identifies the MicroPython CDC firmware class, not the variant.

**Fix — two axes, not one.** `board` now names the product only; a new `chip`
property selects the silicon independently:

- `board` labels carry no chip: `pico-w` → _Raspberry Pi Pico W_,
  `pico-2-w` → _Raspberry Pi Pico 2 W_, `galactic-unicorn` → _Pimoroni
  Galactic Unicorn_, `other` → _Other / not sure_.
- `chip` is `rp2040 | rp2350 | unknown`, default `unknown`. It is the axis the
  `.uf2` hangs on, so it is never guessed.
- `resolveMicropythonChip(context)` resolves it: an explicit `chip` always
  wins; `pico-w`/`pico-2-w` fall back to their definitional chip (the Pico W
  _is_ RP2040; the Pico 2 W _is_ RP2350); anything else is `unknown`.
- The README emits the product line from `board` and the build line from
  `chip`. On `unknown` it says _"not recorded for this repo — read it from the
  board"_ rather than asserting a chip it cannot know.
- The README always carries the lesson: **read the runtime banner
  (`os.uname().machine`), never the USB PID** — with the `2e8a:0005` example
  spelled out.
- `config.py` records `CHIP` beside `BOARD`.
- The capability itself was renamed `MicroPython / RP2040` → **MicroPython
  board** and its description no longer hard-asserts RP2040 (it already
  supported the Pico 2 W / RP2350).

The `board`/`chip` split is exposed in `src/catalog/catalog.json`; the resolver
lives in `src/generator/capability-template-utils.js` and is used by both the
README and the firmware scaffold in `src/generator/file-generator.js`.

## D3 refinement — the Ruff copy still _mentioned_ CI

009 changed the Ruff description to _"…and in CI when a CI capability is also
selected"_. That is truthful but still names CI in a repo that has none, which
is precisely the stale-looking line D3 objects to. The description is now
CI-neutral, and `generateReadmeFile` appends _"The generated CI pipeline also
runs `ruff check`."_ **only when `circleci` or `buildkite` is also selected**.
So the README describes the checks the repo actually has, and mentions CI only
when there is a pipeline to mention.

## Verification

### Unit tests

- `tests/generator/micropython.test.js` — new `board/chip decoupling (D4)`
  block: no chip in a product label; `chip` enum + description carry the
  banner/PID lesson; `resolveMicropythonChip` explicit/definitional/unknown
  cases; README states RP2040 + the firmware pointer when `chip: rp2040`, and
  refuses to assert a chip (teaching the banner) when it is unknown; `config.py`
  records `CHIP`; the Ruff copy mentions CI only with a CI capability present.
- Full suite: **639 passed, 4 failed** — the 4 are the pre-existing
  `tests/generator/container-agent.test.js` failures (LiteLLM-URL-from-Doppler,
  unrelated; they fail on `main` before this change).
- `prettier --check` clean on touched files; `eslint` 0 errors (pre-existing
  warnings only).

### Runtime proof (regenerated scratch: `micropython` + `code-quality-python`)

Generated with genproj's own code path (`generateAllFiles`) — the same code the
Worker runs — then checked against ruff 0.16.8:

1. **D1.** No `src/`, no `tests/`; `lib/example.py` present; `[tool.ruff]
src = [".", "lib"]`; `target-version = "py37"`; no `requires-python`.
2. **D1 regression test.** An undefined name added to **root-level** `main.py`
   → `ruff check .` **fails** (`F821`). Under the old `ruff check src tests`
   this passed green over an empty tree.
3. **D2.** A walrus operator (`:=`, added in 3.8) added to root-level
   `config.py` → ruff **rejects** it (_"Cannot use named assignment expression
   on Python 3.7"_). The `py37` floor is real. (Residual gap documented in the
   README: ruff cannot target below py37, so 3.5–3.7 constructs pass.)
4. **D3.** With no CI capability selected, the README contains **no** CI
   mention at all (`grep -i '\bCI\b'` → none), and the Ruff bullet is a local
   command. With `circleci` selected, the CI sentence appears and the pipeline
   emits `ruff check .`, not `ruff check src tests`, with no empty `pytest`.
5. **D4.** `board: galactic-unicorn` renders the product with **no** chip
   assertion; `chip: rp2040` renders the correct RP2040 / `RPI_PICO_W` build
   and the `pimoroni/unicorn` pointer; `chip` unset renders _"not recorded for
   this repo"_ plus the `os.uname().machine` / `2e8a:0005` lesson.
6. **Do not regress.** `runArgs` still carry `--device-cgroup-rule=c *:* rmw`
   **and** `--volume=/dev:/dev` with no pinned serial `--device`; the
   `Dockerfile` still runs `groupadd -f dialout && usermod -aG dialout vscode`;
   `scripts/find-board.sh` still **enumerates and probes** every candidate;
   the README still points at `github.com/pimoroni/unicorn`.

### Regeneration (performed 2026-09-19)

The deployed Worker already served the fixed catalog and generator when this was
run (checked live: `/v1/catalog` carries the `chip` axis, the `board` labels
carry no chip, the capability is named `MicroPython board`, and the Ruff copy no
longer mentions CI), so no deploy was needed from this checkout.

`nickbrett1/galactic-unicorn` was regenerated through the live MCP
`generate_project` tool, so its output is now known-working rather than merely
plausible:

```json
{
  "name": "galactic-unicorn",
  "selectedCapabilities": ["micropython", "code-quality-python"],
  "repositoryUrl": "https://github.com/nickbrett1/galactic-unicorn",
  "overwrite": true,
  "resolutions": { "config.py": "overwrite" },
  "configuration": {
    "micropython": {
      "board": "galactic-unicorn",
      "chip": "rp2040",
      "deviceAccess": "cgroup-rule",
      "deviceGlob": "/dev/tty.usbmodem*",
      "packages": ["mpremote"]
    }
  }
}
```

`config.py` needed an explicit `overwrite` resolution: it is app-owned, and the
repo's copy had diverged (it predated the `CHIP` line), so the idempotent
regeneration policy would otherwise have preserved it. Commit
`2f2cf5e9d2e021e03110a76682855143c7f2df9a` on `main` (was `c58eb7ae`).

Verified in the regenerated repo:

- `config.py` records `CHIP = "rp2040"` beside `BOARD`.
- The README capability bullet is **`MicroPython board`** (no RP2040 assertion);
  its MicroPython section carries the product line (no chip), a **Chip / build**
  line naming the Pico W / RP2040 `RPI_PICO_W` build, and the _read the runtime
  banner, never the PID_ lesson with the `2e8a:0005` example spelled out.
- The Ruff bullet is CI-neutral (`Lint locally with \`ruff check\`.`), with no CI
  claim in a repo that has none.
- **No regressions:** `runArgs` still carry `--device-cgroup-rule=c *:* rmw`
  **and** `--volume=/dev:/dev` with no pinned `--device`; the Dockerfile still
  runs `groupadd -f dialout && usermod -aG dialout vscode`; `scripts/find-board.sh`
  still enumerates and probes; the layout is root + `lib/` with no `src/`; the
  pre-existing `LICENSE` was left untouched.

## Follow-ups

- ~~Deploy required for the MCP `generate_project` tool to serve the new
  catalog.~~ **Done** — the live catalog already served the fix (verified
  2026-09-19); no deploy was run from this checkout.
- `github-release` + `micropython` remains untested (noted in 009).
