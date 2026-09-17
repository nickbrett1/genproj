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

| repo                | devcontainer | lang        | runArgs | postStartCommand | tailnet wiring | state                    |
| ------------------- | ------------ | ----------- | ------- | ---------------- | -------------- | ------------------------ |
| genproj             | yes          | node        | full    | yes              | yes            | **done** (`8cc24c1`)     |
| a2a-goose           | yes          | rust        | full    | yes              | yes            | **done** (`031085b`)     |
| mailroom            | yes          | python      | full    | yes              | yes            | **done** (`5e74d2f`)     |
| nas-port-mcp        | yes          | python      | full    | yes              | yes            | **done** (`9bfec48`)     |
| parquet-peek        | yes          | node        | full    | yes              | yes            | **done** (`5d7e3a2`)     |
| pshelf              | yes          | node        | full    | yes              | yes            | **done** (`4d71920`)     |
| agent-swarm         | yes          | node/ts     | full    | yes              | yes            | **done** (`89e9d38`)     |
| agy-telemetry       | yes          | python      | full    | yes              | yes            | **done** (`d2d61ba`)     |
| circleci-mcp        | yes          | python      | full    | yes              | yes            | **done** (`74254b8`)     |
| dagu-mcp            | yes          | python      | full    | yes              | yes            | **done** (`0a3d5b1`)     |
| deepseek-balance    | yes          | python      | full    | yes              | yes            | **done** (`9ac54ee`)     |
| miniflux-feed-dedup | yes          | python      | full    | yes              | yes            | **done** (`eadf11a`)     |
| stripe-toddler      | yes          | rust/node   | full    | yes              | yes            | **done** (`7b7bfd2`)     |
| vikunja-mcp         | yes          | python      | full    | yes              | yes            | **done** (`d4cc568`)     |
| ftn                 | yes          | node        | full    | yes              | yes            | **done** (`e691c9ef0`)   |
| huddle-concept      | yes          | node        | minimal | **no**           | **no**         | **done** (`9cde324`)     |
| dagster-tutorial    | yes          | python      | minimal | **no**           | **no**         | **done** (`f2024a8`)     |
| dbt-duckdb          | yes          | python/node | minimal | **no**           | **no**         | **done** (`1fc0aa5`)     |
| gaggle              | yes          | node        | full    | yes              | yes            | **deferred** (abandoned) |

`lang` / README notes, for the record: `mailroom` is dagster with nested manifests,
`parquet-peek` / `pshelf` are sveltekit, `stripe-toddler` has nested `worker/` and
`ios/`, and `agent-swarm`, `agy-telemetry`, `circleci-mcp`, `dagu-mcp`,
`deepseek-balance`, `miniflux-feed-dedup`, `vikunja-mcp`, `huddle-concept` all have
hand-written READMEs. `ftn` is a portfolio page with a hand-edited JSONC
`devcontainer.json` and must never be regenerated.

Three of these (`huddle-concept`, `dagster-tutorial`, `dbt-duckdb`) had **no
post-start file at all**, so their backport is four edits rather than three: the
new `.devcontainer/post-start-setup.sh` and the `postStartCommand` that runs it
are additions, not edits. See §3.1.

Those same three have `minimal` `runArgs` and **no tailnet wiring** — no
`--cap-add=NET_ADMIN` / `--device=/dev/net/tun`, no tailscale state volume, no
tailscale install in post-create. That is §7.

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

### 3.1 Repos with no post-start file

`huddle-concept`, `dagster-tutorial` and `dbt-duckdb` have no
`.devcontainer/post-start-setup.sh` and no `postStartCommand`, so there is
nothing to insert the hook _into_. They get a new file instead — deliberately
minimal, since the genproj post-start template also restarts `sshd`, `tailscaled`
and a socat tunnel that these repos never had and should not acquire by
accident — plus the `postStartCommand` that runs it:

```jsonc
"postCreateCommand": "bash /workspaces/<repo>/.devcontainer/post-create-setup.sh",
"postStartCommand": "bash /workspaces/<repo>/.devcontainer/post-start-setup.sh"
```

The new file carries the same `containerAgentService` block the template emits,
plus the trailing `Services check/startup complete.` echo so the two shapes stay
recognisable as each other:

```bash
echo "INFO: Checking the container agent..."
if [ -x "/workspaces/<repo>/scripts/agent-dev.sh" ]; then
    "/workspaces/<repo>/scripts/agent-dev.sh" start || true
else
    echo "WARN: scripts/agent-dev.sh not found, skipping the container agent"
fi
```

`dbt-duckdb`'s `devcontainer.json` is JSONC (line and trailing comments), so
`jq` cannot validate it. Insert textually and validate by stripping comments
first, as with `ftn`.

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
4. **The rest**, in any order — they are independent. `gaggle` is **deferred**
   (its README opens with an `⚠️ Abandoned — superseded by MCPHub` banner; an
   agent is only worth giving to a repo that runs). `ftn` is done, and is the one
   repo that must never be regenerated.

