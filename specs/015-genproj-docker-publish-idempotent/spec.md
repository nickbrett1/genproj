# 015 — the container publish skips work that already exists, and never races the keychain

**Status:** implemented (2026-09-21).

This is a defect record. It began as a red build that looked like noise and was
not: roost's first generation produced builds `#12`–`#16`, and **two different
kinds of red** are in them.

| build               | failed step       | what it was                                                                                 |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `#12`, `#13`, `#14` | `docker_smoke`    | the gate working: a dead image was rejected and `docker_publish` never ran (`waiting_failed`) |
| `#15`               | —                 | passed, and published the image                                                              |
| `#16`               | `docker_publish`  | **spurious**: died in `docker login` milliseconds in, on the same commit as `#15`             |

## The failure

Both builds were triggered for one commit — the push webhook and the API
`First build (genproj)` — and their publish steps started 37 ms apart
(`01:34:17.112` and `01:34:17.149`) on the **same host**: `mac-studio.local`,
two agents (`mac-studio-1`, `mac-studio-2`) behind the osxkeychain credential
helper. Both called `docker login`, the two keychain writes raced, and the loser
exited with:

```text
error saving credentials: error storing credentials - err: exit status 1,
out: `The specified item already exists in the keychain. (-25299)`
```

`#15`'s publish finished at `01:35:53`, 96 seconds later. It is intermittent
rather than deterministic: `#9`/`#10` and `#10`/`#11` were the same
double-trigger and all passed.

## Why the obvious guard is not the whole fix

Skipping when the commit is already published is the natural guard, and the
release step already has its equivalent (`ls-remote` will not re-create a tag
that exists). **On its own it would not have turned `#16` green.** The two
publish steps overlapped for their entire duration, so a check made at
`01:34:17` would have found nothing published on either job, and both would have
gone on to log in. The check removes duplicated work; it cannot remove a race
that happens before either job has published anything.

So the fix has two halves, and the second is the one that carries `#16`:

1. **The docker config is per job.** `DOCKER_CONFIG` points at
   `/tmp/bk-docker-$BUILDKITE_JOB_ID`, so `docker login` writes a job-local
   config file instead of the shared `~/.docker` keychain entry and two jobs
   cannot collide there. The `trap` removes the directory again: once docker has
   written auth into it, it holds the token in plaintext.
2. **Skip what is already there.** `docker buildx imagetools inspect
   "$IMAGE:$BUILDKITE_COMMIT"` and `exit 0` when it resolves, so the second
   build of a commit does not rebuild and repush the same tag.

## The shape that makes it work, and the trap it avoids

The step is now **one** command. Buildkite runs each command of a step in its
own shell, so the credentials the step resolves are gone by the next command —
and, the part that makes a naive guard useless, **`exit 0` in one command does
not stop the commands after it**. Adding the guard as a new first command would
have read as correct, passed review, and skipped nothing. The tests pin the step
to a single command for that reason, not for tidiness.

The guard only skips on a **positive** answer: it is an `if` on success, so a
registry that cannot be reached falls through to the push. "Could not ask" must
never read as "already published", which would stop publishing while staying
green.

## Not taken

- **Serialising the two builds** (a Buildkite `concurrency_group` keyed on the
  commit) would also have removed the race — at the cost of coupling two builds
  that have no business knowing about each other, and of a queue in which the
  loser waits for a publish it does not need.
- **Not firing the duplicate build at all** — suppressing the API
  `First build (genproj)` when the push webhook will build the same commit — is
  the cleaner root-cause fix and is deliberately *not* attempted here: it
  changes when builds happen for every project, and it lives in the generation
  trigger rather than in the pipeline this defect is about. Worth revisiting on
  its own.

## The CircleCI copy is deliberately untouched

`_applyDockerContainerConfig` emits a second `docker buildx build`, for the
CircleCI `docker-publish` job. It runs inside `cimg/base:stable` on CircleCI —
no macOS keychain, one build per commit — so neither half of this applies. It is
left alone rather than made to match.

## How it is pinned

`tests/generator/file-generator-buildkite.test.js` → *Buildkite docker publish
(roost build 16 regression)*: the step is one command; the config is exported
before the login and removed afterwards; exactly one login; the skip exists and
precedes the build; the skip is positive-only; the no-doppler channel gets both
halves; and the step still parses with `if`, `depends_on: [build, docker_smoke]`
and `IMAGE`.
