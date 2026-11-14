# 025 — `docker-container`: the runtime image carries what the app reads

**Status:** implemented (2026-11-14).

The runtime stage of a generated Dockerfile copies the **build output** and
nothing else. That answers "what does the server need to _start_" and never "what
does the server _read_". A committed file read at request time (`registry.json`, a
prompt file, a seed fixture) therefore never reaches the image: it works under
`npm run dev` and in `npm test` — both run against the repository — and answers
404 in production.

The failure is silent end to end. `docker_smoke` polls the declared healthcheck,
and a generated `/health` is a static `{"status":"ok"}` that touches nothing, so a
repo whose every real route 404s passes CI, publishes to GHCR, and deploys green.
This was found by executing the `ui-registry` phase 0b work order, where two
hand-added `COPY` lines were the only thing standing between the app and that
outcome — and hand-edits to a genproj-owned `Dockerfile` do not survive
`overwrite: true`.

Python escaped the defect by accident (`COPY . .` in its branch, for an unrelated
reason), which is why the estate already has the pattern there
(`stratechery-search`'s `vocab.yaml`) and would have broken on any port to node.

## The keys

```json
"runtimeFiles": ["registry/", "registry.json"],
"smokePaths": ["/health", { "path": "/r/registry.json", "expect": 200 }]
```

`runtimeFiles` emits one `COPY --from=build /app/<path> ./<path>` per entry in the
runtime stage. Default `[]`, emitting nothing — every existing Dockerfile stays
byte-identical. The entries are repo-relative paths written into the Dockerfile
verbatim, so a value that cannot be emitted (absolute, `..`, `.`, a glob, a quote,
a space) fails **generation** with a `ValidationError` instead of producing an
image with a missing directory — the same discipline `command`/`entrypoint`
already apply.

It is a no-op for python (whose branch already copies the whole tree) and for a
shell image (single stage), and is emitted for node/java/rust. It is deliberately
_not_ "copy everything": that one-line change would fix every instance at once
but drags `node_modules`, `.git`, tests and the devcontainer into a production
image, and `.dockerignore` does not help because the runtime stage copies from the
**build stage**, not the build context.

`smokePaths` makes `docker_smoke` assert each path answers before the step
declares success. A key that adds files and no way to notice they are missing is
half a fix, so the two ship together:

- the step publishes the container port on a random loopback host port
  (`-p 127.0.0.1::<exposePort>`) and probes from the **agent** with `curl`. The
  image may carry neither `curl` nor node (curl is only auto-added for an
  `http:` healthcheck), and a probe that depends on the image's own contents is
  wrong about the one thing it is checking;
- without `expect`, "answers" means any 1xx–4xx; a 5xx or no connection fails;
- under `networkMode: host` there is no mapping to read, so the container port is
  addressed directly;
- unauthenticated paths only in v1 — a path behind a token needs the secret in
  CI, and a half-working assertion is worse than a documented limit.

Both keys default empty, so the smoke step and the Dockerfile are byte-identical
to today for every project that does not set them.

## Not done here

- **No verification that a path exists in the repository.** Generation happens
  against a config, not a checkout, so the honest check is the smoke assertion
  (`smokePaths`), not a `stat` at generation time.
- **No `doppler` path into the running container.** `envVars` emits
  `KEY: ${KEY:-default}` into compose but nothing produces the value: there is no
  `env_file:` and no `doppler run` in the deploy path, so a runtime secret is
  pasted into a file on the NAS by hand. That is a decision (the container's
  entrypoint wrapper, the CLI in the image, which Doppler project/config), not an
  implementation detail, and is still open.
- **No daemon-free file-set check in generated CI.** The memo's
  `cp -r build registry /tmp/imgsim && node build/index.js` runs the same property
  without Docker and would be cheaper than the smoke probe; `smokePaths` was
  chosen because it asserts through the published image, which is what ships.

## Verified

`tests/generator/docker-runtime-files.test.js`: both keys default to byte-identical
output, `runtimeFiles` lands in the runtime stage for node and is a no-op for
python, `smokePaths` emits the publish flag and assertions (parsed as YAML, and
`bash -n`-clean), host networking addresses the port directly, and every
unemittable value fails generation. The `deploy/README.md` golden fixtures
(`docker-workload`, `docker-user`) were updated for the new §8 bullets; the
Dockerfile, compose file and pipeline goldens are unchanged.

Engine `be0b38e` (the commit the gap was diagnosed on) is the starting point;
`src/generator/capability-template-utils.js` carries `resolveRuntimeFiles`,
`resolveSmokePaths` and `isSafeRuntimeFilePath`, and `project-validation.js`
carries `validateDockerRuntimeFiles`.
