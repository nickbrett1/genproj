# 017 — the AI coding agents are core capabilities, always applied

**Status:** implemented (2026-09-24). Supersedes the optionality of
`coding-agents` and `container-agent` established in
`008-genproj-container-agent` and `011-genproj-catalog-categories`, and removes
the now-empty `agents` category.

## Why

The AI coding agents — `coding-agents` (goose and the Antigravity CLI, plus the
project MCP servers and spec-first recipes) and `container-agent` (the
container's own registered a2a-goose agent) — are no longer a nice-to-have
bolted onto a devcontainer. They are the reason a devcontainer is the right
place to work, and they were both opt-in: `category: "agents"`,
`selectedByDefault: false`, unlocked, and no `devcontainer-*` depended on them.
A project could be generated without them and the result was a container you had
to configure before you could work in it. That was the wrong default.

The fix is to make **both** agent capabilities core and always applied: every
generated project carries them, whatever the caller asks for.

## What changed

### The catalog owns the decision

`src/catalog/catalog.json` — both `coding-agents` and `container-agent`:

| field               | before   | after  |
| ------------------- | -------- | ------ |
| `category`          | `agents` | `core` |
| `selectedByDefault` | `false`  | `true` |
| `locked`            | _absent_ | `true` |

This keeps the invariant `tests/catalog.test.js` already pins —
`selectedByDefault === (category === "core")` — and puts both capabilities in
the "Core Capabilities (Always Included)" section the UI renders from the
catalog.

Because both members left it, the `agents` category is **removed** rather than
left declared-but-empty: the top-level `categories` block loses its `agents`
entry and `src/catalog/schema.json` drops `"agents"` from the category enum.

### `locked` is enforced by the server, not just the UI

The schema already defined `locked` as "always applied … a client must not offer
to deselect it", but nothing enforced it — it was a client-side contract. A
caller on the MCP or HTTP path could omit the agents entirely.

- `src/catalog/index.js` gains `getLockedCapabilityIds()`, the ids the catalog
  marks `locked`.
- `src/generator/project-context.js` — `resolveCapabilityDependencies` (the
  **generate** path) visits the locked ids before the caller's selection.
- `src/generator/capability-resolver.js` — `resolveDependencies` (the
  **preview** and execution-order path) seeds its resolved set and its worklist
  with the locked ids.

Both resolvers therefore produce the same baseline, so preview continues to
agree with generation. A locked capability is _baseline_, not a dependency: it is
present in `resolvedCapabilities` but not counted in `addedDependencies` (its own
dependencies — `doppler` — are). The `devcontainer-*` dependency edges are left
untouched: the agents are always applied because they are locked, not because
every devcontainer declares a dependency on them.

## Consequences

- **Every generated project has a coding agent and its container agent.**
  `coding-agents` declares `doppler`, so the closure also makes `doppler`
  unconditional. That is inherent, not incidental: goose's provider and MCP
  secrets come from Doppler (spec 012), so an always-present goose implies an
  always-present Doppler.
- **The "no goose" resolved scenario is gone.** Spec 012 gated goose on `doppler`
  so a project with no agent capability did not ship a goose that dies with "No
  provider configured". Since no resolved selection lacks `doppler` any more, the
  gate is open on every resolved path. It still governs the raw-selection callers
  (`generateMergedDevelopmentContainerFiles`, `generateAllFiles`) and keeps
  what-makes-goose-runnable written down.
- **The `agents` category is gone.** Both of its members are now core, so a
  client renders one fewer section. A client that already renders from the
  catalog needs no change.

## Verification

- `tests/catalog.test.js` — the defaults list names both agents; the agent block
  asserts both are core + pre-selected + locked; a category filter test asserts
  `agents` is gone (empty) and `getCategoryById("agents")` is `undefined`; the
  rendered/declared section-order lists drop `agents`.
- `tests/routes.test.js` — `/v1/catalog` serves the section order without
  `agents`.
- `tests/generator/capability-resolver.test.js` — the locked agent baseline is
  present in any selection (and not counted as an added dependency).
- `tests/generator/goose-gate.test.js` — preview shows goose for a bare
  devcontainer, because the execution order resolves the locked baseline.
- Full suite: `npx vitest run` → **798 passed**. `npx prettier --check` clean;
  `npx eslint` 0 errors (pre-existing warnings only).

## Note for clients

A client that already honours the catalog needs no change: `selectedByDefault`
pre-selects the agents and `locked` must stop it offering a deselect. Because the
server now seeds them anyway, a client that ignores `locked` still gets them in
the generated project — the catalog field is what keeps the UI honest, the
resolver is what makes it true.
