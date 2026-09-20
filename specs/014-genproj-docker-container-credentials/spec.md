# 014 — docker-container publishes with one of two credential channels

**Status:** implemented (2026-09-20).

This is a defect record. The Buildkite `docker_publish` step that
`docker-container` contributes resolved its GHCR credentials **only** from
Doppler (`GHCR_UPDATE_TOKEN` via `$DOPPLER_TOKEN`) and hard-failed when absent,
while `docker-container` declared `dependencies: ["docker"]` and nothing else. A
`docker-container` project that did not also select `doppler` therefore produced
a pipeline whose publish step could not authenticate: green build, failed publish
at the very end.

## The fix — gate the step on `hasDoppler`, do not declare the dependency

The step now offers two real channels, chosen by whether the `doppler`
capability is selected — exactly the shape the `cloudflare-wrangler` deploy step
already uses:

- **`doppler` selected** — `GHCR_UPDATE_TOKEN` is read from Doppler
  (`common`/`prd`) at run time with the agent's `DOPPLER_TOKEN`. Preferred: the
  `write:packages` token is never in the agent's `environment` hook, where every
  job on the fleet could read it.
- **`doppler` absent** — `GHCR_USERNAME`/`GHCR_TOKEN` come from the agent
  environment by name, the same contract the CircleCI context supplies, and the
  step fails with a clear message rather than mid-push.

`docker-container.dependencies` stays `["docker"]`.

## Why not the hard dependency (the rejected fork)

Making `doppler` a hard dependency fixes the same failure, and was the first
change tried. It was rejected because the cost is not where it looks:

- **`hasGoose` is `capabilities.includes("doppler")`** (see spec 012), and
  `doppler` also brings the Antigravity alias, the Doppler context pin, the SSH
  git-auth setup and a Doppler README section. A hard dependency therefore turns
  "containerize my app" into "onboard onto the fleet's agent stack" for **every**
  container project — including one that selects no CI at all, where this step is
  never even emitted.
- The **CircleCI** combination gains nothing either way: `circleci` already
  declares `dependencies: ["doppler"]` (its MCP server needs CircleCI tokens that
  only come through Doppler), so `docker-container` + `circleci` pulls in
  `doppler` whether or not `docker-container` declares it. That was the cost the
  first attempt weighed, and it is zero.
- The fallback is **reachable** here, unlike the `github-release` release step's
  `GH_TOKEN` branch, which its `["buildkite", "doppler"]` dependency makes dead.
  A reachable channel is the fix; keeping it and also forcing the dependency is
  scope creep.

## What pinned it, and the second copy

- **The test that wanted no forced provider.**
  `tests/catalog.test.js` → _"reports a conflict once, whichever side is checked
  first"_ selected `["docker", "docker-container", "cloudflare-wrangler"]` and
  asserted `missing` was `[]`: a `docker-container` selection had to be
  dependency-complete **without** a secrets provider. It reads as deliberate, and
  it informed the choice of the fallback-only fork; under this fork the test
  stands unchanged. (The first attempt had edited it to add `doppler` — which
  needed no edit once the dependency was dropped.)
- **The second stale copy.** The `docker-container` entry exists three times:
  `src/catalog/catalog.json` (the source of truth `GET /v1/catalog` serves and
  the generator reads), `specs/003-genproj-docker-container/spec.md` §2, and
  `specs/003-genproj-docker-container/contracts/docker-container.capability.json`.
  All three carry the `dependencies` list and have to be changed together; the
  contract JSON in particular is easy to miss. (Its `conflicts` list is
  pre-existing drift — it omits `fetch-launch` — and was left alone.)
