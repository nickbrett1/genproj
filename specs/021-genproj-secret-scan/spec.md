# 021 — `secret-scan`, a required gitleaks gate on every generated project

**Status:** implemented (2026-10-18).

A real key was committed and pushed from `reader`. The generated pre-commit hook
did not fire, and nothing in CI looked at history — two failures of the same
kind, so the fix is not "add a scanner" but "make the scanner non-optional".
This spec records the capability built from
`projects/genproj/genproj-secret-scan-capability.md`.

## The capability

| Field                                                | Value                                 |
| ---------------------------------------------------- | ------------------------------------- |
| `id`                                                 | `secret-scan`                         |
| `category`                                           | `secrets`                             |
| `selectedByDefault`                                  | `true`                                |
| `locked`                                             | `true` (cannot be applied without it) |
| `dependencies`                                       | `[]`                                  |
| `requiresAny`                                        | none                                  |
| `requiresAuth` / `authServices` / `externalServices` | `[]`                                  |

The zero-dependency shape is the point: gitleaks is MIT, one static binary, no
account, no network at scan time, no quota. It therefore has to work with
nothing else selected — including the offline projects a GitGuardian-backed
gate could never cover.

### `locked` outside `core` — verified

The note left this open ("every locked capability currently lives in `core`").
Checked: the generator does not care about category. `getLockedCapabilityIds()`
filters on `locked` alone, and both generation entry points seed their
resolution with it (`capability-resolver.js`, `project-context.js`). So
`secrets` is an accurate grouping, and `secret-scan` is still applied to every
project through HTTP and MCP alike.

The one invariant the catalog tests pinned was "selected by default iff core".
That is now "selected by default iff core or locked", which is the property the
UI actually needs. A client that ignores `locked` outside `core` would present
it as optional, but the server would still apply it — the dangerous direction
(a flag that reads as enforced and is not) does not occur here.

## What it emits

