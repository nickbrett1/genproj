# Feature Specification: genproj "GitHub Releases" Capability

**Status**: Draft (v1 scope: capability + generated release step + artifact hand-off)
**Created**: 2026-09-13
**Revised**: 2026-09-14 — the release moved from a tag-triggered GitHub Actions workflow to a Buildkite step, and from "notes only" to publishing artifacts
**Motivating use case**: a generated project should be able to **ship a release** — the code that passed CI is tagged, packaged and published with no human doing the mechanics. Requested alongside `buildkite` for the `a2a-goose` node agent, whose deploy channel is a GitHub Release consumed by a boot-fetch launcher (`releases/latest/download/<asset>` only resolves to a real Release with real assets).
**Depends on**: `buildkite`. The release is a step _in_ the Buildkite pipeline, so the capability is meaningless without it (see §3).
**Reference implementation**: `specs/006-genproj-buildkite/spec.md` — the pipeline the release step is appended to.

---

## 1. Problem

The generator can create a repository, wire CI, provision secrets and open dependency PRs, but it cannot **ship**. Every existing release-shaped flow ends at "a human tags the commit, then a human drafts a release in the GitHub UI and attaches the build output." That is the one part of the lifecycle genproj does not remove, and it is exactly the part the `a2a-goose` boot-fetch launcher depends on.

The goal is narrow and mechanical: **merge to the default branch → CI builds, tests, tags, packages and publishes.** No tag to push by hand, no notes to write, no version file to bump, no asset to upload, no token for a human to paste in.

## 2. Capability definition

Machine-readable contract: `contracts/github-release.capability.json`. Summary:

| field                 | value                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                  | `github-release`                                                                                |
| `category`            | `deployment` — it publishes an artifact, alongside `docker-container` and `cloudflare-wrangler` |
| `dependencies`        | `["buildkite"]` — the release is a step in that pipeline                                        |
| `conflicts`           | `[]`                                                                                            |
| `requiresAuth`        | `[]`                                                                                            |
| `authServices`        | `[]`                                                                                            |
| `externalServices`    | `[]` — no generation-time GitHub call is made (see §4)                                          |
| `configurationSchema` | `targets` — the only knob; the tag convention and everything else about the release is fixed    |

The capability contributes no file of its own for the mechanism — the release _is_ pipeline content, produced by `getBuildkiteTemplateData`. It contributes three files that configure and document it:

| Path                           | Owned by | Purpose                                                               |
| ------------------------------ | -------- | --------------------------------------------------------------------- |
| `.github/release.yml`          | genproj  | release-notes classification, consumed by `--generate-notes`          |
| `RELEASING.md`                 | genproj  | the contract a generated repo cannot express in code                  |
| `scripts/release-artifacts.sh` | app      | names and packages what gets attached; seeded once, never overwritten |

`scripts/` is app-owned, so the artifact hook is the one part of this capability a regenerated project keeps. That is deliberate: the generator emits the _mechanism_, and the project owns the _names_.

---

## 3. Flow: how a release happens

```
merge to the default branch
        │
        ▼
Buildkite: secret_scan → build (+ test)        ← the only validator
        │                    │ uploads artifact_paths
        ▼                    ▼
Buildkite: release  (depends_on: build, main only)
        │
        ├─ resolve GITHUB_RELEASE_TOKEN (Doppler common/prd)
        ├─ VERSION = patch bump of the newest v* tag; TAG = vVERSION
        ├─ skip if TAG already exists on origin (re-runs must be safe)
        ├─ git tag -a / git push (credential.helper, token never in the URL)
        ├─ buildkite-agent artifact download  ← the exact bytes the build tested
        ├─ bash scripts/release-artifacts.sh "$VERSION"
        └─ gh release create "$TAG" --title "$TAG" <flags> release/*
        │
        ▼
published GitHub Release: CI-created tag, generated notes, attached assets
```

Four properties are load-bearing:

