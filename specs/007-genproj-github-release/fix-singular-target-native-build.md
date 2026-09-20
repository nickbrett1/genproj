# Fix: a singular `github-release.target` did not reach the native (darwin) build decision

**Date**: 2026-09-20
**Reported for**: `nickbrett1/netwatch-dash` (python) — `github-release.target: aarch64-apple-darwin`
**Status**: Fixed; tests added; see _Verification_.

## The gap

genproj knows a darwin target must be built natively on a Mac host (no docker
plugin, macOS queue) — but only on the **plural** `github-release.targets`
path. The decision lives in one place, `renderBuildStep`, and it reads
`unit.target`:

```js
const darwin = isDarwinTarget(unit.target || "");
const buildPlugins = darwin
  ? ""
  : `    plugins:\n${_bkDockerPlugin(image, envKeys)}`;
_bkAgents(darwin ? MACOS_QUEUE : queue);
```

`unit.target` comes from `releaseBuildUnits`, which was fed only by
`releaseTargets` (the plural matrix, rust-only). The **singular**
`github-release.target` never reached `renderBuildStep`, so it fell through the
"no targets" branch with `target: null`. `isDarwinTarget(null || "")` is false,
and the step was containerised on the project's normal queue.

Consequence: the same triple produced two different build hosts depending only
on which knob declared it.

| Declared as                       | Project | Result (before)                                                             |
| --------------------------------- | ------- | --------------------------------------------------------------------------- |
| `targets: [aarch64-apple-darwin]` | rust    | no docker plugin, `MACOS_QUEUE`                                             |
| `target: aarch64-apple-darwin`    | python  | `docker#v5.13.0`, `python:3.13-slim`, `platform: linux/arm64`, normal queue |

The macOS payload (an arm64 macOS CPython from python-build-standalone) was
therefore cross-assembled on Linux, and nothing could execute it before
publication — a payload that cannot start could ship.

## The fix

One code path for the decision: the singular target now also produces a
`releaseBuildUnits` entry (**one unit, no matrix**), so `renderBuildStep` sees a
`unit.target` and applies the darwin rule exactly as for the plural path.

`src/generator/capability-template-utils.js`:

- `releaseBuildUnits({ ..., singleTarget })` — new parameter. In the
  `releaseTargets.length === 0` branch the single unit now carries
  `target: singleTarget || null` instead of `target: null`. Everything else is
  unchanged: same `key: "build"`, same label, same `commands[language]`, same
  `singleArtifactPaths` (`dist/**` for python/node), same empty `env`.
- `getBuildkiteTemplateData` — reads `grConfig.target`, trims it into
  `singleTarget`, and passes it to `releaseBuildUnits`.
- `renderBuildStep` — **unchanged**. This is the point: there is still exactly
  one place that decides darwin-ness.

The singular artifact still packs from `dist/` under its declared label (see
`release-artifacts.sh` / `githubReleaseDistTarget`); the fix does not move it to
`build/<target>/`, because one artifact is packed from `dist/` by design.

Side effect, intended: a singular unit now also carries `RELEASE_TARGET`, and a
non-darwin singular target lists `RELEASE_TARGET` in the plugin's
`environment:` (same as the plural path). It is a truthful label and is
harmless; the darwin step has no plugin, so it simply appears in `env:`.

## `MACOS_QUEUE`

`MACOS_QUEUE = "mac-studio-linux"` (`src/generator/capability-template-utils.js`).
A native darwin step lands on the `mac-studio-linux` queue. The name describes
the _containers_ the queue's other steps run in, not its hosts — the hosts are
Macs, and a step with no docker plugin runs natively on them. This constant is
also the default for every step unless the project names another queue.

## Should the darwin path also RUN the artifact before release?

**Recommendation: yes — as a separate darwin-only smoke step that gates the
release — but not implemented here.** Rationale and shape in the Memo
`genproj-singular-target-native-build`. Short version: the fix makes the payload
built on the right host but does not gate the release on the payload executing;
a native host is the one host in the fleet that _can_ run a darwin payload, so
the run gate belongs there and must be fail-closed to mean anything. It needs a
seeded, app-owned hook script (like `release-artifacts.sh`) because "runs" is
project-specific, so it is a follow-on change rather than part of this fix.

## Verification

