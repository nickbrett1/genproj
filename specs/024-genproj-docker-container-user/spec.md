# 024 — `docker-container.user`: run a container as a specific uid:gid

**Status:** implemented (2026-11-04).

genproj can declare what a container **mounts** but not **who it is**, and those
two facts are entangled: a mount is only usable by a uid that can traverse the
path to it. A `0700` appdata directory owned by uid 1000 gives `EACCES` to every
other non-root uid even when the files inside are world-readable — and the error
names the _directory_, so it reads as "the mount is missing" when the mount is
fine. `0700` is the normal shape for a directory a service creates under a
restrictive umask, so this hits every job that reads another service's data.

Before this slice the only answers were "run as root" or "hand-edit the
generated compose" — and the hand-edit is the thing the generator exists to
prevent.

## The key

```json
"user": {
  "type": "string",
  "description": "uid:gid the container runs as, e.g. \"1000:1000\". Emitted as compose `user:` AND as `USER` in the Dockerfile runtime stage. Empty by default (the image default, i.e. root)."
}
```

**Both levers are load-bearing, and neither is cosmetic.** compose `user:` covers
`docker compose up` and a Container Manager project. The Dockerfile `USER` covers
`docker run` — which is the batch smoke gate (`docker run --rm <image>:<sha>
--dry-run`, no compose involved) and the documented invocation in
`deploy-readme-batch.template`. With only the compose key set, CI and the
documented invocation run as root while the deployed stack runs as 1000: the
gate then validates a uid production never uses, i.e. it validates nothing.

Deliberately **not** coupled to `workload: batch`. A batch job running as root is
often correct (one read-only mount in, one read-write mount out, short-lived), and
defaulting a uid would break any job whose output directory is root-owned. A
long-running service reading another service's `0700` appdata directory needs this
just as much. The key is available, not opinionated.

## Verified against the code (2026-11-04, `main` @ `6443760`)

Two details in the design brief were wrong, and both change the implementation:

| Brief says                                   | Code says                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| emit `USER` "after `{{dockerAptInstall}}`"   | `dockerRunCommand` starts with `COPY scripts/<name> /usr/local/bin/<name>` + `RUN chmod +x`. Emitting `USER` before it makes that chmod run as the new uid against a root-owned file → `Operation not permitted`, build dead. Every batch job declares an entrypoint (the `--dry-run` contract), so this breaks the motivating shape first. **`USER` must be the last instruction of the runtime stage.** |
| add a `{{dockerUser}}` line to each template | the empty placeholder _is_ the blank line already in the output (`{{dockerExpose}}`, `{{networkModeLine}}`). A new line adds a newline to every existing render and fails spec 022's byte-identical rule. Fold into the existing placeholder instead.                                                                                                                                                     |

### Does `USER` keep the runtime stage's copies readable?

Yes — the 0700 risk is real but it is **not** what these commands produce. Modes
below are derived from the exact emitted commands plus a local measurement of
`python -m venv` / `pip install` under both umasks (no Docker daemon in the
authoring workspace, so not a real image build):

| Emitted command                              | Mode                                      | Readable at 1000 |
| -------------------------------------------- | ----------------------------------------- | ---------------- |
| `RUN python -m venv /opt/venv` + pip install | dirs `0755`, files `0644`, `bin/*` `0755` | yes              |
| `COPY --from=build /opt/venv /opt/venv`      | modes preserved, ownership `root:root`    | yes              |
| `COPY . .`, `COPY --from=build /app/build`   | `0755` / `0644` from the build context    | yes              |
| `COPY --from=build …*.jar` / release binary  | `0644` / `0755`                           | yes              |
| `COPY scripts/x` + `RUN chmod +x`            | `0644` → `0755`, world rx                 | yes              |
| `RUN apt-get install`                        | build time, before any `USER`             | n/a              |

What actually decides it is the **build umask**, measured directly:

```
umask 022 → drwxr-xr-x site-packages   -rw-r--r-- __init__.py   -rwxr-xr-x bin/cli
umask 077 → drwx------ site-packages   -rw------- __init__.py   -rwxr-xr-x bin/cli
```

BuildKit's default build umask is `0022`, so the shipped shape is the left
column. **The guarantee is umask-dependent, not template-dependent**: with a
restrictive umask every `USER`-set image fails to import its own dependencies,
and the error points at site-packages, not at the umask. The `dockerfile:1.7`
frontend accepts an `ARG UMASK`, so this is reachable without touching genproj.
Noted, not defended against: a `chmod -R` layer over `/opt/venv` would be worse
(it marks every `.py` file executable for a problem that does not exist at the
default umask).

