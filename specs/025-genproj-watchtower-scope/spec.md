# 025 — `docker-container.watchtowerScope`: route a container to one Watchtower instance

**Status:** implemented (2026-11-07).

## Problem

A host can run more than one Watchtower. This one runs two:

| instance          | configuration                                       | poll behaviour   |
| ----------------- | --------------------------------------------------- | ---------------- |
| `watchtower-nick` | `WATCHTOWER_SCOPE=nick`, `POLL_INTERVAL=60`         | every 60 seconds |
| `watchtower`      | no scope, `SCHEDULE=0 0 3 * *`, `LABEL_ENABLE=true` | nightly at 03:00 |

Without a scope label, every labelled container is picked up by the unscoped
instance, i.e. by the **nightly** sweep. A freshly generated project therefore
looks broken to its author for up to a day after a push: the image is published,
but the running container does not move. The 60-second instance only manages
containers that say so, with `com.centurylinklabs.watchtower.scope=nick`.

## Empirical evidence: a scope transfers ownership, it does not duplicate it

The label semantics were measured on the host, not assumed from the docs:

- `watchtower-nick` (`WATCHTOWER_SCOPE=nick`) scanned **5** containers;
- the unscoped `watchtower` scanned **10** containers;
- the two sets were **disjoint**.

So a container carrying `scope=nick` is managed by the scoped instance **only**:
it is not left dual-managed (two instances fighting over one container), and it
is not left unmanaged (the label does not hide it from both). The corollary is
the trap this feature must document: a scope value that **no** running instance
serves makes the container permanently invisible — the unscoped instance
filters it out and no scoped instance matches it.

## The key

```json
"watchtowerScope": {
  "type": "string",
  "default": "nick",
  "description": "Watchtower scope, emitted as the com.centurylinklabs.watchtower.scope=<value> label next to the enable label. …"
}
```

It sits next to `watchtower` in the `docker-container` schema and is emitted
**only where the enable label is**, so the two labels always travel together.

### Why the default is on, and why `"nick"`

This **deliberately breaks byte-identity for new renders**. Specs 018
(`externalNetworks`), 022 (`workload`) and 024 (`user`) all made their key
additive and default-off, and each pinned "unset renders byte-identically" with
the golden fixture. This slice does the opposite on purpose, and the exception
is the point:

- a default-off scope means a generated project lands on the **nightly** sweep,
  which reads as "the generator produced something that does not deploy";
- the failure is invisible: nothing errors, the container simply does not move
  until 03:00;
- the cost of the byte change is one line in one generated file (`compose`) plus
  the runbook that explains it.

`nick` rather than unset because that is the scope of this host's fast instance.
The value remains a **knob**, not a constant, precisely because `nick` is a
host-local convention: it names _this_ host's `watchtower-nick` service, and any
other deployment must set its own scope (or `""`). Hardcoding the convention is
acceptable only because the knob exists to override it.

`""` is the documented escape hatch: it emits the enable label but no scope
label, i.e. "let any unscoped instance manage this container". An **absent** key
and an explicit `""` are different: absent means default (`nick`), `""` means
opt out.

## Design

### Emit

In `getDockerContainerTemplateData` (`capability-template-utils.js`):

- `watchtowerScope = watchtower ? resolveWatchtowerScope(config) : ""` — the
  same gate as the enable label, so `watchtower: false` and `workload: batch`
  emit neither label (and no orphan `labels:` block);
- inside the existing `labels:` block, immediately after
  `com.centurylinklabs.watchtower.enable=true`:
  `      - "com.centurylinklabs.watchtower.scope=<scope>"`.
  No new placeholder, so `docker-compose.template` is untouched.

`resolveWatchtowerScope(config)` is the emit path. It:

- returns `DEFAULT_WATCHTOWER_SCOPE` (`"nick"`) when the key is **absent**
  (`undefined`/`null`) — this default lives in the helper, **not** in the
  catalog, because compose rendering receives the raw configuration and catalog
  defaults never reach it (`file-generator.js` `collectSingleTemplateFile`);
