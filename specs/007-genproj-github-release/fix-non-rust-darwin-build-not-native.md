# Fix: the darwin build host was decided from the target label, not from what the step produces

**Date**: 2026-09-20
**Reported for**: `nickbrett1/netwatch-dash` (python) — `github-release.target: aarch64-apple-darwin`
**Status**: Fixed; tests updated/added; see _Verification_.
**Supersedes in part**: [`fix-singular-target-native-build.md`](fix-singular-target-native-build.md) — that fix correctly
routed a singular target into `releaseBuildUnits`, but the decision it then applied
("a darwin target makes the build step native") is the bug this document fixes.

## The gap

The change in `fix-singular-target-native-build.md` made a singular darwin
target subject to the same `renderBuildStep` predicate as the plural matrix:

```js
const darwin = isDarwinTarget(unit.target || "");
const buildPlugins = darwin
  ? ""
  : `    plugins:\n${_bkDockerPlugin(image, envKeys)}`;
_bkAgents(darwin ? MACOS_QUEUE : queue);
```

For a **rust** build unit that predicate is exactly right:
`cargo build --target aarch64-apple-darwin` links a Mach-O, and only a Mac has
the macOS SDK and linker. But a **non-rust** singular target is the only kind
that exists — `validateReleaseTargets` refuses `target` on rust and refuses
`targets` on anything else — and a non-rust build step does not link a platform
binary. It produces a `py3-none-any` wheel (or a JS bundle, or a jar). Making it
native buys nothing and costs a working build: on the macOS agent `python3` is
Homebrew's, marked externally managed, so the generated commands die at the
first line under PEP 668:

```
$ python -m pip install --no-cache-dir -e ".[dev]"
error: externally-managed-environment
× This environment is externally managed
╰─> To install Python packages system-wide, try brew install xyz ...
```

Buildkite builds 12 and 13 on `nickbrett1/netwatch-dash` both failed this way.

The mistake is the _question_: `isDarwinTarget(unit.target)` answers "which host
may run the artifact", but the decision needed is "does **this step** produce a
platform binary". They coincide for a rust matrix (whose build step links one)
and diverge for a singular target, where the darwin-ness belongs to the payload
assembled from the output (app-owned) and to the smoke gate (which _runs_ the
payload and is correctly native).

## The fix

A build unit now says whether it links a platform binary, and that flag — not
the label alone — decides the build host.

`src/generator/capability-template-utils.js`:

- `releaseBuildUnits` stamps each unit with `platformBinary`:
  - the plural (rust matrix) branch: `true` — it links a binary per target;
  - the single branch: `language === "rust"` — for a non-rust singular target
    this is `false`, because its output is architecture-independent. It is
    written as a property of the language rather than a bare `false` so it stays
    truthful if the guard ever changes.
- `renderBuildStep` combines the two facts:

  ```js
  const nativeDarwin = unit.platformBinary && isDarwinTarget(unit.target || "");
  ```

  Consequences unchanged: native means no docker plugin and the macOS queue.

- Comments on `isDarwinTarget`, `MACOS_QUEUE` and `renderSmokeStep` now separate
  the _label_ fact (which host may run the artifact) from the _step_ fact (which
  host can build it), and the smoke gate is documented as native regardless of
  how its payload was built — it is the payload that is darwin.

The smoke gate's filter is deliberately untouched: it is still
`unit.target && isDarwinTarget(unit.target)`, because the payload _is_ darwin
even when the step that produced it was not.

## Verification

`tests/generator/file-generator-github-release.test.js`:

- a singular darwin target's build step **has** the docker plugin and carries
  `RELEASE_TARGET` (was: no plugin, macOS queue);
- it follows `buildkite.queue` when the project moves its containers — it is a
  container;
- a non-darwin singular target is unchanged (containerised);
- the replacement for the old "decides the build host from the target" test:
  the **rust** matrix build for `aarch64-apple-darwin` is native on
  `mac-studio-linux`, the **python** singular target with the same label is
  containerised — the decision follows what the step produces, not the label.

`tests/generator/file-generator-buildkite.test.js`: the singular-darwin shape's
comment now says the build step stays a container and the smoke gate is native.

## What this does not change (and what it leaves for a follow-on)

The smoke gate still assumes the build step uploaded the payload root
(`dist/**` for python/node) — Gap B of `netwatch-dash`'s
`docs/genproj-target-gap.md`. For a payload that must be _assembled_ (a bundled
interpreter), `dist/` is a wheel and the root does not exist until something
assembles it; netwatch-dash does this in an app-owned script today. With this
fix the build step is a container again, so an app-owned assembly hook called by
the generated build step would be the durable shape, and would let the smoke
gate keep its simple contract. That is a separate change.
