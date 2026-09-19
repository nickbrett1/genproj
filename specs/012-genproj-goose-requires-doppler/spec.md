# 012 — goose exists only where it can run

**Status:** implemented and verified (2026-09-19).

This is a defect record. A regenerated `galactic-unicorn` (capabilities
`micropython` + `code-quality-python`) reported:

```
$ goose
Feature name (Enter for main tree, no worktree):
→ running in the main tree (no worktree)
...
  error: No provider configured. Run 'goose configure' first.
```

genproj's own output, out of the box, presented a `goose` that could not start.

## The defect — goose was advertised everywhere, runnable nowhere but under Doppler

Three separate places emitted goose, each with its own condition, and only one
of them asked whether goose could actually work:

| Emission                                      | Was gated on                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| the goose binary (`RUN` in all 4 Dockerfiles) | **nothing** — unconditional                                                |
| `goose()` in `.devcontainer/.zshrc`           | `doppler` → the Doppler wrapper; **else** a wrapper around the bare binary |
| `~/.config/goose/config.yaml` + recipes       | `coding-agents` or `circleci`/`sonarcloud`/`xcode-development`/`sveltekit` |
| `goose update` in `post-start-setup.sh`       | nothing (guarded by `command -v`, with a `WARN: goose not found` fallback) |

The only supported way to run goose in a generated devcontainer is the
`GOOSE_ALIAS` wrapper, which runs it under `doppler run`: goose takes its
provider from the `LITELLM_*` env of the `goose` Doppler project. The bare
binary has no `provider:` block in its config (by design — see
`generateGooseSetupScript`), so it starts, prompts, and dies. That is exactly
the transcript above: the worktree prompt came from the fallback wrapper, the
prompt-and-die came from the binary underneath it.

`galactic-unicorn` selects neither `doppler` nor `coding-agents`, so it got:
binary ✔, bare-binary wrapper ✔, no config, no recipes — a command that
_looked_ configured and was not.

## The fix — one predicate, `doppler`

`hasGoose(capabilities)` (in `src/generator/file-generator.js`) is now the only
question asked, and it answers `capabilities.includes("doppler")`.

`doppler` is the predicate rather than `coding-agents` because everything goose
needs arrives with it, and every capability that wants goose resolves it:

- `coding-agents → doppler` (declared)
- `container-agent → doppler` (declared)
- `xcode-development → coding-agents → doppler` (inherited)
- `circleci → doppler` (declared, for its MCP tokens)

So `hasGoose` means "goose can actually run here" without a capability list that
goes stale as the catalog grows — which is what the old four-name list in
`gooseSetup` was, and it was already wrong: `sonarcloud` and `sveltekit` were on
it without declaring `doppler`.

Gated on `hasGoose`:

