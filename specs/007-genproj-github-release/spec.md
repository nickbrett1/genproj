# Feature Specification: genproj "GitHub Releases" Capability

**Status**: Draft (v1 scope: capability + generated release workflow)
**Created**: 2026-09-13
**Motivating use case**: a generated project should be able to **ship a release** — a tag produces a published GitHub Release with notes, and no human does the mechanics. Requested alongside `buildkite` for the `a2a-goose` node agent, whose deploy channel is a GitHub Release consumed by a boot-fetch launcher.
**Depends on**: nothing. The capability is deliberately independent of `buildkite` or any other CI capability.
**Reference implementation**: `specs/006-genproj-buildkite/spec.md` — closest in shape (CI-CD-adjacent, `specs/00N` + `contracts/`, a generator-internal template mapping).

---

## 1. Problem

The generator can create a repository, wire CI, provision secrets and open dependency PRs, but it cannot **ship**. Every existing release-shaped flow ends at "a human tags the commit, then a human drafts a release in the GitHub UI and writes notes." That is the one part of the lifecycle genproj does not remove, and it is exactly the part the `a2a-goose` boot-fetch launcher depends on (`releases/latest/download/<asset>` only resolves to a real Release).

The goal is narrow and mechanical: **push a tag → a published GitHub Release with notes exists.** No drafting, no notes to write, no token for a user to paste in.

### Non-goals (v1)

- **Release assets.** Building and attaching artifacts (installers, launchers, `manifest.json`) is a separate, language- and target-specific concern. It was the reason the `a2a-goose` memo wanted this capability, but its contract (`genproj-github-release-capability` §5/§6) is not captured anywhere this repository can see. Shipping an asset pipeline against an unavailable contract would be guessing, so v1 creates the release and its notes and stops there.
- **A second validator.** Buildkite remains the only thing that reports on pushes and pull requests; see §3.
- **Nothing in `ftn`.** The picker renders whatever the catalog returns, so a well-formed entry appears with no client work.

---

## 2. Capability definition

Machine-readable contract: `contracts/github-release.capability.json`. Summary:

| field                 | value                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| `id`                  | `github-release`                                                       |
| `category`            | `ci-cd`                                                                |
| `dependencies`        | `[]` — the tag push is the trigger; nothing else has to be selected    |
| `conflicts`           | `[]`                                                                   |
| `requiresAuth`        | `[]`                                                                   |
| `authServices`        | `[]`                                                                   |
| `externalServices`    | `[]` — no generation-time GitHub call is made (see §3)                 |
| `configurationSchema` | `tagPattern`, `generateNotes`, `draft`, `prerelease`                   |
| `templates`           | `.github/workflows/release.yml`, `.github/release.yml`, `RELEASING.md` |

Deliberately **not** in the v1 schema:

- `assets` — see the non-goal above. It is the first thing a v2 adds, with the artifact contract.
- A `provision…` toggle. The `buildkite` entry has `provisionPipeline` because creation is an API side effect with a failure mode. Here there is nothing to provision: the workflow file is the whole mechanism, so a toggle would be dead configuration.

---

## 3. Flow: how a release happens

```
git tag v1.2.3 && git push origin v1.2.3
        │
        ▼
.github/workflows/release.yml   (on: push: tags: [<tagPattern>])
        │
        ▼
gh release create "$GITHUB_REF_NAME" \
  --title … --generate-notes [--draft] [--prerelease] --verify-tag
        │
        ▼
published GitHub Release, notes classified by .github/release.yml
```

Three properties are load-bearing:

1. **The trigger is the tag, not a branch.** `on: push: tags:` only. A branch push or a pull request never reaches this workflow.
2. **The token is GitHub's own.** The run uses `${{ github.token }}` with `permissions: contents: write`. There is no PAT to provision, and nothing for a user to paste in — this is the "deployment's existing credentials" the request asked for.
3. **It is not a validator.** Because it runs on tags only, it cannot report on a branch, so Buildkite's role as the sole validator is untouched. This is the capability's answer to the repo-wide "Buildkite is the only validator" rule, and it is the reason the release mechanism is a GitHub Actions workflow rather than a Buildkite step.

### Why GitHub Actions and not a Buildkite step

The `a2a-goose` planning memo describes the release job living in `.buildkite/pipeline.yml` ("plus a release job that runs only on tags"). That is a viable shape too, and the generator already has the machinery for capability-driven Buildkite steps (`getBuildkiteTemplateData`). It was **not** chosen here, for two reasons:

- **Blast radius.** A Buildkite release step runs inside the shared self-hosted fleet, needs a release-write token in the agent's environment hook, and — if it ever grew an `if:` bug — could report on a branch. A tag-scoped GitHub Actions workflow cannot touch the validator, and its credential is scoped to the one run.
- **The generator's own precedent.** `dependabot` already emits a GitHub Actions workflow (`.github/workflows/dependabot-auto-merge.yml`) next to the Buildkite pipeline. A tag-only release workflow is the same pattern, and it needs no new client, no side effect and no new dependency.

This is a genuine divergence from the `a2a-goose` memo and is called out here rather than discovered later. If the release must be a Buildkite step, that is a v2 decision with its own consequences for the agent's environment hook.

### No generation-time side effect

Unlike `circleci` and `buildkite` (which call an API after the first commit), this capability makes **no GitHub API call during generation**. There is nothing to create: the workflow is committed as a file, and the first release happens when the first tag is pushed. Like `dependabot`, it is configured entirely by its generated files — so `src/clients/github-api.js`, `project-generator.js` and `project-context.js` are all untouched.