- accepts `/^[A-Za-z0-9][A-Za-z0-9_.-]*$/` after trimming;
- returns `""` for empty, whitespace, non-string or invalid input, because a
  preview does not run the project validators (the `externalNetworks` /
  `resolveDockerUser` precedent): a bad value must never reach a generated file.

### Validate

`validateDockerWatchtowerScope` in `project-validation.js`, called from
`generateAllFiles` beside `validateDockerNetworks` / `validateDockerUser`,
throwing `ValidationError(message, "watchtowerScope")`. Rejected, each with a
message that names the way out:

- **whitespace** (spaces, tabs, newlines) — breaks the quoted YAML scalar and
  the label value;
- **`:`** — splits the label's `key=value` pair, so the scope can never match;
- **`#`** — starts a YAML comment and truncates the value;
- any other non-token character, quotes included.

An empty string is **not** rejected: it is the documented opt-out.

### Document

Section 3 ("Auto-updates with Watchtower (poll model)") of
`deploy-readme.template` now names **both** labels and states that the project
is scoped to `{{watchtowerScope}}`, that the matching instance polls (so updates
land within the poll interval, not the nightly sweep), and the trap plainly: if
no instance on the host runs with `WATCHTOWER_SCOPE=<scope>`, the container is
never updated and nothing logs an error because the unscoped instance filters it
out. The header comment gains `watchtower scope=<scope>`.

Both additions are **empty when the scope is empty** (the
`imageVisibilitySection`/`runtimeUserDocs` pattern), so `watchtowerScope: ""`
keeps the runbook byte-identical to the pre-slice render. The default runbook
does change, because the default scope is on — see above.

The **batch** runbook (`deploy-readme-batch.template`) is untouched: a batch job
defaults to no Watchtower, and its section 4 already says so. An explicit
`watchtower: true` on a batch job still emits both labels (see acceptance
criterion 5); that pre-existing runbook/batch contradiction is out of scope here.

## Non-goals

- **No per-project scope generation.** A generated unique scope (e.g. the
  project name) is worse than none: no instance serves it, so the container is
  silently never updated. The scope must name an instance that actually runs,
  which only the operator knows.
- **No change to Homepage or batch behaviour.** Homepage labels keep their
  order and gating; `workload: batch` keeps its no-Watchtower default.
- **No change to the stale `specs/003-genproj-docker-container/contracts/docker-container.capability.json`.**
  That snapshot is already missing `workload`, `user`, `dataMounts` and more;
  adding one key to an incomplete snapshot would imply it is current.

## Acceptance criteria

1. A default `docker-container` project emits **both**
   `com.centurylinklabs.watchtower.enable=true` and
   `com.centurylinklabs.watchtower.scope=nick`.
2. An explicit `watchtowerScope: "prod"` emits `scope=prod` and not `scope=nick`.
3. `watchtowerScope: ""` emits the enable label but **no** scope label, and the
   runbook is byte-identical to the pre-slice render.
4. `watchtower: false` emits neither label (and no orphan `labels:` block), also
   with Homepage off.
5. `workload: batch` emits no scope label; an explicit `watchtower: true` on a
   batch job emits both.
6. A value that would corrupt the label or YAML is a generation error whose
   `field` is `watchtowerScope`.
7. The golden fixture changes in exactly `docker-compose.yml` (one label line)
   and `deploy/README.md` (the scope documentation); `Dockerfile` and
   `.buildkite/pipeline.yml` stay byte-for-byte identical.

## Tests

`tests/generator/docker-watchtower-scope.test.js` — 20 assertions over
emission, the `""` opt-out, the batch gate, the runbook text and every rejected
value (field included), plus direct unit coverage of
`resolveWatchtowerScope`'s unsafe-input path. `tests/catalog.test.js` pins the
schema key, its default and the trap in its description.
