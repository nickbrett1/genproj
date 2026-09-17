# Backporting `container-agent` into the containers that already exist

Companion to `spec.md`, and deliberately separate from it: the spec describes
the capability, this describes the one-time operation that gives it to the
repos that were generated before it existed.

## 0. Why this is an in-place backport, not a regeneration

The capability is _designed_ so that arriving in an existing repo is just a
regeneration with `overwrite: true` — `devcontainer.json` is a merge target
(`runArgs` now unions, so `--stop-timeout` is added), `.devcontainer/
post-start-setup.sh` is genproj-owned infra (the fresh template wins), and
`scripts/agent-dev.sh` is app-owned and therefore seeded once.

Regeneration is nevertheless **not** the mechanism used here, for a reason the
inventory made unavoidable: 14 of the 19 devcontainer repos have no
`## Capabilities` block in their README, and several have hand-written READMEs
(`ftn` is a portfolio page; `gaggle` opens with an abandonment banner). A
regeneration needs the repo's _complete_ selection and `configuration` as input,
and rewrites genproj-owned infra from it — so regenerating one of those repos
with a reconstructed selection would silently strip whatever the reconstruction
missed (a missing `doppler` removes the doppler setup from
`post-create-setup.sh` and the Dockerfile), and would replace a hand-written
README with a generated one. Neither is acceptable as a side effect of adding an
agent.

So the backport is **three additive edits per repo**, seeded from a scratch
generation rather than from the repo's own history:

| #   | Change                                                                            | Source                                                       |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | add `scripts/agent-dev.sh`                                                        | generated once for that repo name, then committed            |
| 2   | insert the `agent-dev.sh start` hook into `.devcontainer/post-start-setup.sh`     | the `containerAgentService` block in the post-start template |
| 3   | append `"--stop-timeout", "30"` to `runArgs` in `.devcontainer/devcontainer.json` | one JSON edit                                                |
| 4   | _(optional)_ a short "this container's agent" README section                      | only where the README is the project's own prose             |

The outcome is identical to a regeneration for the three files that matter, with
none of the blast radius. It is also the only mechanism that works for a repo
whose selection is not recorded anywhere.

The generator change (§1 below) is still what makes _future_ repos correct; the
in-place backport is a one-off for the repos that predate it.

## 1. Prerequisites

- **The generator is deployed with the capability.** `main` deploys on
  Buildkite. Verify:
  `curl -s https://<genproj-host>/v1/catalog | jq '.capabilities[] | select(.id=="container-agent")'`
  — expect `locked: true`, and `container-agent` present in the `dependencies`
  of every `devcontainer-*`.
- **`scripts/agent-dev.sh` for a given repo name**, generated locally so the
  agent name and workspace path are the repo's:

  ```bash
  node -e '
  import("./src/generator/file-generator.js").then(async (m) => {
    const files = await m.generateAllFiles({
      capabilities: ["devcontainer-node", "container-agent"],
      configuration: { language: "node" },
      projectName: "<repo>",
    });
    process.stdout.write(
      files.find((f) => f.filePath === "scripts/agent-dev.sh").content
    );
  });' > scripts/agent-dev.sh
  ```

  Only the project name varies between repos: the agent name is
  `<repo><nameSuffix>` with the default suffix `-dev`, and the workspace is
  `/workspaces/<repo>`. Everything else (card port, ACP URL, LiteLLM base URL,
  the launcher contract) is identical.

- The container must be **on the tailnet** and joined to it, and `~/.doppler`
  must hold a Doppler login: the agent resolves the tailnet name at start and
  refuses to run on a loopback `publicUrl`. This is checked per repo in §4.

## 2. Per-repo inventory

Gathered from each repo's own files (`.devcontainer/devcontainer.json`,
`README.md`, and whether `scripts/agent-dev.sh` exists). `runArgs` shape is
`full` = the four tailnet args (`--sysctl …`, `--cap-add=NET_ADMIN`,
`--device=/dev/net/tun`), `minimal` = the `--sysctl` only — the minimal ones were
generated before the tailnet wiring existed, or hand-trimmed, and a backport
**must not** add the missing args as a side effect (it only appends
`--stop-timeout`).