| File                          | Purpose                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.githooks/pre-commit`        | `gitleaks git --pre-commit --staged --redact --verbose`, fail-open when the binary is missing                                                     |
| `.gitleaks.toml`              | `[extend] useDefault = true`, two custom rules for the `${VAR:-secret}` shell shape, three commented narrow allowlists, one placeholder allowlist |
| `.gitleaksignore`             | comment-only seed documenting the exact fingerprint format — the reviewed escape hatch, instead of `--no-verify`                                  |
| `scripts/install-gitleaks.sh` | pinned `v8.30.1`, platform-specific sha256 verified before install                                                                                |
| `scripts/setup-git-hooks.sh`  | installs the scanner (warn-only), sets `core.hooksPath .githooks`, then **verifies** it                                                           |

The three release checksums in the note were re-verified against the published
`v8.30.1` assets (linux_x64, linux_arm64, darwin_arm64) before being committed.

### The shape the default rules miss

Found while backfilling `reader`: gitleaks 8.30.1's `generic-api-key` rule
matches `export KEY=sk-...` but **not** `export KEY="${KEY:-sk-...}"`, which is
how a script carries a fallback credential. The reader's historical leak was in
exactly that form, so the first full-history scan of 36 commits reported
nothing. Verified directly with the pinned binary (`gitleaks dir` on the file:
`no leaks found` with the default rules alone).

Two length-partitioned rules fix it so that one secret produces one finding:

| rule                           | catches                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `shell-default-provider-token` | short provider-prefixed tokens: `sk-`, `ghp_`, `AKIA`, `glpat-`, `eyJ`, ... |
| `shell-default-high-entropy`   | any 24+ char token at entropy >= 3.5                                        |

A rule-level allowlist with `regexTarget = "secret"` and placeholder stopwords
(`replace`, `changeme`, `your_`, `example`, `fake`, ...) keeps
`${TOKEN:-REPLACE_ME}` in `.env` examples quiet. Verified against a
false-positive corpus (`${HOME:-/root}`, `${PATH:-/usr/bin:/bin}`,
`${TAG:-sha-abc123def456}`, `${MODE:-production}`, a compose file with
`${POSTGRES_PASSWORD:-postgres}`): no findings.

The `.gitleaksignore` seed also documents the real format — a fingerprint cannot
be followed by a trailing reason, gitleaks takes the whole line and stops
matching (verified).

## The root-cause fix

The generated setup installed the hook with `npx --yes simple-git-hooks`. In a
repository with no `package.json` that command is a **silent no-op**: no hook
config to read, exit status 0, nothing installed. `post-create-setup.sh`
reported success and every commit since went unscanned.

`secret-scan` replaces the mechanism rather than sitting beside it:

- the hook is a plain file in `.githooks/`, discovered through `core.hooksPath`,
  so it needs no Node, no `package.json` and no package manager;
- `core.hooksPath` is a git setting, so it survives a fresh clone;
- post-create runs `scripts/setup-git-hooks.sh` **without** `|| true`, and that
  script exits non-zero unless `git config --get core.hooksPath` returns
  `.githooks`;
- when `secret-scan` is present the generated `package.json` no longer carries
  `simple-git-hooks` or a `prepare` script. `lint-staged` stays, and the hook
  invokes its local binary when the project has one — one mechanism, not two.

`.githooks/pre-commit` has no `.sh` extension because git discovers hooks by
name, so the GitHub commit path marks `.githooks/*` executable explicitly
(GraphQL cannot express a file mode).

## Two gates

- **Hook (advisory):** scans staged changes. If gitleaks is missing it warns and
  exits 0 — a half-provisioned container must not block commits, and the local
  hook can be skipped with `--no-verify` anyway.
- **CI (the control):** scans the **full history**, cannot be skipped, fails the
  build. Buildkite runs it natively (it needs the checkout's git history, so it
  is deliberately not containerised); CircleCI runs it as a `run` step inside
  the build job, before build/test.

This is the note's recommended pairing: fail-open hook + mandatory CI. A
fail-closed hook was rejected — it blocks every commit until provisioning
finishes and is still bypassable.

## Scope boundary

Not a secret store (Doppler holds secrets) and not rotation (a finding means
_rotate_, a human step, stated bluntly in the generated README). Allowlist
edits in `.gitleaks.toml` are committed and therefore reviewable.

## Backfill

New projects get this automatically. Existing repos need it applied by hand;
`reader` needs the leaked key rotated **before** a scanner is added.

## Acceptance criteria (as implemented)

1. Every generated repository contains `.githooks/pre-commit`,
   `.gitleaks.toml` and `.gitleaksignore`. ✔ (`tests/generator/secret-scan.test.js`)
2. `post-create-setup.sh` exits non-zero if `core.hooksPath` is not `.githooks`
   after it runs. ✔ (`scripts/setup-git-hooks.sh` verifies; post-create has no
   `|| true`)
3. The capability cannot be deselected: `locked: true`, and generation seeds
   locked ids for every entry point. ✔
4. A repository generated with **no** other capability selected still gets the
   hook files. ✔ (`resolveDependencies([])` → `secret-scan`, asserted in the
   test and in the catalog test)
5. The full-history scan is present in Buildkite and CircleCI configurations
   whenever those capabilities are selected. ✔
6. `--redact` is used in the hook and in both CI gates. ✔
7. Allowlists are narrow and commented; no blanket entry. ✔
8. A credential in `${VAR:-secret}` form is detected, and a placeholder default
   is not. ✔ (rules asserted in `tests/generator/secret-scan.test.js`, both
   directions verified with the pinned binary; the rules themselves are not
   exercised in CI because the suite does not download gitleaks)

The hook's wiring is exercised directly, not just asserted as text: the
generated `.githooks/pre-commit` is run in a temporary git repository against a
scanner double that exits 1 (commit blocked) and with no scanner on `PATH`
(commit allowed). Still open: a real end-to-end run of the pinned binary over a
freshly generated repository containing a known test key. The gitleaks config
itself was validated against `v8.30.1` while implementing, but that validation
is not in the suite because it needs the downloaded binary.

## Related

- `projects/genproj/genproj-secret-scan-capability.md` — the design note this
  implements.
- `016` is unused; `021` was the next free number at the time of writing.
