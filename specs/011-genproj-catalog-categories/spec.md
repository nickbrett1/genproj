# 011 — Category sections belong to the catalog

**Status:** implemented and verified (2026-09-19). Commits in this repo and in
[`nickbrett1/ftn`](https://github.com/nickbrett1/ftn).

## Why

Spec 008 moved the two agent capabilities into an `agents` category so the UI
could show them as their own section, distinct from "Core Capabilities". The
catalog change was the easy half. Making the section appear required a second
change and a second deploy in the **client**, because ftn's
`CapabilitySelector.svelte` kept its own copy of the presentation:

```js
const categoryNames = { core: 'Core Capabilities (Always Included)', agents: 'Agents', … };
const categoryOrder = ['core', 'agents', 'frameworks', …];
```

and rendered from that list, not from the data:

```svelte
{#each categoryOrder as categoryId}
  {#if capabilityGroups[categoryId] && capabilityGroups[categoryId].length > 0}
```

So the capability arrived over the wire, was grouped under `agents` — and then
the loop walked straight past it, because `agents` was not in the array. The
section rendered nothing and the capability was invisible. That is the same
class of bug as the earlier `embedded` category (`e3668da` in ftn): **a
category genproj knows about is invisible until ftn is edited and deployed.**

Two things make this more than an inconvenience:

- **One source of truth was a claim, not a fact.** `src/catalog/index.js`
  describes the catalog as "the single source of truth for the capabilities the
  generator can apply to a project, and the metadata the UI renders", and it
  already publishes three derived fields (`selectedByDefault`, `authServices`,
  `provides`) that exist precisely to delete UI hardcodes. Section order and
  headings leaked through that same hole.
- **`internal` was, in effect, silently dropped too.** `docker` carries
  `category: "internal"`, which appears in neither `categoryOrder` nor
  `categoryNames`. In this case the outcome is the one we want — `docker` is
  pulled in as a dependency, not chosen — but it was right by accident rather
  than by intent, and nothing recorded that.

## What changed

The catalog now declares its own sections, and the client renders them.

### genproj — a top-level `categories` array

`src/catalog/catalog.json` gains:

```json
"categories": [
  { "id": "core", "label": "Core Capabilities (Always Included)", "order": 10 },
  { "id": "agents", "label": "Agents", "order": 20 },
  …
  { "id": "internal", "label": "Internal", "order": 130, "visible": false }
]
```

- `id` matches a capability's `category`.
- `label` is the heading. The client no longer invents headings.
- `order` is the section order, ascending. Presentation metadata, moved to the
  same place as the data.
- `visible` defaults to `true`. `false` marks a **dependency-only** category:
  its capabilities still travel in the payload and are still applied, they just
  do not get a section of their own. `internal` — `docker` — is exactly this,
  and the intent is now written down instead of being an omission.

`src/catalog/schema.json` gains the matching `$defs/category` (required
`id`, `label`, `order`; `additionalProperties: false`) and `categories` is
required at the root. Because the generator bundles the catalog into the
Worker, `/v1/catalog` serves the block with no extra plumbing — `buildCatalog()`
spreads the whole catalog.

`src/catalog/index.js` exports `categories` plus two readers,
`getCategoryById(id)` and `getVisibleCategories()` (declared, ordered, minus the
invisible). The latter is what a client renders.

### ftn — the client renders what it is handed

`CapabilitySelector.svelte` loses both literals. It takes a `categories` prop
and derives the sections:

```js
$: renderedCategories = categories
  .filter((category) => category.visible !== false)
  .sort((a, b) => a.order - b.order);

$: sectionIds = [
  ...renderedCategories.map((category) => category.id),
  ...Object.keys(capabilityGroups).filter((id) => !declaredCategories.has(id)),
].filter((id, index, all) => all.indexOf(id) === index);
```

Two properties matter:

1. **The heading comes from the catalog.** `getCategoryLabel` reads
   `categories`, so renaming a section is a catalog change alone.
2. **An undeclared category still renders.** Any category present in the
   capability data but missing from the catalog is appended after the declared
   sections and labelled with its raw id. The failure that started this — a
   capability that renders nothing, silently — is closed at the client too, not
   just by trusting the catalog to be complete.

The catalog travels to the client with the capabilities it describes: the page
loader returns `{ capabilities, categories }`, and the client-side retry
endpoint (`src/routes/api/projects/genproj/capabilities/+server.js`) returns the
same shape. `getCatalogCapabilities()` — which returned a bare array and would
have dropped the sections on the retry path — is gone. Both call sites default
to `[]`, so an older genproj deploy that serves capabilities only still renders
(a page with no sections, rather than a crash).

## What this buys

Adding or reordering a category is now a **genproj change alone**. ftn needs no
edit, no test update and no deploy: the section arrives with the payload it
groups. The one deploy that remains is genproj's own — the catalog is a file
bundled into the Worker — which is the deploy you would make anyway as the
source of truth.

## Verification

### genproj

- `tests/catalog.test.js` — a new `category metadata` block pins the rendered
  section order, the `agents` heading, `internal` as `visible: false` holding
  exactly `docker`, that **every** capability's `category` is declared, unique
  `order` values, that loading does not reorder the array it was loaded from,
  and that `buildCatalog()` carries the block.
- `tests/routes.test.js` — `/v1/catalog` serves the section order;
  `/v1/catalog/schema.json` requires `categories` and exposes
  `$defs.category`.
- Full suite: `npx vitest run` → **653 passed** (was 645). `npx prettier
--check` clean on all touched files; `npx eslint` 0 errors (pre-existing
  warnings only).

### ftn

- `tests/lib/components/genproj/CapabilitySelector.test.js` — renders the
  `Agents` section for an `agents` capability; takes a heading that only exists
  in the catalog (`Renamed In The Catalog`) and shows it; renders **nothing**
  for a category marked `visible: false`; and renders a category the catalog
  never declared, under its raw id, rather than losing it.
- `tests/lib/server/capabilities-api.test.js` — the endpoint returns
  `{ capabilities, categories }`, and falls back to empty `categories` for a
  catalog that carries none.
- `tests/routes/projects/genproj/page.server.test.js` — the loader passes the
  sections through, and a catalog outage still yields `{ capabilities: [],
categories: [] }`.
- Full suite: `npx vitest run` → **1670 passed, 24 skipped**. `npx prettier
--check` clean on all touched files; `npx eslint` 0 errors.

**A note on the previous attempt.** The commit that added `agents` to the
component's `categoryOrder` (`5978727`) shipped a test that the component
**failed**: the fixture omitted `conflicts`, and `isInConflict()` dereferenced
it. The test was never run locally. Here the fixtures are built by a
`makeCapability()` factory that always supplies every field the component reads,
so a test states only what it is about. The component and its tests are green on
this commit.

## Regeneration caveat — the deployed Worker is not this working tree

The MCP `genproj` tools are served by the **deployed** Worker
(`https://genproj.nick-brett1.workers.dev`, see `src/mcp/handler.js`), not by
this checkout. The catalog is bundled into that Worker, so the new `categories`
block is not live until CI deploys `main`. Until then `/v1/catalog` serves
capabilities without sections, and a client renders no section headings at all —
which is why the two changes are pushed together and why ftn does **not** need
to be.

## The ftn deploy that this needed, and the one it does not

The client change still had to land once, and that deploy was blocked — not by
this work. `ftn`'s production deploy had been failing since the previous
category fix (`e3668da`, the `embedded` category), for a reason that has nothing
to do with categories:

```
✘ [ERROR] A request to the Cloudflare API (…/workers/ftn-production/versions/latest) failed.
  This deployment includes 68 variables, which exceeds the Workers Free limit of
  64 variables per Worker (secrets + text). [code: 10055]
```

The sync pushes the **whole** shared `common/prd` bus merged with webapp's own
config — 61 secrets — into the Worker, and the limit counts every variable on it
(secrets and text). That alone does not explain 68, and the reason matters:

```console
$ npx wrangler versions secret list --env production | sed -n 's/^Secret Name: //p' | wc -l
68
$ doppler secrets --json -p common -c prd | jq length      # + webapp/prd, merged
61
```

`wrangler versions secret bulk` only ever **adds or updates**. A key synced once
stays on the Worker until it is deleted explicitly, so the Worker had
accumulated beyond the bus — 7 of the 68 were not on the bus at all any more.
Filtering the outgoing set would not have brought the count down on its own.

So the fix is reconciliation, not just a filter:

- `webapp/scripts/worker-secret-exclusions.txt` names the 23 keys this Worker
  does not read;
- the sync drops them, then compares what is **deployed** against what should be
  and deletes the difference — 30 removals the first time (23 excluded + 7
  stale), leaving 38 against a budget of 64;
- it then checks its own count before uploading, so the next overflow is a
  readable message rather than the API's `10055` four retries deep.

The guard that keeps the list honest is the point: every excluded key must be
absent from everything the Worker is built from and runs
(`webapp/src`, `webapp/worker`, `webapp/scripts`, `.buildkite`, `.github`,
`wrangler.template.jsonc`), and `tests/sync-doppler-secrets.test.js` asserts it —
executing the real script against a stubbed `doppler`/`npx` and reading the
batches and deletions it would have issued, rather than pattern-matching its
source. A key that later becomes used fails the test instead of failing in
production. Removals are best-effort housekeeping: an unreadable list warns and
the upload still goes ahead.

This is a fix to the deploy path, not the category work: had the ftn deploy been
healthy, this spec would have needed one ftn deploy and would have needed no
further ones.

## Follow-ups

- The ftn static copy at `src/lib/utils/capabilities.js` /
  `src/lib/config/capabilities.js` is stale (it predates `container-agent`
  entirely) and is not the live source — the selector is fed from `/v1/catalog`.
  Left untouched; worth deleting rather than syncing.
- `list_genproj_capabilities` used to return the capability array without the
  sections, deliberately (an agent consuming capability IDs does not render
  headings). The MCP/HTTP catalog parity fix removed that divergence: the tool
  now returns the whole catalog document via `buildCatalog()`, the same shape as
  `GET /v1/catalog`.