- **the binary** — the goose install moved out of the shared `RUN` chain into
  `{{gooseInstall}}`, a standalone `RUN` fragment (`GOOSE_INSTALL_FRAGMENT`,
  `gooseInstallFragment()`), so it can be absent without leaving a dangling `\`
  continuation behind. The `mkdir -p "$HOME/.local/bin"` that preceded it stays
  (Cursor and Antigravity still install there).
- **`gooseAlias` and the worktree block** — `{{gooseAlias}}` was already
  doppler-gated; the worktree workflow moved to its own template
  (`devcontainer-zshrc-goose-wt.template`, appended by `gooseWorktreeZshrc()`)
  and its tail no longer binds the bare binary at all. With goose present,
  `goose()` is the Doppler wrapper, which already routes through `_wt_ensure`,
  so the fallback was unreachable even in the case it was written for; with
  goose absent there is no `goose()`, no `wt`, and no
  "Goose Multi-Session Worktree Workflow" section.
- **config + recipes** — an extensions-only config for a goose that is not
  installed is inert, and it used to ship beside a broken command. Selecting
  `sonarcloud` or `sveltekit` alone no longer writes one; the repo has no goose
  to extend. (Nothing regressed: with no `doppler` that path never had a
  runnable goose either.)
- **`goose update`** — `{{gooseUpdate}}` (`GOOSE_UPDATE_SCRIPT`). It previously
  ran everywhere and printed `WARN: goose not found, skipping update` on every
  start of a repo with no goose.

Two incidental comments that named goose in goose-free output were made
capability-neutral: the Dockerfile's `# Add local tools and goose to PATH…`, and
the tarball-to-cwd note above `WORKDIR` (it explains the writable-home rule for
_all_ the installers, not just goose's).

The preview renderer (`preview-generator.js`) goes through the same helpers, so
what the UI previews is what the generator writes — including the goose config,
which the preview had been writing for `coding-agents` alone while the generator
wrote it for four capabilities.

## Verification

- `tests/generator/goose-gate.test.js` (new): `hasGoose` truth table; the
  fragment is a self-contained `RUN` with no dangling continuation; for each of
  node/python/java/rust, **no** goose anywhere in the Dockerfile, `.zshrc` or
  `post-start-setup.sh` without `doppler`, and all three present with it; no
  goose config/recipes without `doppler`; preview agrees with the generator; the
  generated `.zshrc` parses under `zsh -n` with and without the worktree block
  (skipped where `zsh` is absent).
- Regenerated output was checked directly: a `micropython` +
  `code-quality-python` selection produces a Dockerfile, `.zshrc` and
  `post-start-setup.sh` with **zero** goose and zero doppler mentions; adding
  `coding-agents` (which resolves `doppler`) restores the wrapper, the worktree
  block, the config and the recipes.
- Full suite **671 passed**; `prettier --check .` clean; `eslint` 0 errors
  (pre-existing warnings only).

### Live before/after (`POST /v1/preview`, unauthenticated)

`{"selectedCapabilities": ["devcontainer-node"]}` — goose-bearing files, before
build 115 / after it:

| File                        | Before     | After |
| --------------------------- | ---------- | ----- |
| `.devcontainer/Dockerfile`  | GOOSE_ARCH | —     |
| `.devcontainer/.zshrc`      | goose      | —     |
| `.devcontainer/post-start…` | goose      | —     |

With `doppler` in the selection all three come back, and the Dockerfile carries
`RUN GOOSE_ARCH=…` again.

### Regeneration (performed 2026-09-19)

The live Worker was deployed from build 115, then `nickbrett1/galactic-unicorn`
was regenerated through the live MCP `generate_project` tool with
`["micropython", "code-quality-python", "coding-agents"]` (the
`micropython` configuration of spec 010, unchanged). Its output now carries the
wrapper (`goose()` → `doppler run … -- goose "$@"` at `.zshrc:164`, worktree
block at `:297`, `zsh -n` clean), `RUN GOOSE_ARCH=…` in the Dockerfile, and the
goose config/recipes in `post-create-setup.sh`. The `micropython` `runArgs` are
unchanged (`--device-cgroup-rule=c *:* rmw` + `--volume=/dev:/dev`), so spec 010
has not been regressed.

An **existing** container keeps its old `~/.zshrc` — that file is copied at
image build — so the fix reaches a checkout on "Rebuild and Reopen in
Container", not on `git pull`.

## Follow-ups

- `scripts/cloud_login.sh` is emitted for every selection, including one with no
  Doppler, no Tailscale and no Cloudflare section to log into, and its header
  comment names goose ("the critical path for goose"). The script's emission
  condition is a separate defect — it should be gated on having any login to
  perform — and was left alone here rather than folded into the goose gate.
- `sonarcloud` and `sveltekit` register a goose MCP extension without declaring
  `doppler`, so the extension is now simply absent unless the selection also
  carries goose. If a SvelteKit-without-Doppler repo should still get the svelte
  extension, the capability needs its own goose-less path — deliberately not
  invented here.
- `devcontainer-zshrc.template` (the minimal, alias-only zshrc) is registered
  with the template engine but never rendered; it keeps the same `gooseAlias`
  gate, so it stays consistent if it is ever used.
