# Probe: which mechanism actually authenticates GHCR, without a login (read-only, 2026-09-21)

Untracked artifact. Not to be committed; a corrected writeup folds into spec 015.

**Question.** The spec-015 fix redirects `DOCKER_CONFIG` per job, which (a) did
not stop the shared macOS keychain being used and (b) broke `docker buildx`
because `DOCKER_CONFIG` is also the root for `cli-plugins`. Before writing
another generator change, measure which mechanism _actually_ authenticates the
Docker CLI on this host, read-only.

**Probe.** `docker buildx imagetools inspect ghcr.io/nickbrett1/roost:<tag>` — a
pure read (fetches a manifest, writes no credentials).

- **A** no auth at all → establishes public vs private.
- **B** `DOCKER_AUTH_CONFIG` (env), no login.
- **C** per-job `DOCKER_CONFIG` with a `config.json`, plus `cli-plugins` symlink
  (the fallback design).
- **D** `DOCKER_AUTH_CONFIG` must not disturb plugin discovery / daemon
  (buildx version; create + remove a throwaway builder).

**Rules.** No `docker login` ever. No `--push`. Clean up `/tmp/probe-dc` and any
throwaway builder. Record the keychain item's `mdat` before and after to show it
was not touched. Never print the token or its base64.

**Credential source actually used.** There is no GHCR secret in `genproj/dev`;
the credential is `GHCR_UPDATE_TOKEN` in `common/prd` (resolved on the host).

**Host.** mac-studio-goose (macOS, the same `~/.docker` / Docker CLI the two
Buildkite agents use). Docker 29.4.0 / buildx v0.33.0 per spec 015 diagnostics.

---

## Probe 1 — raw output (mac-studio-goose, 2026-09-21T12:16:43Z)

Host: user `nick`, HOME=/Users/nick, `docker 29.4.0` at `/usr/local/bin/docker`,
`buildx v0.33.0`. `DOCKER_CONFIG` unset, `DOCKER_AUTH_CONFIG` unset.
Credential resolved on-host via `doppler common/prd` (`GHCR_UPDATE_TOKEN`, len 40).

`~/.docker/cli-plugins` is a real directory holding symlinks, incl.
`docker-buildx -> /Applications/OrbStack.app/Contents/MacOS/xbin/docker-buildx`.

```text
============================================================
ENV
============================================================
date:                2026-09-21T12:16:43Z
user:                nick   HOME=/Users/nick
docker:              /usr/local/bin/docker   Docker version 29.4.0, build 9d7ad9f
buildx:              github.com/docker/buildx v0.33.0 f7897eba028583e0071642db3c011e860444f8cf
DOCKER_CONFIG env:   <unset>
DOCKER_AUTH_CONFIG:
cli-plugins dir:     total 0 ... docker-buildx -> /Applications/OrbStack.app/Contents/MacOS/xbin/docker-buildx ...
============================================================
KEYCHAIN mdat BEFORE
============================================================
before: <no item / could not read>
============================================================
CREDENTIAL LOOKUP (value NEVER printed)
============================================================
doppler: dev-3.76.5
credential: FOUND via doppler common/prd (length 40)
============================================================
A) NO AUTH
============================================================
$ docker buildx imagetools inspect ghcr.io/nickbrett1/roost:latest
Name:      ghcr.io/nickbrett1/roost:latest
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:dccb8ff99d4344fa3a679adaba28fba6308699a6e80f57a2476f0aff11f05d42
Manifests:
  Name:        ...:latest@sha256:2b71910d...  Platform: linux/amd64
  Name:        ...:latest@sha256:244422a0...  Platform: unknown/unknown (attestation-manifest)
exit=0

$ docker buildx imagetools inspect ghcr.io/nickbrett1/roost:339a64484c90fbf39224d471d241223cc574a34e
ERROR: ghcr.io/nickbrett1/roost:339a64484c90fbf39224d471d241223cc574a34e: not found
exit=1

$ anonymous GHCR tag list attempt
(no anonymous token -> package is PRIVATE)
============================================================
B) DOCKER_AUTH_CONFIG (no login)
============================================================
$ DOCKER_AUTH_CONFIG=<auth from common/prd> docker buildx imagetools inspect ...:latest
<same manifest as A>  exit=0

$ DOCKER_AUTH_CONFIG=<auth from common/prd> docker buildx imagetools inspect ...:339a6448...
ERROR: ... not found   exit=1
============================================================
C) per-job DOCKER_CONFIG + cli-plugins symlink
============================================================
$ DOCKER_CONFIG=/tmp/probe-dc docker buildx version
github.com/docker/buildx v0.33.0 ...   exit=0
$ DOCKER_CONFIG=/tmp/probe-dc docker buildx imagetools inspect ...:latest
<same manifest>  exit=0
============================================================
D) DOCKER_AUTH_CONFIG must not disturb plugin/daemon
============================================================
$ DOCKER_AUTH_CONFIG=<auth> docker buildx version
github.com/docker/buildx v0.33.0 ...   exit=0
$ DOCKER_AUTH_CONFIG=<auth> docker buildx create --name probe-30967 --bootstrap
#1 [internal] booting buildkit ... #1 DONE 1.9s
probe-30967   create exit=0
$ DOCKER_AUTH_CONFIG=<auth> docker buildx rm probe-30967
probe-30967 removed   rm exit=0
============================================================
CLEANUP
============================================================
removed /tmp/probe-dc
$ docker buildx ls
boring_cannon / infallible_johnson (pre-existing) ; default ; orbstack
============================================================
KEYCHAIN mdat AFTER
============================================================
after:  <no item / could not read>
UNCHANGED: YES

REPORT FILE: /tmp/probe-auth-report.log
```

