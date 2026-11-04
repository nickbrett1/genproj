# spec 024 / PR #88 — `docker-container.user` runtime verification

Run 2026-11-04, workspace `/workspaces/genproj`, `main` @ `3f63038`
("feat(docker-container): add a `user` key so a container can run as a uid:gid").

**Verdict: the runtime claims hold, and the ordering claim is now an observed
build failure, not an inference from Docker semantics.** All three steps passed
against a real daemon. Details and caveats below.

---

## 1. No daemon in this workspace (so the build was run remotely)

Checked, not assumed:

| probe                                                                  | result                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docker` / `podman` / `nerdctl` / `buildah` / `finch` / `ctr` / `runc` | all `command not found`                                                                        |
| `/var/run/docker.sock`, `/run/podman/podman.sock`                      | do not exist                                                                                   |
| `DOCKER_HOST` / container env                                          | unset                                                                                          |
| `unshare -Ur id` (rootless path)                                       | `unshare failed: Operation not permitted`                                                      |
| capabilities                                                           | `CapEff: 0`; bounding set lacks `CAP_SYS_ADMIN`                                                |
| passwordless sudo                                                      | **available** (`sudo -n id` → `uid=0`), but sudo cannot add a cap absent from the bounding set |

So `dockerd` cannot start (no `CAP_SYS_ADMIN` for mounts/cgroups) and rootless
podman cannot either (user namespaces blocked). The build below was therefore
executed by **`nas-goose` on the Synology NAS**, which has a working daemon.

## 2. Build environment umask — the two numbers that matter

| host                                   | `umask`  |
| -------------------------------------- | -------- |
| this workspace                         | **0077** |
| the host that actually built the image | **0022** |

Consequence, stated plainly: a local build here would have been a _false
negative_ for the umask hazard — 0077 is exactly the regime in which
`python -m venv` / `pip install` land `0700` dirs and `0600` files, so a
`USER`-set **Python** image would fail to import its own dependencies while the
**shell** image (no pip, the case under test) would still build. The image that
was actually built used 0022, the shipped default, so the positive result below
is representative — and it does not exercise the restrictive-umask hazard at
all. That hazard remains **unreproduced**; see "Still unproven" below.

Note also that the build umask is the _daemon's_, not the client shell's, so the
0077 in this workspace would not have propagated to a remote build anyway.

## 3. Project generated through the real generator

Not hand-written: rendered by `generateAllFiles`
(`specs/024-genproj-docker-container-user/repro/render.mjs`). The rendered
`Dockerfile` and `docker-compose.yml` from this run are kept alongside it.

```js
language: "shell",                       // single-stage image
"docker-container": {
  workload: "batch",
  user: "1000:1000",
  entrypoint: ["/usr/local/bin/verify024.sh"],
}
```

`Dockerfile` tail (shipped order, unmodified):

```
COPY . .


COPY scripts/verify024.sh /usr/local/bin/verify024.sh
RUN chmod +x /usr/local/bin/verify024.sh
ENTRYPOINT ["/usr/local/bin/verify024.sh"]
USER 1000:1000
```

`docker-compose.yml`:

```
    restart: "no"
    user: "1000:1000"

    environment: {}
