# The payload assembler: one hook, called by both the smoke gate and the release step

**Date**: 2026-09-20
**Reported for**: `nickbrett1/netwatch-dash` (python) — `github-release.target: aarch64-apple-darwin`
**Status**: Implemented; tests added; see _Verification_.
**Related**: `fix-non-rust-darwin-build-not-native.md` (the build-host half of
the same report) and `fix-singular-target-native-build.md`. This is "Gap B" of
`netwatch-dash`'s `docs/genproj-target-gap.md`.

## The gap

The generated pipeline assumes the build step's output is the payload root: the
smoke gate downloads `dist/**` and runs `scripts/smoke-launch.sh dist`, and the
release step fetches `dist/**` and `scripts/release-artifacts.sh` packs `dist/`.

That holds when `dist/` already contains `bin/<name>` — a rust build's linked
binary under `build/<target>/`, or a project that happens to lay its payload out
in `dist/`. It does **not** hold for a project whose build output is a release
_input_: a python build produces a `py3-none-any` wheel in `dist/`, a node build
a bundle. Neither is a payload root, and the tree the launcher execs has to be
assembled from it.

`netwatch-dash` assembles its payload — a bundled arm64 CPython with
site-packages, the wheel, producers/schema/deploy and a `bin/netwatch-dash`
shim — in app-owned scripts. Because the generated smoke gate and the generated
release step each assembled their own copy, you got the defect the whole gate
exists to prevent: **two assemblers that can drift**, so the gate can pass on a
tree the tarball will not contain.

## The shape

One assembler, invoked by the two steps that need a payload, with the version as
an argument.

### Contract (placement)

The assembler is a hook called by **both** the smoke gate and the release step —
not a build-step hook, and not a smoke-gate-only script:

- A build-step hook collides with `dist/`: `python -m build` writes the wheel
  there, and the build step uploads `dist/**` and the smoke step downloads it,
  so a payload root written into `dist/` is both a collision and the wrong
  artefact to upload.
- A build-step hook has no version: the release step creates the tag, so at
  build time the value would be a guess — exactly how a payload ends up
  misreporting its own release.
- A smoke-gate-only assembler leaves the release step to assemble its own copy,
  and now there are two assemblers again.

### Signature

```
bash scripts/build-payload.sh <version> <output-root> [<input-dir>]
```

- `<version>` is **positional, never environment-only**. The two callers
  legitimately pass different versions (the smoke label; the release tag), and
  the script has to be usable with an explicit one. It is also what an assembly
  records in its own build metadata.
- `<output-root>` is the payload root both callers hand it — `payload/`.
- `<input-dir>` is where the build step left its output (default: `dist`).

The two steps pass the **same** output root, which is what makes the gate
execute the tree the tarball will contain.

### Emitted for the singular unit only

A rust matrix build links a platform binary into `build/<target>/`, which _is_ a
payload root: there is nothing to assemble, so a hook would be noise. The
assembler is seeded, and called, only for the singular (non-rust) unit.
`validateReleaseTargets` makes the mapping exact — `target` is non-rust only,
`targets` is rust only — so "not rust" is precisely "there is something to
assemble".

### Seeded, not flagged

`scripts/build-payload.sh` is seeded (app-owned: created once, never overwritten
on regeneration) with a default body that does the boring thing — copy the build
output into the root:

```bash
rm -rf "$ROOT"; mkdir -p "$ROOT"; cp -R "$INPUT_DIR"/. "$ROOT"/
```

A project whose `dist/` already is a payload root keeps exactly its old
behaviour without noticing; a project like `netwatch-dash` replaces the body.

Seeding rather than a config flag is deliberate: a flag would make the
interesting case opt-in and the boring case the only tested path. Because the
script is always present for the singular unit, the steps call it
**unconditionally** — the default path is exercised by every generated project.

## What changed

`src/generator/templates/scripts-build-payload.sh.template` (new) — the seeded
assembler, with the contract and fail-closed (`no input directory` is an error,
not an empty payload).

`src/generator/capability-templates.js` — registers the script under
`github-release`, `isExecutable`, gated by a `when: (context) => language !==
"rust"` predicate.

`src/generator/file-generator.js` — honours an optional `when(context)` on a
template descriptor (a descriptor without one is emitted exactly as before), and
wires the new template id.

`src/generator/capability-template-utils.js`:

- `RELEASE_PAYLOAD_ROOT = "payload"` — the one root both steps agree on.
- `renderSmokeStep(unit, { assemblePayload })` — for the singular unit, inserts
  the `build-payload.sh "<smoke label>" payload dist` call before
  `smoke-launch.sh "payload"`; the rust matrix is unchanged (it runs
  `build/<target>/` directly).
- The release step inserts `build-payload.sh "$VERSION" payload dist` before
  `release-artifacts.sh`, so what ships is what the gate ran.

`src/generator/templates/github-release-artifacts.template` — packs the
assembled root (`PAYLOAD_ROOT`, default `payload`) with `tar -C <root> .`, and
falls back to `dist/` for a project whose script predates the assembler (the old
behaviour, byte for byte).

`RELEASING.md` / `LAUNCHING.md` templates — describe the assembler as the place
the build output becomes a payload root.

## Verification

`tests/generator/file-generator-github-release.test.js`:

- the assembler is seeded for a singular (non-rust) unit and **not** for a rust
  matrix;
- a singular darwin unit's smoke gate calls the assembler with the smoke label
  and then runs the assembled root, and the release step calls the same script
  with `$VERSION` and the same root — one assembler, two callers;
- a rust matrix emits no assembler call at all and still runs
  `build/<target>/`;
- a real run of the seeded default copies `dist/*` into `payload/`.

`tests/generator/file-generator-fetch-launch.test.js` — `LAUNCHING.md` now
documents the assembler and the `<root>/bin/<name>` layout.

## What this does not change

The artifact hand-off is still `dist/**` from the build step to both consumers:
the assembler consumes that, it does not replace it. A project that assembles
inside its own build step instead of here still works — it just does not need
the hook — but it loses the "one tree, gate and release" property this restores.