## Design

### Emit

- `USER <uid>:<gid>` appended to `dockerRunCommand` — the last line of both
  `dockerfile.template` and `dockerfile-shell.template`. Empty string when
  unset, dropped by the existing `.filter(Boolean)`.
- `user: "<uid>:<gid>"` folded into the value the compose placeholder renders.
  The placeholder is renamed `{{networkModeLine}}` → `{{composeServiceLines}}`:
  a field whose name says "network mode" while carrying a user line is a trap
  for the next reader. **The rename changes no output byte.**
- The compose value is **quoted**, mirroring `restart: "no"` — a bare
  numeric-looking YAML scalar is an ambiguity waiting to be "simplified".

### Validate

`validateDockerUser` in `project-validation.js`, called from `generateAllFiles`
beside `validateDockerNetworks`, throwing `ValidationError(message, "user")`.
Rejected, each with a message that names the way out:

- **a bare uid** (`"1000"`) — Docker accepts it and leaves the gid at 0, so the
  process runs with root's group;
- **uid 0** (`"0"`, `"0:0"`, `"0:1000"`) — root is already the default, so
  setting it can only look like it did something;
- **a name** (`"nick:nick"`) — valid Compose, resolved from the _image's_
  `/etc/passwd`, which the generated base images do not have; the container
  would die at start with "unable to find user";
- out of range (> 4294967294).

`resolveDockerUser` is the emit path and independently returns `""` for anything
unparseable, because a preview does not run the validators (the
`externalNetworks` precedent) and a bad value must never reach a generated file.

### Document

A `runtimeUserDocs` suffix appended **inside** the existing "Data mounts"
paragraph of `deploy-readme.template` and `deploy-readme-batch.template`
(leading `\n\n`, the `imageVisibilitySection` pattern — an unset `user` keeps
both runbooks byte-identical). It states the uid and both levers, then the four
things an operator will otherwise diagnose from scratch:

1. the mount's host path must be readable (directories traversable) by that uid,
   and writable when `readOnly: false`; the container cannot `chown` it, so
   `install -d -o 1000 -g 1000 <path>` is the one-liner;
2. a host path that does not exist is created **by Compose, as root `0755`** —
   a read-only mount then works and the first write fails;
3. `/app` is created by root, so writing a sqlite file or a log next to the code
   gets `EACCES` — write to the mounted path;
4. `python:3.12-slim` and friends have no passwd entry for the uid, so `$HOME`
   is unset and `git`/`ssh` may warn. Documented; no `ENV HOME` emitted (a
   behavioural change for every project, for a case this is not about).

## Non-goals

- **No `gosu`/`su-exec` privilege-dropping entrypoint.** It would rewrite the
  generated entrypoint for every project and cannot coexist with the `--dry-run`
  contract; nothing here is broken by running as a non-root uid.
- **No coupling to `workload`.** See above.
- **No `ENV HOME`.** See 4.
- **No `chmod` layer over the runtime copies.** See the umask section.

## Acceptance criteria

1. `user: "1000:1000"` emits `USER 1000:1000` as the last instruction of the
   runtime stage (multi-stage **and** `dockerfile-shell`), and
   `user: "1000:1000"` (quoted) in compose.
2. Unset renders byte-identically to the pre-slice generator, pinned by
   `tests/fixtures/docker-service-golden.json` — Dockerfile, compose, runbook
   **and** pipeline.
3. A generated `workload: batch` project with `user: "1000:1000"` keeps its batch
   shape (`restart: "no"`, no `ports:`, no `EXPOSE`, no healthcheck) and runs its
   smoke gate at that uid — `--dry-run` reaches the entrypoint, which is the mode
   that proves the `USER` line is where it needs to be.
4. Both runbooks document the uid and the mount limitation.
5. `0`, `0:0`, `1000`, `foo`, `nick:nick` and a JSON number are a generation
   error whose `field` is `user`.

## Tests

`tests/generator/docker-user.test.js` — 26 assertions over the above, including
the two that exist to stop a well-meaning "tidy-up":

- `USER` is the last instruction and comes after `RUN chmod +x` and every
  `COPY --from=build`, asserted on the rendered Dockerfile text (not on
  intermediate data — the fold into `dockerRunCommand` is the mechanism under
  test);
- the compose value is quoted, and `user: 1000:1000` unquoted does not appear.
