# 016 — the per-job docker config hid the buildx plugin, so the image never published

**Status:** implemented (2026-09-21).

This is a defect record. It is the sequel to — and the opposite failure of —
`015-genproj-docker-publish-idempotent`: that spec isolated the docker config to
stop two builds racing the macOS keychain, and that isolation is what stopped the
publish.

## The failure

roost's build `#24`, the first build to reach `docker_publish` after 015 landed,
died in that step:

```text
Login Succeeded
unknown flag: --bootstrap

Usage:  docker [OPTIONS] COMMAND [ARG...]
🚨 Error: The command exited with status 125
```

`--bootstrap` is a real flag on `docker buildx create` ("Boot builder after
creation"), so the message reads like a version problem. It is not one.

## The cause

015 added, before the login:

```sh
export DOCKER_CONFIG="/tmp/bk-docker-$BUILDKITE_JOB_ID"
mkdir -p "$DOCKER_CONFIG"
```

`DOCKER_CONFIG` does not only move `config.json` — it also moves the CLI
**plugin** directory, which docker looks for at `$DOCKER_CONFIG/cli-plugins`
(default `~/.docker/cli-plugins`). The step points it at a freshly created
**empty** directory, so `docker-buildx` is not there to be found and the `buildx`
subcommand stops existing.

Docker then fails in **root** argument parsing rather than inside `buildx`: with
trailing arguments present it reports the first unknown flag it meets — which is
`--bootstrap` — and exits `125`, the root-argument error code, without ever
reaching a subcommand. That is why the error names a flag that is perfectly
valid. The plugin was missing; the flag was blamed.

Both shapes were reproduced on `mac-studio.local` (docker 29.4.0, buildx
v0.33.0, which does list `--bootstrap`):

| invocation                                                 | result                                                |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `docker buildx version`                                    | buildx `v0.33.0`, exit 0                              |
| `DOCKER_CONFIG=<empty> docker buildx version`              | `unknown command: docker buildx`, exit 1              |
| `DOCKER_CONFIG=<empty> docker buildx create --bootstrap …` | `unknown flag: --bootstrap`, exit 125 (the CI string) |

## Why it was not caught

Every build between 015 landing and this one died **earlier**, at
`cargo fmt --check` in the rust job, so `docker_publish` never executed — it is
gated `if: build.branch == "main"`, and no `main` build had got past the rust
job. Fixing that formatting gate is what let the publish run for the first time.
The regression was already in the tree, lying behind an earlier red.

## The fix

Link the real plugin directory back into the per-job config, so the config stays
isolated and buildx stays reachable:

```sh
ln -sfn "$HOME/.docker/cli-plugins" "$DOCKER_CONFIG/cli-plugins"
```

Verified on the host with that symlink in place: `buildx version` exits 0 under
the isolated config, and the daemon is still reached (`docker info` →
`29.4.0 OrbStack`; `docker run --rm hello-world` exits 0).

## Not taken

- **Dropping `DOCKER_CONFIG` and going back to `~/.docker`.** That is the
  keychain race 015 exists to stop. The two halves do not trade off.
- **Seeding `currentContext` into the per-job config.** The isolated config
  falls back to the `default` context, and on this host `default` and `orbstack`
  resolve to the same socket (`/var/run/docker.sock` →
  `~/.orbstack/run/docker.sock`), so nothing is needed. This is the one
  environment assumption: an agent whose `default` context has no daemon would
  need the context carried over.
- **The CircleCI copy.** It emits the same `docker buildx create --bootstrap`
  but never sets `DOCKER_CONFIG`, so its plugin directory is untouched.

## How it is pinned

`tests/generator/file-generator-buildkite.test.js` → _logs in through a per-job
docker config instead of the shared keychain_: the step links
`$HOME/.docker/cli-plugins` into `$DOCKER_CONFIG` before the login, alongside the
assertions 015 added.