1. **The release is gated on the build, inside the same build.** `depends_on: [build]` and `if: build.branch == "main"`, the same shape as the deploy step. A release therefore cannot exist for a commit that did not pass, and this is structural rather than a matter of discipline.
2. **The tag is created by CI, never by a human.** The version is derived from the newest existing tag, so there is no version file to keep in sync and no "bump and tag" step to forget.
3. **The release attaches the artifacts the build produced, and does not rebuild them.** Steps run in isolated containers, so the build step uploads `artifact_paths` and the release step downloads them with `buildkite-agent artifact download`. One compile per commit, and the release ships what the tests actually ran against rather than a second compile of the same tree.
4. **It is not a validator.** Buildkite is the only thing that reports on pushes; the release step reads that verdict rather than producing one of its own.

### Why a Buildkite step and not GitHub Actions

v1 of this spec chose a tag-triggered GitHub Actions workflow (`on: push: tags:`) for blast radius: a workflow cannot touch the validator, and `${{ github.token }}` needs no provisioning. That design was **reversed**, because the tag trigger cannot express the one guarantee this capability is for:

- A tag-triggered workflow fires on _any_ matching tag, from _anyone_. Nothing in the workflow knows whether Buildkite passed on that commit — the coupling is a sentence in `RELEASING.md`. A release could be published for a commit CI never saw.
- The request was explicitly "a stage that can build and validate the code, then publish". A release step that `depends_on: build` inside the pipeline _is_ that stage; a separate workflow on a tag is not.
- The generator already has the machinery: `getBuildkiteTemplateData` composes capability-driven steps, and the deploy step is the precedent for the shape.

The cost, accepted: the release needs a write-scoped token on the fleet. It is resolved from Doppler at run time (§6) rather than sitting in the agent's environment hook, so it is no more exposed than the deploy step's Cloudflare credentials.

### No generation-time side effect

Unlike `circleci` and `buildkite`, this capability makes **no GitHub API call during generation**. The release step is committed as pipeline content and the first release happens when the first build on the default branch finishes. `src/clients/github-api.js`, `project-generator.js` and `project-context.js` are untouched.

The cost of that choice is the thing to watch: generation cannot _prove_ the release works. §7 is therefore a manual gate, not an automatic one.

---

## 4. Templates and generated content

| Artifact                       | Shape                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pipeline `release` step        | label/key/depends_on/if, docker plugin with `mount-buildkite-agent: true`, gh install, token resolution, version + tag, artifact download, artifacts hook, single `gh release create` |
| pipeline `build` step          | gains `artifact_paths:` when the capability is selected — the upload half of the hand-off                                                                                             |
| `.github/release.yml`          | GitHub's release-notes classification (Features / Fixes / Dependencies / Other), consumed by `--generate-notes`                                                                       |
| `RELEASING.md`                 | the tag convention, the manifest and its target keys, how the artifacts travel, what is genproj-owned vs app-owned, prerequisites, and that the release is not a validator            |
| `scripts/release-artifacts.sh` | app-owned hook: packages `dist/` into `<project>-<version>.tar.gz` by default, with a commented per-platform example                                                                  |

### The `gh release create` flag set

The rendered command is fixed:

```
gh release create "$TAG" --title "$TAG" --generate-notes --verify-tag [release/*]
```

Notes always come from the release's merged pull requests, classified by `.github/release.yml` (`--generate-notes`); the release is always published, never a draft and never flagged pre-release; `--verify-tag` fails the step if the tag was not created rather than publishing a release anchored to nothing. `--generate-notes` is also the flag that keeps the step non-interactive — `gh release create` opens an editor when given no notes flag, which hangs in CI.

`generateNotes`, `draft` and `prerelease` were configuration parameters at first. They were removed because their defaults (`true`, `false`, `false`) suit every project genproj has generated: a project that wants a draft or a pre-release can re-expose them later.

