# 013 — regeneration fits the Workers Free-tier subrequest budget

**Status:** implemented (2026-09-20).

This is a defect record. Regenerating an existing project (`overwrite: true`)
failed on the Cloudflare Workers **Free** tier, which caps a request at **50
subrequests** (Paid allows 1000). Generating a brand-new repo succeeded; adding
capabilities to an existing one blew the cap deterministically — a retry did not
help. The observed case: a project with 8 capabilities (~38 files) regenerated
with 3 more (~45 files total).

## The defect — two O(N) subrequest loops on the write path

Regeneration hit both hot spots:

| #   | Location                                                                                                       | Cost                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `github-api.js` `createMultipleFiles()` — one `POST /git/blobs` per file                                       | **N** blobs + 5 fixed (refs GET, commit GET, tree POST, commit POST, ref PATCH) |
| 2   | `project-generator.js` `commitFilesToRepository()` overwrite block — one `getFileContent()` per generated file | **N** content reads                                                             |
| 3   | `project-generator.js` `checkConflicts()` — the same per-file content loop                                     | **N** (separate invocation)                                                     |

For ~45 files: `45 + 5 + 45 ≈ 95` subrequests. A fresh 8-capability repo
(`38 + 5 = 43`) squeaked under 50; regeneration did not.

`Promise.all` makes loop 1 concurrent, but the platform caps the **count**, not
the concurrency.

## The fix

### Write: one GraphQL mutation replaces the N blob POSTs

`createMultipleFiles()` now calls the GraphQL v4 `createCommitOnBranch`
mutation, which carries every file's content in **one** request and commits
atomically: `{branch, message, expectedHeadOid, fileChanges: {additions,
deletions}}`. `expectedHeadOid` is required by the schema, so the branch head is
resolved first (1 subrequest). Callers still receive a commit (`{sha, url}`),
because Buildkite's first-build trigger needs `commit.sha`.

`FileAddition` is `{path, contents}` — **no mode field**. Every addition lands as
`100644`, so executable bits cannot be expressed through the mutation (upstream
confirms this). To keep `100755` on `.sh` files, a single follow-up Git Data API
commit (`tree` → `commit` → `ref`, 3 subrequests) re-points those blobs, using
locally computed blob SHAs — the content commit already created the blobs, so no
content is re-uploaded. This is a **second commit**, and is only made when a
`.sh` file is actually written.

### Read: one recursive tree fetch replaces the N content reads

`GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1` returns each blob's
`sha`, which _is_ the git blob hash. `computeGitBlobSha(content)` (in
`clients/git-blob.js`) computes the generated content's blob SHA with WebCrypto
(`sha1("blob " + byteLength + "\0" + content)`), so "absent / byte-identical /
diverged" is decided locally:

- path absent → create
- SHA equal → skip (idempotent)
- SHA differs → diverged → apply the ownership policy

Only the merge target (`.devcontainer/devcontainer.json`) needs real existing
content, so it is the one file read individually. If GitHub truncates a very
large tree, both call sites fall back to the old per-file content read
(correct, just expensive).

`checkConflicts()` uses the same tree+SHA test and fetches content only for the
genuinely diverged files (for the diff payload).

### Subrequest math (~45-file regeneration)

| Step                                   | Before  | After                      |
| -------------------------------------- | ------- | -------------------------- |
| blob POSTs                             | 45      | 0 (1 GraphQL mutation)     |
| content reads (commit path)            | 45      | 1 (recursive tree)         |
| fixed git calls                        | 5       | 1 (refs GET) + 1 (GraphQL) |
| exec-bit fix (only when `.sh` written) | 0       | +3 (tree/commit/ref)       |
| merge-target content read              | 0       | +1                         |
| **total**                              | **~95** | **~7** (2 without `.sh`)   |

### Semantics preserved (round-3/4/6 ownership model)

- resolution `keep` → skip; `overwrite` → full replace of a diverged file
- app-owned paths (`src/`, `tests/`, `scripts/`, `worker/`, `app/`, `lib/`, root
  `main.py`/`config.py`) → a diverged file is never silently replaced
- `GENPROJ_OWNED_SCRIPTS` (`scripts/cloud_login.sh` and the wrangler/doppler
  helpers) remain INFRA → fresh content wins
- infra files → fresh content wins
- `.devcontainer/devcontainer.json` → union-merge, still a no-op on re-merge
- byte-identical file → no write; a fully no-op regen creates no commit
- `.sh` → `100755`, everything else → `100644`

## Verification

- `tests/clients/git-blob.test.js` (new): `computeGitBlobSha` matches
  `git hash-object` (empty, text, UTF-8 multibyte, null).
- `tests/clients/github-api.test.js`: `createMultipleFiles` issues exactly one
  GraphQL mutation and **zero** blob POSTs; the `.sh` exec bit is restored by a
  single mode-fix commit; no mode-fix commit when there is no `.sh`; GraphQL
  errors surface; `getTree` returns a path → blob SHA map and ignores tree
  entries.
- `tests/generator/project-generator.test.js`: fresh create still works;
  diverged app file preserved; diverged infra replaced; genproj-owned scripts
  updated while user scripts survive; `keep`/`overwrite` resolutions; byte-
  identical files skipped and a fully no-op regen commits nothing; devcontainer
  union-merge is monotonic; `checkConflicts` reads content only for diverged
  files.
- Full suite: **689 passed** (56 files). `npm run lint`: 0 errors.

## Follow-ups (deliberately out of scope)

- The exec-bit fix is a second commit, so a regeneration that writes a `.sh` can
  fire two Buildkite webhook builds. Collapsing it to one commit would need a
  temporary branch (whose push is itself webhook-visible); not worth it here.
- `createOrUpdateFile()` still does a per-file GET + PUT. It is unused on the
  generation path; left as-is.
- `checkConflicts()` resolves the default branch with an extra `getRepository`
  call (1 subrequest) to keep reading the same ref the content API used to.