```

Entrypoint used for the smoke gate (`scripts/verify024.sh`, mode 0755): prints
`id -u` / `id -g`, the `ls -l` of itself, and exits 0 on `--dry-run`.

## 4. STEP A — `docker build` + `docker run --rm … --dry-run` (real)

Host: Docker **24.0.2**, Compose **v2.20.1**, `umask 0022`, **classic (legacy)
builder — buildx is not installed**. Docker access was `sudo -n docker`.

```
Step 5/8 : COPY scripts/verify024.sh /usr/local/bin/verify024.sh
Step 6/8 : RUN chmod +x /usr/local/bin/verify024.sh
Step 8/8 : USER 1000:1000
Successfully built 9a19ac192b91
BUILD_EXIT=0
```

```
$ docker run --rm verify024:pos --dry-run
id: cannot find name for user ID 1000
uid=1000 gid=1000 user=1000
self=-rwxr-xr-x 1 root root 199 /usr/local/bin/verify024.sh
DRY RUN OK
RUN_EXIT=0
```

- **process uid = 1000, gid = 1000** — observed, not inferred.
- entrypoint **executable (`0755`)** and **ran**; `chmod +x` did not trip.
- image is root-owned but world-executable, which is what makes the later
  `USER` work.

## 5. STEP B — `docker compose run --rm app --dry-run` (real)

Image re-tagged `ghcr.io/nickbrett1/verify024:latest` so the generated compose
`image:` resolved. Compose honoured `user: "1000:1000"`:

```
uid=1000 gid=1000 user=1000
self=-rwxr-xr-x 1 root root 199 /usr/local/bin/verify024.sh
DRY RUN OK
COMPOSE_EXIT=0
```

## 6. STEP C — NEGATIVE: `USER` moved above `COPY`/`chmod` (real)

Identical Dockerfile with `USER 1000:1000` moved immediately before the `COPY`:

```
Step 5/8 : USER 1000:1000
Step 6/8 : COPY scripts/verify024.sh /usr/local/bin/verify024.sh
Step 7/8 : RUN chmod +x /usr/local/bin/verify024.sh
chmod: changing permissions of '/usr/local/bin/verify024.sh': Operation not permitted
The command '/bin/sh -c chmod +x /usr/local/bin/verify024.sh' returned a non-zero code: 1
NEG_BUILD_EXIT=1
```

**The predicted failure reproduced exactly.** The ordering claim is no longer
theoretical: with `USER` earlier, the build dies with `Operation not permitted`,
exit 1. The shipped order (USER last) builds; the moved order does not.

Kernel-level confirmation independent of Docker (same syscall, run in this
workspace): `chmod +x` on a root-owned `0644` file as uid 1000 →
`chmod: ... Operation not permitted` (exit 1); a control file owned by uid 1000
chmods fine.

## 7. Incidental findings

1. **`id: cannot find name for user ID 1000`** is printed on both `docker run`
   and `docker compose run`, before the entrypoint's own output. `debian:bookworm-slim`
   has no `/etc/passwd` entry for 1000, so `id -un` falls back to the numeric
   string. It does **not** break `set -eu` and the smoke gate still exits 0, but
   any consumer that asserts on exact script output or treats stderr as failure
   will see it. A generated image has no way to `useradd` without an extra layer;
   worth a line in the runbook rather than a code change.
2. The `chmod +x` is a _no-op but permitted_ operation when run as root (the
   copied file is already `0755` from the context). It only matters because a
   non-root `RUN` cannot chmod a root-owned file. If the generator ever moves to
   `COPY --chmod=0755`, this failure mode disappears — and with it the reason
   `USER` must be last for this particular layer. Until then the ordering is
   load-bearing and this test pins it.
3. Caveat on fidelity: the negative build's context also contained
   `Dockerfile.neg` (14.85 kB vs 5.63 kB). Harmless here — it is unrelated to
   the failing instruction — but the two builds did not use byte-identical
   contexts.
4. Caveat on builder: **classic builder, not BuildKit.** Classic `RUN` executes
   as the active `USER`, which is exactly the mechanism under test, so the
   ordering result is valid; it does not literally exercise BuildKit. Spec 024
   claims BuildKit's default umask is 0022; this run observed 0022 on a classic
   builder, not on BuildKit.

## Still unproven

- The **restrictive-umask hazard** (`USER` + Python image + build umask 077 →
  `0700` site-packages, failure naming site-packages not the umask) was **not
  reproduced**. Doing so needs a Python image built with `ARG UMASK`/`umask 077`
  and would be the natural follow-up if this is to be defended against rather
  than merely documented.
- Only the **shell single-stage** image was built. The multi-stage Python/Node
  `COPY --from=build` path was not exercised, though it is the same `USER`-last
  shape.
- BuildKit behaviour (dual-path `RUN` semantics, frontend umask) untested.