`tagPrefix` was later removed for the same reason. It stayed configurable at first on the grounds that it is the one genuinely project-specific choice, but the prefix is written and read only by the release step: `v*` is both what the lookup scans and what the tag is built from, so a different prefix only means a different string in the same two places. The one case it served — adopting a repository that already carries a differently-prefixed tag series — is recoverable by re-tagging, and does not justify a knob every other project leaves at `v`. The tag convention is now fixed at `v`, quoted in `RELEASING.md` as a convention rather than a setting.

### The artifact hand-off

The build step's `artifact_paths:` are derived, never guessed. With `targets` empty they are the language's conventional output directory; with `targets` set they are one pattern per target, and the language default is not unioned in:

| `targets` | language | `artifact_paths`       |
| --------- | -------- | ---------------------- |
| empty     | node     | `dist/**`              |
| empty     | rust     | `target/release/**`    |
| empty     | python   | `dist/**`              |
| empty     | java     | none — notes only      |
| non-empty | rust     | `build/<target>/**` ×N |

The target case **replaces** rather than augments, deliberately: `build/<target>/**` is the contract `scripts/release-artifacts.sh` packs and the launcher's manifest keys are built from, so the per-target build step writes its payload there and nothing else is carried. The language default would only add bytes the release then has to ignore.

`buildkite-agent artifact download` exits non-zero when nothing matches, which is the normal case for a project that outputs elsewhere, so the release step treats a miss as "notes only" rather than as a failure. That is what makes the generated pipeline work out of the box before anyone has corrected the paths for their project: a wrong guess costs nothing until the build produces output.

The same list is rendered twice — into the build step's `artifact_paths:` and into the release step's `download` — from one array. They cannot disagree.

### Per-target artifacts and the manifest

`targets` is the capability's one configuration option: an array of Rust-triple labels (`aarch64-apple-darwin`, `x86_64-unknown-linux-musl`, …), empty by default. It exists because a single artifact is only the right answer for a project that ships one platform, and a project that ships several needs one build per platform — with the labels also the vocabulary a launcher resolves against, so the pipeline's matrix and the consumer's lookup consume the same table rather than two spellings of the same idea.

`scripts/release-artifacts.sh` writes `manifest.json` last, after every asset exists, so a manifest never advertises a file that is not there. Releases are fetched at the version-agnostic URL `releases/latest/download/manifest.json`, which is what makes an asset name embedding a version unlaunchable: version and hash belong in the manifest, the asset name carries the target only. Each asset is keyed by its target, with `any` reserved for an architecture-independent payload (a JS bundle, a pure-python `.pyz`). `sha256` is computed next to the packing that produced the file.

**Deliberately not configurable** (see §8 Q1). `artifact_paths:` and the matching `download` both live in `.buildkite/pipeline.yml`, which is genproj-owned and rewritten on regeneration, so a project that outputs somewhere else re-applies the edit after regenerating. That cost is accepted rather than paid for with a knob, for the reasons in §8 Q1; the app-owned hook (`scripts/release-artifacts.sh`) is where "what gets shipped" is actually decided.

### The per-target build step

Each target gets one step, and it builds into `build/<target>/bin/`. Two details of that step are load-bearing, and both were found by running it rather than by reading it:

- **The payload goes under `bin/`.** The consumer the manifest exists for execs `current/bin/<name>`, and `scripts/release-artifacts.sh` packs the _contents_ of `build/<target>/`, so a binary left at the top of that directory yields a tarball with no `bin/` in it. Nothing earlier notices: the manifest key resolves, the sha256 matches, the unpack and the symlink flip succeed, and the process then finds nothing to run. A rust project gets the layout for free; a project publishing the architecture-independent `any` artifact does not, because a bundle's entry point is its own choice — `LAUNCHING.md` says so where the packing is documented.
- **A musl target needs a C toolchain named explicitly, and for the _target's_ architecture.** `musl-tools` is a host-architecture package, so on the fleet's `linux/arm64` containers a bare install provides an arm64 `musl-gcc` and does nothing for an x86_64 target; and installing it is not sufficient alone, because rustc's final link otherwise goes through the host `cc` and dies with `cc: error: unrecognized command-line option '-m64'`. The step therefore adds the target's dpkg architecture (`musl-tools:amd64`) _and_ sets `CARGO_TARGET_<TRIPLE>_LINKER=musl-gcc`. The plausible-looking `CC_<triple>` is the wrong knob: the `cc` crate reads it for build scripts, rustc's link does not.

