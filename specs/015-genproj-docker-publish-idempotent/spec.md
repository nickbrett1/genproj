# 015 — the container publish skips work that already exists, and never races the keychain

**Status:** implemented (2026-09-21). Supersedes `016-genproj-docker-publish-plugin-path`
(same defect, an earlier fix that was reverted — see _Two fixes that did not hold_).

This is a defect record. It began as a red build that looked like noise and was
not: roost's first generation produced builds `#12`–`#16`, and **two different
kinds of red** are in them.

| build               | failed step      | what it was                                                                                   |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `#12`, `#13`, `#14` | `docker_smoke`   | the gate working: a dead image was rejected and `docker_publish` never ran (`waiting_failed`) |
| `#15`               | —                | passed, and published the image                                                               |
| `#16`               | `docker_publish` | **spurious**: died in `docker login` milliseconds in, on the same commit as `#15`             |

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

1. **The registry credential never touches the keychain.** It is exported as
   `DOCKER_AUTH_CONFIG` — a base64 `user:token` blob in the environment — so the
   CLI authenticates from that value and no credential helper is invoked at all.
   With nothing written to shared state, two jobs of one commit have nothing to
   race over.
2. **Skip what is already there.** `docker buildx imagetools inspect
"$IMAGE:$BUILDKITE_COMMIT"` and `exit 0` when it resolves, so the second
   build of a commit does not rebuild and repush the same tag.

## Why the credential has to be the environment, not a redirected config

The first fix redirected `DOCKER_CONFIG` at a per-job directory, on the premise
that a fresh, empty config directory has no `credsStore`, so `docker login`
would fall back to the plaintext file store and never touch the shared keychain.
**That premise is false on this host.** Measured read-only on `mac-studio-goose`
(docker 29.4.0, buildx v0.33.0, the same `~/.docker` the agents use):

- With `config.json` reduced to `{"auths": {}}` — **no `credsStore` at all** — the
  private `ghcr.io` manifest is fetched while `docker-credential-osxkeychain` is
  on `PATH`, and the _same_ command becomes an anonymous `401` once the helper is
  hidden from `PATH`. So the macOS CLI uses `osxkeychain` as a **default/native
  credential store even when none is configured**, and an empty or redirected
  `DOCKER_CONFIG` does not disable it.
- The keychain item is `srvr=ghcr.io`, `acct=nickbrett1`, class `inet`, in
  `login.keychain-db`; its `mdat` is `2026-09-21T11:55:04Z` — the instant of the
  `#17`/`#18` login race.

`DOCKER_AUTH_CONFIG`, by contrast, is **honoured and takes precedence over the
store**: a bogus value produces `403 Forbidden` even with the default config and
the helper present, and with the store disabled (`credsStore:""`) _and_ the
helper hidden, the real value returns the manifest while the bogus value fails
`403`. The environment variable alone carries the auth.

It also leaves `docker buildx` reachable, which the redirect did not (see below):
under `DOCKER_AUTH_CONFIG` both `docker buildx version` and
`docker buildx create --bootstrap` succeed, and the throwaway builder is removed.

## Two fixes that did not hold

Both are recorded because both are easy to reintroduce; neither is in the tree.

- **Per-job `DOCKER_CONFIG` + `docker login`** (015's first shape) was **ineffective**:
  as measured above, the empty redirected config still resolved `osxkeychain`, so
  the race survived. roost `#17` died with `-25299` _with the redirect in place_.
- **Adding a `cli-plugins` symlink to that redirect** (016) made the publish
  _reach_ buildx again, but only papered over the symptom: `DOCKER_CONFIG` is the
  root for **both** the config/contexts **and** `cli-plugins`, so redirecting it
  hides `docker buildx` — the publish died on `unknown flag: --bootstrap`, exit
  125, reported by docker's _root_ parser (the flag is real; the plugin was
  missing). The symlink fixes the discovery, not the keychain race 015 exists to
  stop. The two halves do not trade off, and 016 is superseded.

The CircleCI copy sets neither variable, so it was never affected by either
mistake.

## The shape that makes it work, and the trap it avoids

The step is **one** command. Buildkite runs each command of a step in its own
shell, so the credentials the step resolves are gone by the next command — and,
the part that makes a naive guard useless, **`exit 0` in one command does not
stop the commands after it**. Adding the guard as a new first command would have
read as correct, passed review, and skipped nothing. The tests pin the step to a
single command for that reason, not for tidiness.

The guard only skips on a **positive** answer: it is an `if` on success, so a
registry that cannot be reached falls through to the push. "Could not ask" must
never read as "already published", which would stop publishing while staying
green. (The package is private, so an unauthenticated guard never skips — always
safe, just never useful.)

## Not taken

- **Serialising the two builds** (a Buildkite `concurrency_group` keyed on the
  commit) would also have removed the race — at the cost of coupling two builds
  that have no business knowing about each other, and of a queue in which the
  loser waits for a publish it does not need.
- **Not firing the duplicate build at all** — suppressing the API
  `First build (genproj)` when the push webhook will build the same commit — is
  the cleaner root-cause fix and is deliberately _not_ attempted here: it
  changes when builds happen for every project, and it lives in the generation
  trigger rather than in the pipeline this defect is about. Worth revisiting on
  its own.

## The CircleCI copy is deliberately untouched

`_applyDockerContainerConfig` emits a second `docker buildx build`, for the
CircleCI `docker-publish` job, that still uses `docker login`. It runs inside
`cimg/base:stable` on CircleCI — no macOS keychain, one build per commit — so
neither half of this applies. It is left alone rather than made to match.

## How it is pinned

`tests/generator/file-generator-buildkite.test.js` → _Buildkite docker publish
(roost build 16 regression)_: the step is one command; it calls neither
`docker login` nor redirects `DOCKER_CONFIG`; it carries the credential in
`DOCKER_AUTH_CONFIG` ahead of the guard; the skip exists and precedes the build;
the skip is positive-only; the no-doppler channel gets both halves; and the step
still parses with `if`, `depends_on: [build, docker_smoke]` and `IMAGE`.

`diagnostics-builds-17-18.md` (this directory) holds the raw `#17`/`#18` log
excerpts the mechanism above was read from.
