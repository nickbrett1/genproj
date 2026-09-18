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

| repo                | devcontainer | lang        | runArgs | postStartCommand | tailnet wiring | state                           |
| ------------------- | ------------ | ----------- | ------- | ---------------- | -------------- | ------------------------------- |
| genproj             | yes          | node        | full    | yes              | yes            | **done** (`8cc24c1`)            |
| a2a-goose           | yes          | rust        | full    | yes              | yes            | **done** (`031085b`)            |
| mailroom            | yes          | python      | full    | yes              | yes            | **done** (`5e74d2f`)            |
| nas-port-mcp        | yes          | python      | full    | yes              | yes            | **done** (`9bfec48`)            |
| parquet-peek        | yes          | node        | full    | yes              | yes            | **done** (`5d7e3a2`)            |
| pshelf              | yes          | node        | full    | yes              | yes            | **done** (`4d71920`)            |
| agent-swarm         | yes          | node/ts     | full    | yes              | yes            | **done** (`89e9d38`)            |
| agy-telemetry       | yes          | python      | full    | yes              | yes            | **done** (`d2d61ba`)            |
| circleci-mcp        | yes          | python      | full    | yes              | yes            | **done** (`74254b8`)            |
| dagu-mcp            | yes          | python      | full    | yes              | yes            | **done** (`0a3d5b1`)            |
| deepseek-balance    | yes          | python      | full    | yes              | yes            | **done** (`9ac54ee`)            |
| miniflux-feed-dedup | yes          | python      | full    | yes              | yes            | **done** (`eadf11a`)            |
| stripe-toddler      | yes          | rust/node   | full    | yes              | yes            | **done** (`7b7bfd2`)            |
| vikunja-mcp         | yes          | python      | full    | yes              | yes            | **done** (`d4cc568`)            |
| ftn                 | yes          | node        | full    | yes              | yes            | **done** (`e691c9ef0`)          |
| huddle-concept      | yes          | node        | minimal | **no**           | yes (added)    | **done** (`9cde324`, `ffe4c29`) |
| dagster-tutorial    | yes          | python      | minimal | **no**           | yes (added)    | **done** (`f2024a8`, `39cd5f5`) |
| dbt-duckdb          | yes          | python/node | minimal | **no**           | yes (added)    | **done** (`1fc0aa5`, `4158b72`) |
| gaggle              | yes          | node        | full    | yes              | yes            | **deferred** (abandoned)        |

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

## 7. The tailnet prerequisite — closed

The capability assumes the container is already on the tailnet, and every repo in
§2 has that wiring **except the three that also had no post-start file**. They
predate it, and their `runArgs` had been left minimal. All three now have it
(`ffe4c29`, `39cd5f5`, `4158b72`), as four additions each:

| what was added                                                        | where                   |
| --------------------------------------------------------------------- | ----------------------- |
| `--cap-add NET_ADMIN`, `--device /dev/net/tun`                        | `runArgs`               |
| `source=<repo>-tailscale-state,target=/var/lib/tailscale,type=volume` | a new `mounts` array    |
| install Tailscale, start `tailscaled`                                 | appended to post-create |
| start `tailscaled`                                                    | inserted in post-start  |

Order matters in post-start: the daemon is started **before** the agent hook,
because `agent-dev.sh start` resolves the container's tailnet name from
`tailscale status --json` and refuses to guess. Starting the agent first would
produce the loud "no tailnet name could be resolved" block on every boot even
though the daemon was about to come up.

Note what this deliberately does **not** do. It adds the two privileges, which is
a real change: `--device=/dev/net/tun` needs a host that has the tun device, and
on a host without it the container fails to start outright rather than degrading.
Their `--sysctl net.ipv6.conf.all.disable_ipv6=1` is untouched, and their
`--stop-timeout 30` was already there.

**One thing is still manual, and is not a defect:** the container has Tailscale
installed and running but is not _joined_. Joining is interactive
(`sudo tailscale up`) and the state persists in the volume, so it is once per
container. The genproj-style repos get the same step from
`scripts/cloud-login.sh`; these three have no such script, so run it by hand.
Until then the agent fails open with the "no tailnet name" message, which is the
designed behaviour and not a silent failure.

### 7.1 The generator is unaffected