The darwin step carries no docker plugin at all — a macOS binary cannot be linked inside a Linux container — so it runs on the agent host, which is why the queue's Macs need the toolchain installed on the host and not only in the image. Tests run **once**, in the first target's step, because a cross-compiled binary cannot be executed by the host that built it.

### Verifying the pipeline

`tests/generator/file-generator-github-release.test.js` asserts, against the rendered `.buildkite/pipeline.yml`:

- the release step exists with `key: release`, `depends_on: - build` and `if: build.branch == "main"`;
- it creates the tag (`git tag -a`, `git push origin "refs/tags/$TAG"`) and publishes (`gh release create`, always `--generate-notes`, never `--draft`, `--prerelease` or `--notes-from-tag`);
- it resolves the token at run time and never writes it to the repository;
- the build step uploads `artifact_paths` and the release step downloads the same patterns, with `mount-buildkite-agent: true` so `buildkite-agent` is callable in the container;
- the release step contains no `npm install`, `npm run build` or `cargo build` — the no-rebuild property, asserted by slicing the release step out of the file so the build step's own `npm run build` does not satisfy it;
- the paths follow the language, and a language with no known output releases notes only;
- the tag prefix is fixed at `v` (`git tag --list 'v*'`, `TAG="v$VERSION"`), a `tagPrefix` left in a saved configuration does not change the render, and the release flags stay fixed;
- without the capability, neither the step nor `artifact_paths` appears and the hook is not emitted.

### End-to-end verification

**Not yet run.** It needs a real repository, a real Buildkite agent and a real tag, none of which the build sandbox had. The gate is: generate a repo with `buildkite` + `github-release`, merge to the default branch, confirm the build uploads artifacts, the release step downloads them, a `v0.1.0` tag is pushed, and a published Release with notes and assets appears at `/releases`. Clear this before the capability is treated as proven.

---

## 5. Secrets

- **`GITHUB_RELEASE_TOKEN`**, fine-grained PAT, `Contents: read and write`, stored in Doppler `common/prd` (mirroring `GHCR_UPDATE_TOKEN`). The container forwards only `DOPPLER_TOKEN`; the release step resolves the value at run time, so the token is never in the repository and never in the agent's environment hook, where every job on the fleet could read it.
- Without the `doppler` capability the step expects `GH_TOKEN` on the agent — the same fleet-side contract the deploy step uses for `CLOUDFLARE_*`, documented in `RELEASING.md`.
- Pushing the tag uses the token explicitly (`credential.helper`), so the release does not depend on whatever credentials the agent cloned with, and the token does not land in the remote URL, in logs, or in `.git/config`.

---

## 6. UI touchpoints

`CapabilitySelector` renders from the catalog, so the capability appears with no UI code.

It sits in **`deployment`**, next to the other capabilities whose output is a published build artifact: `docker-container` pushes an image to GHCR, `cloudflare-wrangler` pushes a Worker, and this pushes a GitHub Release. `ci-cd` was the first choice and is wrong for the picker — that heading is read as "which CI provider", and this capability is explicitly not one (it _requires_ `buildkite`). Grouping it with the deploy targets is also where someone looking for "how does this project ship?" will look.

Two cosmetic gaps live in the client, not here: `CapabilitySelector` has hardcoded icon and colour maps keyed by capability id, so `github-release` falls back to a generic globe and grey until an entry is added.

---

## 7. Implementation touchpoints

