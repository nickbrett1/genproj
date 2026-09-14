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
| `configurationSchema` | `tagPrefix` — the only knob; everything else about the release is fixed                         |

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
        ├─ VERSION = patch bump of the newest <prefix>* tag; TAG = <prefix>VERSION
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
| `RELEASING.md`                 | the tag prefix, how the artifacts travel, what is genproj-owned vs app-owned, prerequisites, and that the release is not a validator                                                  |
| `scripts/release-artifacts.sh` | app-owned hook: packages `dist/` into `<project>-<version>.tar.gz` by default, with a commented per-platform example                                                                  |

### The `gh release create` flag set

The rendered command is fixed:

```
gh release create "$TAG" --title "$TAG" --generate-notes --verify-tag [release/*]
```

Notes always come from the release's merged pull requests, classified by `.github/release.yml` (`--generate-notes`); the release is always published, never a draft and never flagged pre-release; `--verify-tag` fails the step if the tag was not created rather than publishing a release anchored to nothing. `--generate-notes` is also the flag that keeps the step non-interactive — `gh release create` opens an editor when given no notes flag, which hangs in CI.

`generateNotes`, `draft` and `prerelease` were configuration parameters at first. They were removed because their defaults (`true`, `false`, `false`) suit every project genproj has generated: a project that wants a draft or a pre-release can re-expose them later. `tagPrefix` stays configurable because it is the one genuinely project-specific choice — it is quoted in `RELEASING.md` and used for the `<prefix>*` lookups that derive the next version.

### The artifact hand-off

The build step's `artifact_paths:` follow the language's usual output directory:

| language     | `artifact_paths`    |
| ------------ | ------------------- |
| node         | `dist/**`           |
| rust         | `target/release/**` |
| python, java | none — notes only   |

`buildkite-agent artifact download` exits non-zero when nothing matches, which is the normal case for a project that outputs elsewhere, so the release step treats a miss as "notes only" rather than as a failure. That is what makes the generated pipeline work out of the box before anyone has corrected the paths for their project: a wrong guess costs nothing until the build produces output.

**Known seam.** `artifact_paths:` and the matching `download` both live in `.buildkite/pipeline.yml`, which is genproj-owned and rewritten on regeneration. A project that outputs somewhere else has two options: re-apply the edit after regenerating, or edit the app-owned `scripts/release-artifacts.sh` instead. Making the paths a capability configuration option would close the seam properly and is the obvious v2 change; it is not in v1 because the request was for a working default plus a hook, and the hook (`scripts/`) already exists.

### Verifying the pipeline

`tests/generator/file-generator-github-release.test.js` asserts, against the rendered `.buildkite/pipeline.yml`:

- the release step exists with `key: release`, `depends_on: - build` and `if: build.branch == "main"`;
- it creates the tag (`git tag -a`, `git push origin "refs/tags/$TAG"`) and publishes (`gh release create`, always `--generate-notes`, never `--draft`, `--prerelease` or `--notes-from-tag`);
- it resolves the token at run time and never writes it to the repository;
- the build step uploads `artifact_paths` and the release step downloads the same patterns, with `mount-buildkite-agent: true` so `buildkite-agent` is callable in the container;
- the release step contains no `npm install`, `npm run build` or `cargo build` — the no-rebuild property, asserted by slicing the release step out of the file so the build step's own `npm run build` does not satisfy it;
- the paths follow the language, and a language with no known output releases notes only;
- a non-default tag prefix (`tagPrefix: "release-"`) renders `<prefix>*` lookups correctly, while the release flags stay fixed;
- without the capability, neither the step nor `artifact_paths` appears and the hook is not emitted.

### End-to-end verification

**Not yet run.** It needs a real repository, a real Buildkite agent and a real tag, none of which the build sandbox had. The gate is: generate a repo with `buildkite` + `github-release`, merge to the default branch, confirm the build uploads artifacts, the release step downloads them, a `<prefix>0.1.0` tag is pushed, and a published Release with notes and assets appears at `/releases`. Clear this before the capability is treated as proven.

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

1. **Should the artifact paths be configuration?** §4 leaves them in genproj-owned pipeline content, so a project that outputs elsewhere re-applies the edit after regeneration. A `github-release.artifactPaths` array would close the seam; it needs a decision on whether the generated default is per-language or per-project.
2. **Should generation cut a first release?** A side effect that tags `<prefix>0.1.0` would exercise the whole mechanism end to end and mirror `buildkite`'s `triggerFirstBuild`. It was rejected for v1 because it makes generation mutate release state for every project.
3. **`RELEASING.md` vs `CONTRIBUTING.md`.** A release documented in its own file is one more root markdown file; folding it into an existing doc is possible once the release grows assets.
4. **Does the release need to be a `block` step?** v1 deliberately made it automatic, like the deploy step. A manual gate would let every merge to the default branch _not_ cut a release, at the cost of the "no human does the mechanics" property. Recorded because it was explicitly asked for and explicitly removed.