Nothing changed in `getDevcontainerJsonExtras()` or the devcontainer templates:
the wiring is emitted unconditionally already, so a _generated_ repo has always
had it. This was the one gap between "generated" and "backported" — and it is the
argument for decision B holding: the provider existed, these three just never
received it.

## 8. The secrets — closed, and where they live now

Found by running the agent, not by reading it: the reference container came up,
resolved its tailnet name, cold-started the launcher, fetched 0.1.42, verified
goose 1.51.0, assembled the card as `genproj-dev` — and then a2a-goose refused to
start with `cannot read env:A2A_GOOSE_BEARER_TOKEN`.

`read_secret()` was reading the **repo's own** `doppler.yaml` project/config
(genproj → `genproj/dev`, which holds `BUILDKITE_TOKEN` and `SERVICE_SECRET`).
Two of the four keys existed nowhere, and `LITELLM_MASTER_KEY` lived in the
`litellm` project. Both halves are now fixed.

**Provisioned** — in the shared `common` project, all of `dev`, `stg`, `prd`, so
every container can read them without a per-repo copy:

| key                        | value                                       |
| -------------------------- | ------------------------------------------- |
| `A2A_GOOSE_BEARER_TOKEN`   | generated (`openssl rand -hex 32`)          |
| `GOOSE_SERVER__SECRET_KEY` | generated (`openssl rand -hex 32`)          |
| `LITELLM_MASTER_KEY`       | **copied** from `litellm/prd`               |
| `LITELLM_BASE_URL`         | `http://nas:4000` (not a secret; see below) |

**Coded** — `read_secret()` tries the repo's own config first, then
`common/prd` (overridable with `A2A_GOOSE_COMMON_PROJECT` /
`A2A_GOOSE_COMMON_CONFIG`), so a repo that wants its own token keeps winning. It
is a template change, so it applies to every future generation too.

Two things to know about this arrangement:

- **`LITELLM_MASTER_KEY` is now duplicated**, and `litellm/prd` remains the
  source of truth. Rotating it in one place and not the other silently breaks
  registry registration, and the agent's log is where that shows up. If that
  matters more than the convenience, the alternative is to keep reading that one
  key from `litellm/prd` explicitly rather than from `common`.
- **`LITELLM_BASE_URL` is in `common` only to make the env file complete.** The
  address the agent dials comes from the config file's `registry.litellmBaseUrl`,
  which is the capability's `litellmBaseUrl` setting. The env copy is a
  duplicate of a non-secret.

Also fixed while in there: a start with no bearer token is no longer attempted.
`write_env_file` reports the reason once and cmd_start returns, instead of
launching into a refusal that only the log explains.

Verified live in genproj's own container after both changes:

```console
$ ./scripts/agent-dev.sh start && ./scripts/agent-dev.sh status
agent genproj-dev: running (pid 47454)
card: http://genproj.tail86fd19.ts.net:10001/
... "registered with LiteLLM" agent_id 3762df35-ac30-46f9-a5d6-b736a3afbe39
```

and `list_agents` shows it, with the card carrying the turn-deadline extension
(`promptSecs: 900`, `cancelSecs: 10`) — acceptance §5.

## 9. Rolling the script fix out to the repos that already have it

`scripts/agent-dev.sh` is **app-owned**: regeneration deliberately never
overwrites it. That is the right call, and it has a consequence for exactly this
kind of change — a template fix does not reach the repos that received the file
earlier. So the fix was re-seeded per repo: regenerate the script for that repo's
name from the current generator, commit only that file, push.

All 17 repos that had been backported were re-seeded (a2a-goose, mailroom,
nas-port-mcp, parquet-peek, pshelf, agent-swarm, agy-telemetry, circleci-mcp,
dagu-mcp, deepseek-balance, miniflux-feed-dedup, stripe-toddler, vikunja-mcp,
ftn, plus the three of §7 in the same commit as their tailnet wiring). The diff
is the same 50-odd lines in each: the two `COMMON_*` defaults, the fallback in
`read_secret`, the bearer-token check, and `write_env_file || return 0`.

**The lesson worth keeping:** anything that lands in `agent-dev.sh` after the
first backport needs this second pass. It is the price of app-ownership, and it
is cheaper than the alternative — a genproj-owned script that a regeneration may
clobber, which would fight every repo that has ever edited it.