| Concern                       | File                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Capability entry              | `src/catalog/catalog.json`                                                                                |
| Capability → template wiring  | `src/generator/capability-templates.js`                                                                   |
| Templates                     | `src/generator/templates/github-release-{notes,readme,artifacts}.template`                                |
| Release step + artifact paths | `src/generator/capability-template-utils.js` (`getBuildkiteTemplateData`, `getGithubReleaseTemplateData`) |
| Template inlining             | `src/generator/templates.generated.js` (regenerated by `scripts/build-templates.mjs`)                     |
| Contract + reasoning          | `specs/007-genproj-github-release/`                                                                       |
| Tests                         | `tests/generator/file-generator-github-release.test.js`                                                   |

No client and no generation-time side effect (§3).

### `catalogVersion` was removed, not maintained

This spec originally recorded that `catalogVersion` "does not recompute itself" and that the value was bumped by hand (`bf736d10a27a` → `2b96617761f7`). The conclusion drawn from that was not "add the missing script" but "this field earns its keep nowhere":

- the catalog is cheap to fetch and changes rarely, so there is little to save by caching it conditionally;
- nothing could ever keep the hash honest. It hashed capability metadata only, so a template edit changed generated output without changing the version — a client could sit on a stale copy and never know.

So the field, its `ETag`/`304` machinery (`jsonWithEtag`, `matchesEtag`) and its `schema.json` entry were deleted, and `/v1/catalog` is now cached by `Cache-Control: public, max-age=300` alone. That is a separate change from this capability and is not part of it.

---

## 8. Open questions

1. **~~Should the artifact paths be configuration?~~ Resolved — no.** They stay genproj-owned. The request that produced this question was framed as a seam: §4 leaves the paths in genproj-owned pipeline content, so a project that outputs elsewhere re-applies the edit after regeneration. On the evidence, the knob is not worth its surface:
   - **The default is already derived from a declared fact, not guessed.** Since Primary Language is declared (§3), `dist/**` / `target/release/**` is the language's own convention. There is nothing project-specific left for a project to tell us, and `artifact_paths:` fails _silently_ when a pattern matches nothing — so a declared-but-wrong path is indistinguishable from a correct one that produced nothing. A knob would turn a visible no-op into an invisible one.
   - **It would compete with `targets`, and lose.** The per-target half is already configuration, and its path is load-bearing: `build/<target>/**` is the contract `scripts/release-artifacts.sh` packs and the key the manifest exposes. A free-form override could point the upload away from `build/<target>/` and break the packing and manifest halves **without failing anything** — a notes-only release whose manifest advertises nothing, which is precisely the outcome the fail-open reasoning everywhere else is trying to make loud.
   - **It would move the seam, not remove it.** What a project actually wants to change is _what gets shipped_, and that is `scripts/release-artifacts.sh` — app-owned, seeded once, never overwritten. The upload/download pair only carries the build output to the release step; a project that changes its output directory has changed its build commands anyway, and the conventional-directory default is correct for everything genproj has generated.
   - **The `tagPrefix` precedent applies.** `generateNotes`, `draft`, `prerelease` and `tagPrefix` were all removed for the same reason: the renderer could answer for every project that exists, and no project ever varied them. A knob every project leaves at the default is not neutral — it is a surface that can be set wrong.

   What would justify reopening it: a project whose toolchain has **two** conventional output directories (e.g. a node project that must ship `dist/**` **and** a second tree), or a target matrix that also needs a non-target artifact alongside `build/<target>/**`. Neither has appeared. If one does, the shape to add is a **per-language** default override that cannot shadow the per-target patterns — not a free-form array.

2. **Should generation cut a first release?** A side effect that tags `v0.1.0` would exercise the whole mechanism end to end and mirror `buildkite`'s `triggerFirstBuild`. It was rejected for v1 because it makes generation mutate release state for every project.
3. **`RELEASING.md` vs `CONTRIBUTING.md`.** A release documented in its own file is one more root markdown file; folding it into an existing doc is possible once the release grows assets.
4. **Does the release need to be a `block` step?** v1 deliberately made it automatic, like the deploy step. A manual gate would let every merge to the default branch _not_ cut a release, at the cost of the "no human does the mechanics" property. Recorded because it was explicitly asked for and explicitly removed.
