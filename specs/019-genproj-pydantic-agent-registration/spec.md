# 019 — the pydantic-agent registration is idempotent by id, not by a filtered listing

**Status:** implemented (2026-10-03).

This is a defect record. It writes down what the generated `pydantic-agent`
registration got wrong, what the fix is, and how it is pinned — so the reasoning
survives the code.

## The defect

`src/generator/templates/pydantic-agent-register-py.template` emits
`agent/register.py`, whose lookup was:

```python
async def _find_agent_id(client, headers, agent_name) -> str | None:
    response = await client.get(f"{LITELLM_BASE_URL}/v1/agents", headers=headers)
    response.raise_for_status()
    for agent in response.json():
        ...
```

`GET /v1/agents` is **not authoritative**. It is filtered by the calling key's
owner: every row carries `created_by`/`updated_by`, and the listing shows what
that key owns. When the row exists but the listing does not show it, the
generated flow was:

1. `_find_agent_id` → `None`;
2. `POST /v1/agents` → duplicate-name refusal;
3. `response.raise_for_status()` raises;
4. the broad `except Exception` catches it and prints
   `could not register ... (fail open; will retry on restart)`.

The agent is in fact registered, reachable and addressable by id — but it cannot
see or manage its own entry, it never converges, and every restart repeats the
same failure. The log line points at the gateway, which is the wrong place to
look.

The design choice that makes this _more_ likely to bite here than elsewhere is
deliberate and correct: the template registers with a key bound to a
`proxy_admin` **user** (not the master key, not `user_role`). A scoped user key
has a **narrower** owner view than the master key, so the listing is more likely
to hide the row than it would be under a master-key registration. The
`proxy_admin` credential stays — the fix is to stop depending on the listing.

## The fix — port `a2a-goose`'s `src/registry.rs`

The reference implementation (`nickbrett1/a2a-goose`, `src/registry.rs`)
documents the measurement (2026-09-18): rows written by an older build "carried
no owner stamp and disappeared from the listing while remaining present, callable
and addressable by id." Its module comment concludes that the listing is a view
and the lookup must degrade. The generated Python now ports four behaviours and
one shape tolerance:

1. **By-id fallback.** When the name scan comes up empty, the id remembered from
   the last registration is checked with `GET /v1/agents/{id}` — which is _not_
   filtered. `404` = genuinely gone → create. A row that now names a _different_
   agent is never adopted; the code says so and creates instead (the proxy then
   refuses the name, honestly). This is `_agent_id_by_remembered_id`.
2. **Remember the id between runs.** Persisted at
   `$AGENT_STATE_DIR/registry-agent-id`; default
   `~/.local/state/pydantic-agent/<agent-name>/registry-agent-id`. Written to a
   sibling and renamed, so a reader never sees a half-written id.
   `_remember_agent_id` logs and swallows a failure: an unwritable or
   unconfigured path must not fail a registration that otherwise worked.
3. **Duplicate-name reclaim.** On the `POST` refusal, re-look-up and
   `PUT /v1/agents/{id}` in place. The detection keys on the **body string**
   (`Unique constraint failed` / `already exists`), not the status: the live
   proxy answers `500` with Prisma's
   `Unique constraint failed on the fields: (agent_name)` where the spike
   recorded a `400`. This is `_is_duplicate_name`.
4. **An honest, distinct failure.** When the name is taken but the entry still
   cannot be resolved, the code says the agent _is_ registered and addressable by
   id and that this is a listing-filter problem, not a proxy fault — instead of
   collapsing it into `could not register ... (fail open)`. This is
   `_name_taken_message`.

Plus one smaller parity item: `_find_by_name` treats a listing that is not an
array (`{}`, an HTML error page) as "not listed" rather than raising, so a shape
disagreement cannot stop an agent registering.

### Where the id persists, and whether that is durable

The reference persists the id beside `sessions.db`. The generated agent has no
`sessions.db` (FastA2A's `InMemoryStorage`), so the equivalent is a state file
whose location is a **runtime** setting — the durable location is a property of
the deployment's volumes, not of the repository.

- `AGENT_STATE_DIR` names the directory; `registry-agent-id` lives inside it.
- Unset, it defaults to `~/.local/state/pydantic-agent/<agent-name>/`, which is
  in the container's **image layer**. That survives a `docker restart` of the
  same container but **not** a rebuild/recreate — e.g. Watchtower pulling a new
  image and starting a fresh container. The fallback is therefore a
  best-effort convenience by default, exactly as it is in the reference for a
  host whose state dir is not persisted.
- To keep the id across redeploys — the case the fallback exists for — mount a
  **writable** host directory with `docker-container.dataMounts`
  (`readOnly: false`; dataMounts default to read-only) and point
  `AGENT_STATE_DIR` at it. This is documented in the generated `agent/README.md`
  and `agent/.env.example`.
- An unwritable path (read-only mount, missing volume, no `HOME`) is tolerated:
  registration still succeeds and only the fallback is weakened.

## Constraints held

- The `proxy_admin` user-key credential choice and its docstring rationale are
  unchanged; they are now _load-bearing_ in the docstring, which explains why a
  scoped key makes the filtered listing more likely.
- Fail-open is unchanged: a gateway outage must never stop the agent serving.
- The `protocolVersion` pinning and the card shape are unchanged.
- The generated README still tells the reader **not** to reimplement the
  gateway's iteration budgets, kill switch, cost tracking or permission
  management. Only the "Registration behaviour" section gained the listing-filter
  and state-path explanation.
- `contract.py`'s output type and validator are untouched, as is
  approval/awaiting-approval.
- Scope is the registration path only; issue #52 (`mergeDevcontainerJson`
  `runArgs`) is unrelated.

## The capability has no spec of its own

`specs/` runs 001→018 with **no `pydantic-agent` entry**, even though the
capability generates a network service that carries a control-plane credential
and (as of this record) owns a durable identity file. Every other capability in
the catalog has a spec and a machine-readable contract; `pydantic-agent` has
neither, and this defect is plausibly a consequence: there was no design document
to state that the registry listing is not authoritative, so the generated code
trusted it.

**Flagged, not fixed here.** A full capability spec (contract JSON, emitted-file
inventory, configuration schema, acceptance criteria) is its own piece of domain
work; folding it into a defect-record PR would bury it. Recommended follow-up:
`020-genproj-pydantic-agent` — the capability and its contract, of which this
record is one acceptance item.

## Scope note: `container-agent` is not affected

`container-agent` installs and runs `a2a-goose` itself from the release channel
(spec 008), so it already inherits `registry.rs`'s behaviour. This change is
`pydantic-agent` only.

## How it is pinned

`tests/generator/pydantic-agent.test.js` → _pydantic-agent registration
robustness (registry.rs parity)_: the emitted `agent/register.py` carries the
by-id fallback (including the 404 and "different agent, not ours" branches), the
remembered-id write and read, the body-keyed duplicate-name reclaim with its
in-place `PUT`, the honest distinct failure message, the non-array listing
tolerance, and the `proxy_admin`/fail-open constraints. The README/env test pins
`AGENT_STATE_DIR` and the durability wording while asserting the "do not
reimplement the gateway's controls" instruction is untouched.