## 7. The tailnet prerequisite, and the three repos that lack it

The capability assumes the container is already on the tailnet: that is what
decision B settled on — there is no `container-tailnet` capability, the
_unconditional_ wiring in `getDevcontainerJsonExtras()` is the provider, and
`container-agent` therefore depends only on `coding-agents`.

Every repo in §2 has that wiring **except the three that also had no post-start
file**. They were generated before it existed, and their `runArgs` were
deliberately left alone:

| what the agent needs                                                   | huddle-concept | dagster-tutorial | dbt-duckdb |
| ---------------------------------------------------------------------- | -------------- | ---------------- | ---------- |
| `--cap-add=NET_ADMIN`, `--device=/dev/net/tun` in `runArgs`            | missing        | missing          | missing    |
| a `<repo>-tailscale-state` volume at `/var/lib/tailscale`              | missing        | missing          | missing    |
| tailscale installed in post-create, `tailscaled` started in post-start | missing        | missing          | missing    |

Consequence, stated plainly: **the agent will not start in those three yet.**
`resolve_tailnet_name()` fails, `cmd_start` prints the loud "no tailnet name
could be resolved" block, and returns 0 — the container comes up normally, which
is exactly the fail-open contract, but there is no agent.

Closing that is a separate decision, not an oversight in this runbook:

- **Add the wiring** (the §7 table, four more edits each). It is the same change
  a regeneration would make, and it makes the agent work. The cost is
  `--device=/dev/net/tun` and `--cap-add=NET_ADMIN`, which are new privileges for
  these containers and a hard requirement on a host that has `/dev/net/tun`; on a
  host without it, adding them breaks container start outright rather than
  degrading.
- **Leave it.** The capability is present and inert, the hook explains itself on
  every start, and a hand-added `A2A_GOOSE_TAILNET_NAME` remains the escape hatch
  for a container reachable some other way.

No other repo is affected, and nothing about the generator changes either way.

## 8. The second prerequisite: the four secrets are not where the script looks

Found by running the thing, not by reading it. In genproj's own container
(the reference implementation):

```console
$ ./scripts/agent-dev.sh start
  No secrets were available from Doppler, so ~/.config/a2a-goose/env is empty.
$ ./scripts/agent-dev.sh status
  agent genproj-dev: not running
  ... a2a-goose: cannot read env:A2A_GOOSE_BEARER_TOKEN: the bearer token is not set.
```

Everything upstream of that is correct — the tailnet name resolved
(`genproj.tail86fd19.ts.net`), the launcher cold-started itself, `fetch-launch`
installed 0.1.42 and verified goose 1.51.0, and the card was assembled for
`genproj-dev`, the right name. It stops on the secrets.

`read_secret()` shells out to plain `doppler secrets get "$key" --plain`, so it
reads whichever project/config the **repo's own `doppler.yaml`** selects
(genproj → project `genproj`, config `dev`). That config holds
`BUILDKITE_TOKEN`, `SERVICE_SECRET` and the cluster vars — none of the four:

| key                        | required by          | where it actually lives                          |
| -------------------------- | -------------------- | ------------------------------------------------ |
| `A2A_GOOSE_BEARER_TOKEN`   | the agent's own card | **nowhere yet** — has to be created              |
| `GOOSE_SERVER__SECRET_KEY` | the goose ACP child  | **nowhere yet** — has to be created              |
| `LITELLM_MASTER_KEY`       | registry auth        | project `litellm`, configs `prd`/`stg`/`dev`     |
| `LITELLM_BASE_URL`         | registry address     | not a secret — the capability's `litellmBaseUrl` |

So there are two halves to closing this, and only the second is code:

1. **Create the two missing secrets** (`A2A_GOOSE_BEARER_TOKEN`,
   `GOOSE_SERVER__SECRET_KEY`) in a config the containers can read. A bearer
   token is `openssl rand -hex 32`; the shared secret is whatever the
   registry/LiteLLM side already expects. This is provisioning, not a template
   change.
2. **Teach `read_secret()` where to look**, because "the repo's own project"
   is the wrong project for three of the four. The fix is small — give each key
   a project/config rather than relying on `doppler.yaml`:

   ```bash
   read_secret() { # key project config
     doppler secrets get "$1" --project "$2" --config "$3" --plain 2>/dev/null || true
   }
   ```

   and stop reading `LITELLM_BASE_URL` from Doppler at all — it is already a
   capability setting with the same default.

   Note this is a template change, so it changes every future generation too,
   which is the right place for it: the lookup is not repo-specific.

A third, smaller thing the same run exposed: `write_env_file` writes an empty
file and `cmd_start` then starts the agent anyway, so the loud "no secrets" block
is followed by a launch that fails with a `refusing to start` refusal from
a2a-goose. Fail-open still holds (exit 0, container usable), but the first
message should be the last one — a missing `A2A_GOOSE_BEARER_TOKEN` is a
definite refusal, not a "will likely fail to register". Stopping after
`write_env_file` when the file it wrote has no bearer token makes the output
honest and skips a doomed launch.