The cost of that choice is the thing to watch: generation cannot _prove_ the release works, because it never pushes a tag. The end-to-end verification in §4 is therefore a manual gate, not an automatic one.

---

## 4. Templates

Three files. `.github/workflows/release.yml` is the mechanism; the other two exist because the first is unusable without them.

| Template                        | Shape                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/release.yml` | tag-triggered workflow; checks out the tagged commit with full history, then `gh release create` with the configured flags                             |
| `.github/release.yml`           | GitHub's release-notes classification (Features / Fixes / Dependencies / Other), consumed by `--generate-notes`                                        |
| `RELEASING.md`                  | the contract a generated repo cannot express in code: the tag pattern, the prerequisites, that the release is tag-only, and that it is not a validator |

`RELEASING.md` is required rather than nice-to-have: without it the first question on a failed release is "is CI broken?", and the answer (Buildkite is the validator; the release workflow is a different thing) is nowhere else in the repository.

### The `gh release create` flag set

The rendered command is assembled from the configuration, one flag per line:

| configuration   | effect on the command                                                |
| --------------- | -------------------------------------------------------------------- |
| `generateNotes` | `--generate-notes` (default) or `--notes-from-tag`                   |
| `draft`         | adds `--draft`                                                       |
| `prerelease`    | adds `--prerelease`                                                  |
| `tagPattern`    | the `on: push: tags:` glob, and the pattern quoted in `RELEASING.md` |

`--notes-from-tag` is the non-interactive alternative to `--generate-notes`: `gh release create` opens an editor when given neither flag, which hangs in CI. There is deliberately no third "no notes" mode.

### End-to-end verification

**Not yet run.** It needs a real GitHub repository and a real tag push, and neither the sandbox this was built in nor the author's session had GitHub egress. The gate is: generate a repo with `github-release`, push a tag matching the pattern, confirm the workflow runs and a published Release with notes appears at `/releases`. This must be cleared before the capability is treated as proven — see §8.

What _is_ verified locally:

- the files are emitted at the declared paths, and absent without the capability (a `tests/generator/` test asserts both);
- a non-default configuration (`tagPattern: "release-*"`, `generateNotes: false`, `draft: true`, `prerelease: true`) renders correctly — previewed live against `generatePreview` and asserted in the test.

---

## 5. Secrets

- **None.** The workflow uses the repository's own `GITHUB_TOKEN`, scoped by `permissions: contents: write` to the run. No `GH_TOKEN`, no PAT, no Doppler value, nothing in the generated repo.
- This is a deliberate contrast with `docker-container` (a classic PAT with `write:packages`) and `circleci` (tokens in a context): the feature exists precisely so release mechanics need no credential a human manages.

---

## 6. UI touchpoints

`CapabilitySelector` renders from the catalog, so the capability appears with no UI code. The `ci-cd` category currently reads as CI-shaped; this entry's `description`/`benefits` state explicitly that it is a release mechanism and not a second CI, so it does not read as "another CI provider".

---

## 7. Implementation touchpoints

| Concern                        | File                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Capability entry               | `src/catalog/catalog.json` (+ `catalogVersion`)                                       |
| Capability → template wiring   | `src/generator/capability-templates.js`                                               |
| Templates                      | `src/generator/templates/github-release-*.template`                                   |
| Template data (`{{…}}` values) | `src/generator/capability-template-utils.js` (`getGithubReleaseTemplateData`)         |
| Template inlining              | `src/generator/templates.generated.js` (regenerated by `scripts/build-templates.mjs`) |
| Contract + reasoning           | `specs/007-genproj-github-release/`                                                   |
| Tests                          | `tests/generator/file-generator-github-release.test.js`                               |

No client, no external-service integration, no generation-time side effect (§3).

### A note on `catalogVersion`

`src/catalog/index.js` documents `catalogVersion` as "a content hash of the capability list", and the task brief says it "recomputes itself". **It does not**: there is no script, test or hook in this repository that recomputes it, and `tests/catalog.test.js` only checks the shape and self-consistency of the stored value.

The algorithm was recovered from the existing value and confirmed: `sha256(JSON.stringify(capabilities)).slice(0, 12)`. It was recomputed by hand for this change (`bf736d10a27a` → `2b96617761f7`). If a recompute step is supposed to exist, it is missing here; adding one is worth doing and is **not** in this change.

---

## 8. Open questions

1. **Is the release really a GitHub Actions workflow, or a Buildkite step?** §3 chose Actions for blast-radius and credential scope, diverging from the `a2a-goose` memo. If the fleet's rule is "nothing but Buildkite runs", this flips, and the agent's environment hook becomes the token path.
2. **Release assets.** The `a2a-goose` deploy channel needs them. That contract lives in a memo this repository cannot read; it should be captured before the asset pipeline is built.
3. **Should generation cut a first release?** A side effect that tags `v0.1.0` would exercise the workflow end to end and mirror `buildkite`'s `triggerFirstBuild`. It was rejected for v1 because it makes generation mutate release state (and fires the workflow) for every project, which is a bigger behavioural commitment than a workflow file.
4. **`RELEASING.md` vs `CONTRIBUTING.md`.** A release documented in its own file is one more root markdown file; folding it into an existing doc is possible once the release grows assets.