| repo                | devcontainer | lang        | runArgs | postStartCommand | selection known | notes                                                                             |
| ------------------- | ------------ | ----------- | ------- | ---------------- | --------------- | --------------------------------------------------------------------------------- |
| genproj             | yes          | node        | full    | yes              | no              | **done** (commit `8cc24c1`)                                                       |
| a2a-goose           | yes          | rust        | full    | yes              | yes             | publishes the release channel this capability consumes                            |
| mailroom            | yes          | python      | full    | yes              | yes             | dagster; nested manifests                                                         |
| nas-port-mcp        | yes          | python      | full    | yes              | yes             |                                                                                   |
| parquet-peek        | yes          | node        | full    | yes              | yes             | sveltekit                                                                         |
| pshelf              | yes          | node        | full    | yes              | yes             | sveltekit                                                                         |
| agent-swarm         | yes          | node/ts     | full    | yes              | no              | hand-written README                                                               |
| agy-telemetry       | yes          | python      | full    | yes              | no              | hand-written README                                                               |
| circleci-mcp        | yes          | python      | full    | yes              | no              | hand-written README                                                               |
| dagu-mcp            | yes          | python      | full    | yes              | no              | hand-written README                                                               |
| deepseek-balance    | yes          | python      | full    | yes              | no              | hand-written README                                                               |
| gaggle              | yes          | node        | full    | yes              | no              | README opens with an "abandoned" banner — decide whether to bother                |
| huddle-concept      | yes          | node        | minimal | yes              | no              | hand-written README                                                               |
| miniflux-feed-dedup | yes          | python      | full    | yes              | no              | hand-written README; described as genproj-generated                               |
| stripe-toddler      | yes          | rust/node   | full    | yes              | no              | nested `worker/`, `ios/`                                                          |
| vikunja-mcp         | yes          | python      | full    | yes              | no              | hand-written README; described as genproj-generated                               |
| ftn                 | yes          | node        | full    | yes              | no              | portfolio README + hand-edited devcontainer.json — **do not** regenerate this one |
| dagster-tutorial    | yes          | python      | minimal | **no**           | no              | no `postStartCommand` — needs one added, not just edited                          |
| dbt-duckdb          | yes          | python/node | minimal | **no**           | no              | no `postStartCommand` — needs one added, not just edited                          |

Not candidates (no devcontainer): `goose-recipes`, `tdarr-nas`, `circleci-stats`,
`openclaw-nas`, `devopen`, `dagu-dags`, `github-stats`.

No repo anywhere had `runArgs` containing `--stop-timeout`, and only `genproj`
had `scripts/agent-dev.sh` — so every row above is a clean slate.

## 3. Procedure, per repo

```bash
REPO=<repo>

git clone git@github.com:nickbrett1/$REPO.git && cd $REPO

# 1. the script, generated for this repo's name (see §1)
mkdir -p scripts && <generator snippet> > scripts/agent-dev.sh
chmod +x scripts/agent-dev.sh
bash -n scripts/agent-dev.sh

# 2. the hook: insert the containerAgentService block above the final
#    "Services check/startup complete." echo in .devcontainer/post-start-setup.sh
#    (repos with no postStartCommand need the file's postStartCommand wired in
#     devcontainer.json too, mirroring the other repos' line)

# 3. --stop-timeout
jq '.runArgs += ["--stop-timeout","30"]' .devcontainer/devcontainer.json > /tmp/dc \
  && mv /tmp/dc .devcontainer/devcontainer.json
```

Then commit, in one commit per repo:

```
container-agent: run this container's own agent

Backport of specs/008 (genproj). Three additive changes: scripts/agent-dev.sh
(seeded once, app-owned), the start hook in post-start-setup.sh, and
--stop-timeout 30 in runArgs so `docker stop` lets the agent deregister.
```

## 4. Verification, per repo

Ordered by cost. Steps 1–3 prove the files landed; 4–6 prove the agent works,
and 6 is the only one that proves the _contract_ (one agent per repo, keyed by
name).

1. `jq '.runArgs' .devcontainer/devcontainer.json` contains `--stop-timeout 30`
   and still contains every arg it had before (git diff shows an addition only).
2. `bash -n scripts/agent-dev.sh` — free, and catches a template regression when
   the script was copied from a scratch generation.
3. `git diff --stat` touches exactly the expected files. Anything else means the
   wrong thing was copied.
4. Rebuild the container. In it: `scripts/agent-dev.sh status` reports running
   and prints the card URL, and `tail -n 20 ~/.local/state/a2a-goose/agent.log`
   shows a registration with **no startup refusal** — a refusal here means the
   tailnet name did not resolve ($1's precondition).
5. The agent appears in `list_agents` as `<repo>-dev`.
6. `docker stop <container>` → it is gone from the roster. Start again → the
   _same_ row, not a second one.

## 5. Rollback

One commit per repo, so `git revert <commit>` (or reset and force-push on a
repo nobody else uses). `scripts/agent-dev.sh` is the only new file; removing it
plus the hook stops the agent, and the `runArgs` entry is inert on its own.

## 6. Order

1. **genproj** — done first, so the generator stops being the one repo that does
   not dogfood its own capability.
2. **a2a-goose** — it publishes the release channel the capability consumes;
   being its first consumer is the honest test of the contract.
3. **The five repos whose selection is known** (mailroom, nas-port-mcp,
   parquet-peek, pshelf) — these could still be regenerated later if a
   capability is added, so doing them first keeps the two paths in step.
4. **The rest**, in any order — they are independent. Skip or defer `gaggle`
   (abandoned) and be deliberate about `ftn` (do not regenerate it, ever).