## Probe 1 — preliminary reading

- **C works** (per-job `DOCKER_CONFIG` + `cli-plugins` symlink + `auths` in
  `config.json`): buildx resolved and the manifest was read. This is a
  keychain-free success — the isolated config has no `credsStore`.
- **D works**: `DOCKER_AUTH_CONFIG` does not disturb buildx discovery, and a
  builder bootstraps and is removed under it.
- **A and B are confounded.** A returned the `:latest` manifest with no explicit
  auth, yet the anonymous GHCR token request failed and was read as "PRIVATE".
  That is contradictory unless the ambient `~/.docker/config.json`
  (`credsStore: osxkeychain`) supplied a credential in A — which would mean the
  keychain _is_ reachable here and A is **not** a true no-auth test. Under that
  reading B's success is also unproven (`DOCKER_AUTH_CONFIG` might be ignored
  and the keychain used instead).
- **The keychain-touch check is currently vacuous**: the `mdat` read returned
  nothing both times, so `UNCHANGED: YES` compares two empties. Need the full
  `security` output to know whether the item exists/readable from this session.
- **`:339a6448…` is NOT in the registry** (both A and B, `not found`). Need the
  real tag list (authenticated) — the SHA tag the earlier builds pushed is
  apparently not that commit.

**Probe 2 (below) is designed to remove the confound**: status codes via `curl`
(no docker, no helper) to settle public/private, an _isolated_ empty
`DOCKER_CONFIG` (+ cli-plugins symlink) so buildx resolves while the helper is
absent, a negative control (bogus token), and an authenticated tag list.

## Probe 2 — raw output

```text
credential source: common/prd (len 40)
============================================================
1) KEYCHAIN item + helper (attributes only)
============================================================
$ security find-generic-password -s ghcr.io -a nickbrett1
security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.
exit=44
$ grep credsStore/credHelpers/currentContext $HOME/.docker/config.json
	"credsStore": "osxkeychain",
	"credHelpers": {
	"currentContext": "orbstack",
$ command -v docker-credential-osxkeychain
/usr/local/bin/docker-credential-osxkeychain
exit=0
============================================================
2) CURL: public/private by HTTP status (no docker, no helper)
============================================================
anon token (no service): http=401
anon token (service=ghcr.io): http=401
ANON manifest(latest): http=401
ANON manifest(sha): http=401
AUTH manifest(latest): http=401
AUTH manifest(sha): http=401
$ AUTHENTICATED TAG LIST
{"name":"nickbrett1/roost","tags":["6ea3ea4813fa08c1395b49b19d3c38ffe13c2375","latest","buildcache","1b858c3eb1f1ac7b787b71bdc2341d29c1e6c729","21f906a03f5f34c54f5ddc5fa6c0c805755f32cd","7043409b9155647a7b6489fb019f27d9dd62ec3c","b40b79fa495ce151fd71d48fddb0c7bd5303ff05","54e1d7a862b6a022aabc9a4707d35c03c0c1da50","85c589d678afa85241e02ecde8ae1f38c33546fa","01c1c4d6941e13bf66862fd69cb5bd5190e8e825"]}
============================================================
3) ISOLATED no-auth (empty DOCKER_CONFIG + cli-plugins symlink, NO config.json)
============================================================
$ DOCKER_CONFIG=/tmp/probe-dc-empty docker buildx version
github.com/docker/buildx v0.33.0 ... exit=0
$ DOCKER_CONFIG=/tmp/probe-dc-empty docker buildx imagetools inspect ghcr.io/nickbrett1/roost:latest   (TRULY anonymous)
Name:      ghcr.io/nickbrett1/roost:latest
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:dccb8ff99d4344fa3a679adaba28fba6308699a6e80f57a2476f0aff11f05d42
Manifests: ... linux/amd64 + attestation   exit=0
============================================================
4) ISOLATED B: empty DOCKER_CONFIG (no helper) + DOCKER_AUTH_CONFIG ONLY
============================================================
$ DOCKER_CONFIG=/tmp/probe-dc-empty DOCKER_AUTH_CONFIG=<real> docker buildx imagetools inspect ...:latest
<same manifest>  exit=0
$ [negative control] DOCKER_CONFIG=/tmp/probe-dc-empty DOCKER_AUTH_CONFIG=<bogus> docker buildx imagetools inspect ...:latest
ERROR: failed to authorize: failed to fetch oauth token: unexpected status from GET request to
https://ghcr.io/token?scope=repository%3Anickbrett1%2Froost%3Apull&service=ghcr.io: 403 Forbidden
exit=1
============================================================
5) GUARD SEMANTICS (exit codes only)
============================================================
bogus auth, EXISTING tag :latest -> exit=1 (expect non-zero => guard proceeds)
good  auth, EXISTING tag :latest -> exit=0 (expect zero => guard skips)
good  auth, MISSING tag  :339a6448... -> exit=1 (expect non-zero => guard proceeds)
no    auth, EXISTING tag :latest -> exit=0 (anonymous reachability)
REPORT FILE: /tmp/probe-auth-report2.log
```