- New tests in `tests/generator/file-generator-github-release.test.js`
  ("a single platform-specific artifact"):
  - singular darwin build step has no docker plugin, on `mac-studio-linux`,
    carries `RELEASE_TARGET`;
  - the macOS queue survives a project `buildkite.queue` override;
  - a non-darwin singular target stays containerised on the project's queue;
  - the same triple lands on the same host via singular (python) and plural
    (rust) — the regression guard for the exact gap.
- New YAML-parse shape in `tests/generator/file-generator-buildkite.test.js`
  for the no-plugin single-artifact step.
- Rust matrix path untouched; `github-release.targets` still refuses non-rust;
  singular `github-release.target` still refuses rust (see
  `validateReleaseTargets` — unchanged).

## Follow-up (same branch): the release step, merge, and the smoke gate

### 1. The release step is NOT de-dockerised — it is still a container step

The fix changed the **build** step only. The release step is rendered
separately and unconditionally uses the project's queue and the docker plugin:

```js
${_bkAgents(queue)}    plugins:
${_bkDockerPlugin(image, releaseEnv)}    commands:
```

So for `github-release.target: aarch64-apple-darwin` (python) the generated
release step keeps `docker#v5.13.0` / `python:3.13-slim` / `platform:
linux/arm64` and runs **in a Linux container on the `mac-studio-linux` queue**
(whose hosts are Macs running Docker). Its `apt-get` bootstrap is therefore
valid — `gh` and `doppler` are installed into the container as before, and
`gh`/`doppler` do **not** need to be provided on the macOS host. Only the build
step (and the new smoke gate) are native. Nothing here is "open": the release
step is containerised by design, because it does not need to run the payload —
it downloads the build's artifacts and calls `gh`.

The native steps are identified in the generated YAML by the absent `plugins:`
block and `queue: mac-studio-linux`. Exact generated step keys: build `build`,
smoke `smoke_aarch64_apple_darwin`, release `release`.

### 2. Merge / deploy

As of `17b18a5` the fix was committed on `fix/genproj-singular-target-native-build`
and **not** merged to `main`. genproj is a Cloudflare Worker; `/mcp` (the
`generate_project` tool) is served by the **deployed** Worker, and the repo's own
Buildkite pipeline deploys on push to `main` (`npx --yes wrangler deploy`). So a
regeneration picks up the native step only after the branch is **merged to
`main` and the deploy has run**. Merging alone is not enough; the Worker must be
redeployed.

### 3. Smoke gate — landed in this change

Implemented as recommended, with one important correction to the premise:

- `scripts/smoke-launch.sh` is seeded once and is **app-owned** (under
  `scripts/`, not in `GENPROJ_OWNED_SCRIPTS`), so regeneration creates it but
  never overwrites it — the same rule as `release-artifacts.sh`.
- A native `smoke_<target>` step is emitted for every **darwin** build unit
  (singular or matrix), on `MACOS_QUEUE`, no docker plugin, `depends_on` the
  darwin build step, main-only, with `env: RELEASE_TARGET: <target>`. It fetches
  the build's artifacts with `buildkite-agent artifact download` (a native step
  can use the agent binary directly; the release step's Linux container cannot,
  which is why _that_ step uses the agent API).
- The **release** step's `depends_on` gains the smoke key(s); all other consumers
  (deploy, lighthouse, docker publish) keep depending on the build only.
- The default script is fail-closed: entry point `bin/<project name>` exists and
  is executable, is arm64 when it is a Mach-O (a wrapper script is checked by
  running it), and answers to `--version`/`--help` under a portable timeout
  (coreutils `timeout` is not on macOS), else the release is blocked.

**Correction — "the built tarball" does not exist yet at smoke time.** In the
current architecture the tarball is packed by `scripts/release-artifacts.sh`
_inside the release step_, so no pre-release step can smoke-test a tarball. The
smoke step therefore runs the **payload root the build step produced and
uploaded** (`dist/` for the singular artifact, `build/<target>/` for a matrix);
the tarball is packed from that same root (`tar -C <root> .`), so this checks the
tarball's contents. A project that assembles its payload inside
`release-artifacts.sh` (as netwatch-dash does: python-build-standalone + wheel +
producers) must move that assembly so it has happened **before** the smoke step —
into the build step or into `scripts/smoke-launch.sh`, which is the natural
place, since the script is app-owned and runs on the Mac host.
