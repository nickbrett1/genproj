# Diagnostics: roost builds #17 and #18 (read-only, 2026-09-21)

Scope: read-only investigation. No repository, host, keychain, or registry state
was changed. The host was inspected only through file reads and version/help/list
probes (no `docker build`, no `docker login`, no builder creation).

Pipeline: `nick-brett/roost`, commit `339a64484c90fbf39224d471d241223cc574a34e`
(the same commit as the spec-015 builds #15/#16). Both builds failed in
`docker_publish`.

The one-line headline, before the evidence:

> `--bootstrap` is **not** a latent, pre-existing failure. The identical command
> line passed on the same host and the same buildx in builds #9, #10, #11 and #15.
> It fails **because** the new `DOCKER_CONFIG="/tmp/bk-docker-$BUILDKITE_JOB_ID"`
> redirect made the `docker buildx` CLI plugin undiscoverable. And the redirect did
> **not** stop the shared macOS keychain being used: both publish jobs still hit
> `osxkeychain`, so the keychain race reproduced _with_ the redirect in place.

---

## 1. Build overview

| build | source  | message                       | created (UTC) | started (UTC) | finished (UTC) | state  |
| ----- | ------- | ----------------------------- | ------------- | ------------- | -------------- | ------ |
| #17   | webhook | Initial commit: Generated ... | 11:54:18.765  | 11:54:24.730  | 11:55:04.881   | failed |
| #18   | api     | First build (genproj)         | 11:54:19.662  | 11:54:25.038  | 11:55:04.911   | failed |

Same commit, triggered ~0.9 s apart (webhook + API `First build`).

### The two `docker_publish` jobs

| build | job id (UUID)                          | agent          | started (UTC) | finished (UTC) | exit | error                       |
| ----- | -------------------------------------- | -------------- | ------------- | -------------- | ---- | --------------------------- |
| #17   | `01a0c3d1-4093-4330-b4ec-96644aef1add` | `mac-studio-2` | 11:55:02.913  | 11:55:04.702   | 1    | keychain `-25299`           |
| #18   | `01a0c3d1-4122-426e-bb29-dceb4114cda0` | `mac-studio-1` | 11:55:03.080  | 11:55:04.746   | 125  | `unknown flag: --bootstrap` |

They **overlapped**: started 167 ms apart, both ran ~1.6–1.8 s, and their
`docker login` calls landed 5 ms apart (`11:55:04.553` vs `11:55:04.548`).

Both agents are workers of **one** `buildkite-agent` process on one host
(`mac-studio.local`), config `spawn=2`, `name="mac-studio-%spawn"`, running as
one user (`nick`) with one `$HOME` and therefore one login keychain. `mac-studio-1`
and `-2` are not two isolable machines.

---

## 2. Raw log excerpts

### 2.1 The verbatim command block both jobs received

From `get_build_failure_summary` / `get_job_env` (identical for #17 and #18),
the step is a **single** command:

```text
GHCR_USERNAME=nickbrett1
GHCR_TOKEN="$(curl -fsS -H "Authorization: Bearer $DOPPLER_TOKEN" "https://api.doppler.com/v3/configs/config/secret?project=common&config=prd&name=GHCR_UPDATE_TOKEN" | sed -n 's/.*"raw"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$GHCR_TOKEN" ]; then
  echo "GHCR_UPDATE_TOKEN is missing from Doppler (common/prd) - cannot publish." >&2
  exit 1
fi
# One shell on purpose: Buildkite runs each command in its own shell, so
# the credential above would be gone by the next one, and an exit 0 in a
# separate command would not stop the commands after it.
#
# The docker config is per JOB, never the shared ~/.docker keychain. Two
# builds of one commit log in at the same moment, and the loser used to
# die with "The specified item already exists in the keychain.
# (-25299)" before it ever reached buildx (see
# specs/015-genproj-docker-publish-idempotent).
export DOCKER_CONFIG="/tmp/bk-docker-$BUILDKITE_JOB_ID"
mkdir -p "$DOCKER_CONFIG"
BUILDX_BUILDER_NAME="bk-$BUILDKITE_PIPELINE_SLUG-$BUILDKITE_JOB_ID"
trap 'rm -rf "$DOCKER_CONFIG"; docker buildx rm "$BUILDX_BUILDER_NAME" >/dev/null 2>&1 || true' EXIT
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
# Skip if this commit is already published: the release step's ls-remote
# guard, for an image. Only a positive answer skips - if the registry
# cannot be reached the push still runs, because "could not ask" must
# never read as "already published".
if docker buildx imagetools inspect "$IMAGE:$BUILDKITE_COMMIT" >/dev/null 2>&1; then
  echo "$IMAGE:$BUILDKITE_COMMIT is already in the registry - skipping the build."
  exit 0
fi
docker buildx create --bootstrap --name "$BUILDX_BUILDER_NAME" >/dev/null
docker buildx build --builder "$BUILDX_BUILDER_NAME" --platform linux/amd64 \
  --cache-from type=registry,ref=$CACHE_REF \
  --cache-to type=registry,ref=$CACHE_REF,mode=max \
  -t $IMAGE:$BUILDKITE_COMMIT -t $IMAGE:latest --push .
```

So the `export DOCKER_CONFIG=...` line **is** present, ahead of the login, in the
single shell. The log echoes the **literal** `$BUILDKITE_JOB_ID` unexpanded — the
job id is **not** printed anywhere else in the log. The resolved dirs were:

- #17 → `/tmp/bk-docker-01a0c3d1-4093-4330-b4ec-96644aef1add`
- #18 → `/tmp/bk-docker-01a0c3d1-4122-426e-bb29-dceb4114cda0`

### 2.2 `docker_publish` job log — #17 (webhook, `mac-studio-2`)

Log head (lines 1–2 and 4 identify the agent/hook/checkout):

```text
$ /opt/homebrew/etc/buildkite-agent/hooks/environment
# DOPPLER_TOKEN added
~~~ Preparing working directory
$ cd /opt/homebrew/var/buildkite-agent/builds/mac-studio-2/nick-brett/roost
...
~~~ Running commands
$ # Resolved at run time, never stored in the repository and never in the
...            (whole command block echoed, lines 27–61)
```

Tail (the actual output):

```text
rn62: (blank)
rn63: error saving credentials: error storing credentials - err: exit status 1, out: `The specified item already exists in the keychain. (-25299)`
rn64: ^^^ +++
rn65: 🚨 Error: The command exited with status 1
rn67: user command error: exit status 1
```

The failing command is `echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin`.
No `Login Succeeded`. **The step died at the login, before any `buildx` line.**
The "already in the registry - skipping the build." line was never reached.

### 2.3 `docker_publish` job log — #18 (api, `mac-studio-1`)

```text
$ /opt/homebrew/etc/buildkite-agent/hooks/environment
# DOPPLER_TOKEN added
$ cd /opt/homebrew/var/buildkite-agent/builds/mac-studio-1/nick-brett/roost
...
~~~ Running commands
...            (whole command block echoed, lines 27–61)
```

Tail:

```text
rn62: (blank)
rn63: Login Succeeded
rn64: unknown flag: --bootstrap
rn65: (blank)
rn66: Usage:  docker [OPTIONS] COMMAND [ARG...]
rn67: (blank)
rn68: Run 'docker --help' for more information
rn69: ^^^ +++
rn70: 🚨 Error: The command exited with status 125
rn72: user command error: exit status 125
```

The failing command is
`docker buildx create --bootstrap --name "$BUILDX_BUILDER_NAME" >/dev/null`.
The `Usage: docker [OPTIONS] COMMAND [ARG...]` is **docker's own root parser**
usage, not buildx's — the `--bootstrap` flag was never seen by a buildx parser.
The guard line was never reached.

### 2.4 Grep results (both `docker_publish` logs)

`DOCKER_CONFIG|osxkeychain|keychain|Login Succeeded|credsStore`

| pattern           | #17                                                                                                                                  | #18                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `DOCKER_CONFIG`   | comment (l.39) + `export DOCKER_CONFIG="/tmp/bk-docker-$BUILDKITE_JOB_ID"` (l.44) + `mkdir -p "$DOCKER_CONFIG"` (l.45) + trap (l.47) | same                |
| `keychain`        | comment (l.41) + `error saving credentials ... (-25299)` (l.63)                                                                      | comment (l.41) only |
| `osxkeychain`     | —                                                                                                                                    | —                   |
| `Login Succeeded` | —                                                                                                                                    | l.63                |
| `credsStore`      | —                                                                                                                                    | —                   |

Nothing in either log mentions `osxkeychain` or `credsStore`; they are not echoed
by the step.

---

## 3. Is `docker login` / `DOCKER_CONFIG` used anywhere else in roost?

Committed pipeline `.buildkite/pipeline.yml` @ `339a644` (the commit both builds ran):

- `docker login` appears **once**, in the `docker_publish` step.
- `DOCKER_CONFIG` appears **once**, in the `docker_publish` step.
- The only step-level `env:` anywhere is `docker_publish`'s `IMAGE` /
  `CACHE_REF` (and `docker_smoke`'s `SMOKE_IMAGE`). No `DOCKER_CONFIG` in any
  `env:` block.
- There is no `.buildkite/hooks/` directory in the repository.

Other places a login could hide, checked:

- `.github/workflows/dependabot-auto-merge.yml` — no `docker login`.
- `scripts/cloud_login.sh` — Doppler/Tailscale only, no `docker login`.
- CircleCI is not present in this repo (no `.circleci/`).

So **no** release step, smoke step, or repository hook invokes `docker login`.

---

## 4. Is `DOCKER_CONFIG` set/shadowed anywhere?

On the host (`mac-studio.local`, user `nick`), read-only:

- Agent environment hook `/opt/homebrew/etc/buildkite-agent/hooks/environment`
  contains only the Doppler token file sourcing; it logs `# DOPPLER_TOKEN added`.
  It does **not** set `DOCKER_CONFIG`.
- `grep -Rns DOCKER_CONFIG /opt/homebrew/etc/buildkite-agent /etc/profile /etc/zprofile /etc/zshrc /etc/zshenv ~/.zshenv ~/.zprofile` → no matches.
- `launchctl getenv DOCKER_CONFIG` → unset (empty).
- `env | grep -i docker` → nothing.
- The running agent's env: `PATH=/Users/nick/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, `HOME=/Users/nick`, `SHELL=/bin/zsh`, and **no `DOCKER_CONFIG`**.
- `docker context ls`: `default` and `orbstack *`; contexts do not carry a
  `DOCKER_CONFIG`.

So the step's own `export` is the **only** thing that sets `DOCKER_CONFIG`. It is
not overridden later. Whatever happened in #17/#18, it is not "the export was
shadowed".

---

## 5. What resolves the keychain helper?

`~/.docker/config.json` for `nick`:

```json
{
  "auths": { "ghcr.io": {} },
  "credsStore": "osxkeychain",
  "credHelpers": { "gcr.io": "gcloud", ... },
  "currentContext": "orbstack",
  ...
}
```

- `credsStore: osxkeychain`, and `auths."ghcr.io"` is empty — the `ghcr.io`
  credential lives in the shared login keychain
  (`/Users/nick/Library/Keychains/login.keychain-db`), as a single
  internet-password item, service `ghcr.io`, account `nickbrett1`.
- `/usr/local/bin/docker-credential-osxkeychain` exists (symlink into OrbStack).

CLI identity: `/usr/local/bin/docker` → OrbStack, `docker 29.4.0`,
`buildx v0.33.0`.

The CLI binary **does** still contain the file-store warning string:

```text
WARNING! Your credentials are stored unencrypted in '%s'.
```

So if `docker login` had used the plaintext file store (`$DOCKER_CONFIG/config.json`),
it would have printed that warning. #18 printed only `Login Succeeded`, with no
warning — i.e. #18 used the **credential helper**, not the file store. #17
unambiguously used the helper (`-25299`). **Both jobs used the keychain.**

---

## 6. `--bootstrap`: version drift, or always broken there?

`docker buildx version` on the host: `github.com/docker/buildx v0.33.0`. Both
agents are the same process/binary on the same host, so there is **no buildx
version difference between `mac-studio-1` and `mac-studio-2`**.
`docker buildx create --help` lists `--bootstrap   Boot builder after creation`
— the flag is valid for this buildx.

History of the **identical** `docker buildx create --bootstrap --name "$BUILDX_BUILDER_NAME" >/dev/null` line:

| build | agent        | publish result | reached `buildx create`? | line outcome  |
| ----- | ------------ | -------------- | ------------------------ | ------------- |
| #9    | mac-studio-1 | passed         | yes                      | **succeeded** |
| #10   | mac-studio-2 | passed         | yes                      | **succeeded** |
| #11   | mac-studio-2 | passed         | yes                      | **succeeded** |
| #15   | mac-studio-2 | passed         | yes                      | **succeeded** |
| #16   | mac-studio-1 | failed         | no (died at login)       | never reached |
| #18   | mac-studio-1 | failed         | yes                      | **failed**    |

The line succeeded on `mac-studio-1` before (#9) and on `mac-studio-2` before
(#10, #11, #15). It is not version drift and not a latent always-broken line.

### Reproduced on the host (read-only)

With an **empty redirected config dir**, the buildx plugin is undiscoverable.
Reproduction of the CI command and the CI text:

```text
$ DOCKER_CONFIG=/tmp/bk-docker-probe2-<pid> docker buildx create --bootstrap --name probe-should-not-exist
unknown flag: --bootstrap

Usage:  docker [OPTIONS] COMMAND [ARG...]

Run 'docker --help' for more information
exit=125
```

(No builder was created — with the plugin unresolved, docker's own parser rejects
the command before buildx runs.)

The mechanism, measured:

```text
$ docker context ls                                       # default
NAME ... orbstack *  ...
$ DOCKER_CONFIG=$PROBE docker context ls                  # redirect honoured
NAME ... default *  ...                                   # orbstack gone
$ DOCKER_CONFIG=$PROBE docker buildx version
docker: unknown command: docker buildx    exit=1
$ DOCKER_CONFIG=$PROBE docker info --format '{{json .ClientInfo.Plugins}}'
[]                                        # no plugins at all
```

`buildx` is installed **only** as `~/.docker/cli-plugins/docker-buildx`
(a symlink into OrbStack). The system plugin dir
`/usr/local/lib/docker/cli-plugins` points at a Docker Desktop path that does not
exist, so there is no fallback. `DOCKER_CONFIG` is the root for _both_ the
config/contexts _and_ `cli-plugins`; redirecting it makes `docker buildx`
unresolvable. The bare-command form reports `unknown command: docker buildx`;
adding any trailing flag (as CI does) trips docker's root parser first and reports
`unknown flag: <flag>` with exit 125. Same condition, same cause — CI's exact text
is reproduced.

---

## 7. Reading of the evidence

1. **The keychain race was not fixed by the redirect.** The whole point of
   `DOCKER_CONFIG="/tmp/bk-docker-$BUILDKITE_JOB_ID"` was that a fresh empty dir
   has no `credsStore`, so `docker login` would fall back to the plaintext file
   store and never touch the shared keychain. Both jobs still used
   `osxkeychain`: #18's `Login Succeeded` with no file-store warning, and #17's
   `-25299`, are only jointly explicable if both jobs talked to the shared
   keychain and raced on the same `ghcr.io` item. The premise ("empty config dir
   ⇒ file store") did not hold in practice. The export was not overridden
   (section 4), so the helper is being resolved by the CLI despite the redirect.
   _Mechanism not fully pinned without a controlled login (out of scope for a
   read-only pass); the operational fact is pinned by the logs._

2. **The redirect introduced a new failure.** `DOCKER_CONFIG` also governs
   `cli-plugins`, so redirecting it hides `docker buildx` entirely. That is why
   #18 died at `docker buildx create --bootstrap` — and it would also have killed
   the skip guard (`docker buildx imagetools inspect`) and the build itself
   (`docker buildx build`). **`--bootstrap` is not a latent pre-existing failure**
   (section 6); the same line passed on both agents before, on the same
   buildx v0.33.0. The `--bootstrap` failure and the keychain failure share the
   same root change.

3. **Neither publish reached the guard**, so the "already in the registry -
   skipping the build." behaviour was never exercised. The guard's shape is
   untested by these builds, and the unit test that checks the step's _shape_
   (rather than _executing_ it) cannot catch either failure mode.

4. **The overlap is real and is the race precondition.** #17/#18 overlapped ~1.6 s
   with logins 5 ms apart, exactly the #15/#16 pattern. Suppressing the duplicate
   build would remove this precondition (section 8, option iii).

---

## 8. Decisions

Nothing implemented here; this is what the evidence supports and what would have
to be true.

### (i) Write the GHCR auth straight into the per-job `$DOCKER_CONFIG/config.json`

- _Evidence for:_ If docker resolves credentials from `$DOCKER_CONFIG/config.json`
  (which the context probe shows it does for `currentContext`), then an
  `auths.ghcr.io` entry with base64 `auth` means the file store is used and no
  helper is ever consulted — immune to the keychain race.
- _Evidence against / blocker:_ This keeps the very redirect that breaks
  `docker buildx`. The step would still fail at `docker buildx imagetools inspect`
  or `docker buildx create`, because with `DOCKER_CONFIG` redirected the
  `docker-buildx` plugin is undiscoverable. (i) as written is also inconsistent
  with the observed login behaviour: the redirect demonstrably did **not** stop
  the helper being used, so "no helper is ever consulted" is an assumption the
  evidence does not confirm on this host.
- _What would have to be true:_ either (a) the redirect is kept **and** the buildx
  plugin is re-provided under it (e.g. a `cli-plugins/docker-buildx` symlink, or
  a system plugin path that survives the redirect), or (b) `DOCKER_CONFIG` is
  scoped to the login only and unset for buildx (but then buildx push reads the
  shared keychain again — a read, which cannot collide, but it re-couples the
  step to the keychain). And the credential-store resolution under a redirect
  needs to be confirmed before relying on it.

### (ii) Version-gate or drop `--bootstrap` on `docker buildx create`

- The evidence **refutes** the premise. There is no buildx version difference
  (same host, same `v0.33.0`), `--bootstrap` is a valid flag for it, and the line
  passed in #9/#10/#11/#15. Dropping `--bootstrap` would not have saved #18:
  under the redirect, `docker buildx` is not a command at all, so the _next_
  buildx command (the guard, then the build) fails anyway.
- _What would have to be true:_ a genuine buildx-version-drift failure, where
  `create` lacks `--bootstrap` but `docker buildx` otherwise resolves. The
  evidence shows the opposite.

### (iii) Stop firing the duplicate build (suppress the API `First build (genproj)`)

- _Evidence for:_ The race only exists because two builds of one commit run
  concurrently on one host (`#15/#16`, `#17/#18`). Removing the duplicate removes
  the keychain collision at its source, and it is the cleaner root-cause fix the
  spec set aside for this defect.
- _Evidence against being sufficient alone:_ The DOCKER_CONFIG regression is
  **not** concurrency-dependent. A single clean build with the current step would
  still die at `unknown flag: --bootstrap`. (iii) removes the race, not the
  breakage.
- _What would have to be true:_ the keychain collision is the only failure mode.
  It is not — the buildx breakage is independent and affects every run.

### Ranking implied by the evidence

The strongest signal is that the `DOCKER_CONFIG` redirect is **both ineffective
against the keychain and actively harmful to buildx**. Before choosing (i)/(ii)/(iii),
rework the isolation so that it does not move the directory `docker` looks for
`cli-plugins` in — or stop redirecting `DOCKER_CONFIG` and isolate the credential
another way. (ii) is aimed at the wrong cause; (i) is necessary-but-not-sufficient
as written; (iii) is a genuine improvement that would still leave the buildx
failure in place on its own.

---

## 9. Open questions / caveats

- **Why the keychain was still used under an empty redirected `DOCKER_CONFIG`.**
  The logs pin the fact; the mechanism is not reproduced here because a login
  would write to the keychain/registry. Candidates to check on a controlled login
  (scratch keychain / throwaway host): (a) the CLI resolves `credsStore` from a
  path other than `$DOCKER_CONFIG/config.json` on this OrbStack build;
  (b) `credsStore` is supplied some other way. Do **not** assume the empty-dir ⇒
  file-store fallback holds on this host until this is confirmed.
- **Ordering caveat for #18:** the exact CI text was reproduced on the host with
  the Buildkite agent's own PATH and docker (`/usr/local/bin/docker`), so the
  error is not an artifact of a different docker binary.
- **#17 never printed a buildx error**, consistent with dying at login; it did not
  disprove the buildx breakage (it never reached it). #18 is what proves it.