## Probe 2 — reading

- **Keychain item does not exist as `-s ghcr.io -a nickbrett1` in this session**
  (exit 44). So probe 1's `UNCHANGED: YES` was vacuous, and "the keychain item
  was untouched" is **not** demonstrated. What _is_ demonstrated is that no
  `docker login` ran (no login command in either script, no `Login Succeeded`).
- **Public/private (curl, no docker): PRIVATE.** Anonymous token request → 401;
  anonymous manifest → 401; anon token with `service=ghcr.io` → 401. The
  credential is valid and has pull access (authenticated tag list succeeds).
- **Published tags**: `latest`, `buildcache`, and 8 commit SHAs
  (`6ea3ea48…`, `1b858c3e…`, `21f906a0…`, `7043409b…`, `b40b79fa…`,
  `54e1d7a8…`, `85c589d6…`, `01c1c4d6…`). **`339a6448…` (the spec-015 build
  commit) is NOT among them** — so the guard's "already published" branch has
  nothing to find for that commit, and it did not skip.
- **`DOCKER_AUTH_CONFIG` is honoured** (this is the real result of B): with an
  isolated config that has _no_ credential helper, the bogus value produced
  `403 Forbidden` and the real value produced the manifest. So the CLI consumed
  the env value and it alone drove registry auth.
- **Ambiguity that probe 3 must remove**: the _same_ isolated config with **no**
  `DOCKER_AUTH_CONFIG` also succeeded (`exit=0`), i.e. something ambient
  authenticated to the **private** package. So "B alone is sufficient" is not yet
  separable from "an ambient credential exists on this host". Note the asymmetry:
  when `DOCKER_AUTH_CONFIG` is set it _wins_ (bogus → 403); when it is absent the
  ambient source is used. The ambient source is not the `ghcr.io`/`nickbrett1`
  keychain item (it does not exist here).

## Probe 3 — pin the ambient credential source — raw output

```text
0) ambient env + ~/.docker auth entry
$ env | grep -iE 'docker|ghcr|registry|cred'      -> (nothing)
$ grep -i -A4 ghcr $HOME/.docker/config.json
        "ghcr.io": {}
        },
        "credsStore": "osxkeychain",
        "credHelpers": { "asia.gcr.io": "gcloud", ...
$ ls -la $HOME/.docker/contexts -> meta only
1) security find-generic-password -s ghcr.io    -> could not be found   exit=44
2) printf 'ghcr.io' | docker-credential-osxkeychain get
   {"ServerURL":"ghcr.io","Username":"nickbrett1","Secret":"<redacted>"}   exit=0
3) isolated DOCKER_CONFIG, NO config.json       -> exit=0   (anomaly repeats)
4) isolated DOCKER_CONFIG WITH config.json:
   {"auths":{}}                                 -> exit=0
   {"auths":{},"credsStore":"osxkeychain"}      -> exit=0
   {"auths":{},"credsStore":"definitely-not-a-helper"}
      ERROR: error getting credentials - err: exec: "docker-credential-definitely-not-a-helper":
      executable file not found in $PATH            exit=1
5) default ~/.docker + DOCKER_AUTH_CONFIG=<bogus>
   ERROR: ... unexpected status ... : 403 Forbidden   exit=1
6) docker --debug under isolated no-auth        -> (no credential lines)   exit=0
```

## Probe 4 — is the keychain the default store? — raw output

```text
1) security find-generic-password -s ghcr.io   -> could not be found   exit=44
   security find-internet-password -s ghcr.io
   keychain: "/Users/nick/Library/Keychains/login.keychain-db"
   class: "inet"
   attributes:
      0x00000007 <blob>="Docker Credentials"
       "acct"<blob>="nickbrett1"
       "cdat"<timedate>=0x...  "20260921115504Z\000"
       "mdat"<timedate>=0x...  "20260921115504Z\000"
       "ptcl"<uint32>="htps"
       "srvr"<blob>="ghcr.io"                exit=0
   (same with -a nickbrett1)                 exit=0
2) config.json={"auths":{}} (NO credsStore):
   [full PATH]      DOCKER_CONFIG=$E docker buildx imagetools inspect ...:latest -> exit=0
   [helper hidden: PATH=/usr/bin:/bin]  /usr/local/bin/docker ...                -> exit=1
        ERROR: failed to authorize: failed to fetch anonymous token:
        unexpected status ... : 401 Unauthorized
   PATH=/usr/bin:/bin command -v docker-credential-osxkeychain                    -> exit=1 (not found)
3) config.json={"auths":{},"credsStore":""} , helper hidden:
   no DOCKER_AUTH_CONFIG                -> exit=1  (anonymous: 401)
   DOCKER_AUTH_CONFIG=<real>            -> exit=0  (manifest returned)
   DOCKER_AUTH_CONFIG=<bogus>           -> exit=1  (403 Forbidden)
```

---

## Findings (consolidated)

**Mechanism, pinned.** On this macOS host the Docker CLI uses
`docker-credential-osxkeychain` as a **default/native credential store**, even
when the active `config.json` contains **no `credsStore`**. Proof: with
`config.json = {"auths":{}}`, the private manifest is fetched when the helper is
on `PATH`, and the same command becomes an anonymous `401` when the helper is
hidden from `PATH`. Setting an explicit `credsStore` to a missing helper errors
(`executable ... not found`), i.e. a configured store is honoured. So an
**empty/redirected `DOCKER_CONFIG` does not disable the keychain** — this is the
mechanism spec 015's diagnostics left as an open question, and it is why the
redirect did not stop `osxkeychain`.

**The keychain item.** `srvr=ghcr.io`, `acct=nickbrett1`, class `inet`, in
`login.keychain-db`. Its `mdat` (and `cdat`) are `2026-09-21T11:55:04Z` — the
instant of the #17/#18 `docker login` race — and are **unchanged after all four
probes**. No `docker login` ran, so the keychain was not written.

**`DOCKER_AUTH_CONFIG` precedence and sufficiency.** When set for `ghcr.io` it
**overrides** the keychain store (bogus value → `403` even with the default
config and the helper available). With the store fully disabled
(`credsStore:""`) _and_ the helper hidden from `PATH`, the real value yields the
manifest and the bogus value yields `403` — so the environment variable **alone**
carries registry auth. (Note: the observed `DOCKER_AUTH_CONFIG` semantics —
supplying a raw `auth` blob through the env, overriding the credential store —
are specific to this on-host measurement; re-verify before encoding them as a
stable contract.)

**Public vs private.** Private. Anonymous token request → `401`; anonymous
manifest → `401`; authenticated tag list succeeds. Probe 1's "no-auth success"
was _not_ anonymous — it used the default keychain store.

**Published tags for `ghcr.io/nickbrett1/roost`:** `latest`, `buildcache`, and
8 SHA tags (`6ea3ea48…`, `1b858c3e…`, `21f906a0…`, `7043409b…`, `b40b79fa…`,
`54e1d7a8…`, `85c589d6…`, `01c1c4d6…`). `339a6448…` is absent.

**Guard semantics.** Skip only on a positive answer:

| auth state                                                                        | tag    | exit | guard    |
| --------------------------------------------------------------------------------- | ------ | ---- | -------- |
| env auth (good)                                                                   | exists | 0    | skips    |
| env auth (good)                                                                   | absent | 1    | proceeds |
| env auth (bogus)                                                                  | exists | 1    | proceeds |
| none (store disabled, helper hidden)                                              | exists | 1    | proceeds |
| For a **private** package the guard needs auth to be useful; with none it never   |
| skips (always proceeds — safe). For a **public** package the same rule holds with |
| an anonymous `200` on a present tag (standard registry behaviour; not separately  |
| measured here as no public package was on hand).                                  |
