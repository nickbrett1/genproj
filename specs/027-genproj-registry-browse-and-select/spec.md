# 027 — browse and select: an agent finds a block before it writes a layout

**Status:** implemented (2026-11-14). Follows `026-genproj-ui-shadcn`; closes
phase 3b of `projects/genproj/genproj-design-system-and-ui-registry.md` §8.4.

Phase 3b's success test was written as: _browse and select work; an agent
installs a block rather than writing one._ The registry half is done — the
gallery at `/` renders all eleven blocks, and the served version index carries
`title` and `description` for every item. This spec is the consumer half:
generated projects have to know the catalogue exists, where to read it, and
what to do when the page they are writing is not in it.

Three defects stood in the way, all of them the same shape: **a list in the
generator that had stopped matching the catalogue.**

| defect                                                                                   | cost                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NB_BLOCKS` held nine names — `bar-series` (1.9.0) and `data-table` (1.8.0) were missing | selecting either from the catalogue was accepted by the UI and then **silently dropped** at generation, with the styling rules explaining that the block did not exist |
| `NB_THEME_DEFAULT_VERSION` was `1.8.0`                                                   | a new project pinned a version three releases behind, missing `app-shell`'s `nav`, the theme's page-intro rules and the sticky-inset fix                               |
| nothing in the generated project described how to _find_ a block                         | an agent with a page to write had eleven layouts available and no reason to look for them, so it wrote a twelfth                                                       |

## What changed

**Catalogue and generator agree on eleven blocks**, in the registry's own order.
`themeVersion` defaults to **1.10.1** — the newest version that is a full
release _and_ carries the sticky-inset fix. The distinction matters: a version
index is a snapshot of the whole catalogue, so a version that carried one item
serves an index of one and `add stat-strip` 404s against it.

**The styling rules gain `## Finding a block`.** The browse surface is the
registry's own version index, on the same pinned base as the install commands:

```bash
curl -s <base>/v<version>/index.json
```

That is not a new API invented for agents. It is the document
`shadcn-svelte@1.8.1` fetches before it installs anything, and it carries
`title` and `description` per item **because the published items do** — so one
request answers both "what exists" and "which one is this page". The gallery
renders the same catalogue with live examples and is named as the faster read
when choosing by eye.

The section also states the negative case, because it is the one that keeps the
catalogue honest: _if the block is not there, say so and build it._ A near-miss
block installed to avoid writing a layout is how a design system becomes a tax
— the page ends up shaped like something it is not, and the next agent copies
it.

**A count that cannot drift.** The rules used to say "the registry publishes
nine blocks" in prose while `NB_BLOCKS` said nine. Both are now derived from
the array (`countWord(NB_BLOCKS.length)`), so adding a twelfth block cannot
leave a sentence behind.

## What it deliberately does not do — and the evidence

**No MCP server is emitted, because the Svelte CLI has none.** The phase was
written as "the gallery over `registry.json`, plus the MCP server in generated
repos". Measured against the published CLI rather than assumed:

```
$ npx shadcn-svelte@1.8.1 registry --help
Commands:
  build [options] [registry]  build components for a shadcn-svelte registry
```

There is no `list`, no `search`, no `mcp`, and no MCP entry point in the
bundle. (`shadcn-svelte-mcp` on npm is a _documentation_ server; the shadcn MCP
that searches a registry is the React CLI's.) Emitting an `mcpServers` entry
for a server that does not exist would be the same defect class as the
`registries` block `026` removed from `components.json`: **config that reads as
working**. A test asserts the rules make no such claim.

So the honest sequence is: browse with the index and the gallery (now), and if
an MCP is wanted later it has to be one we write — it would read
`/r/v<version>/index.json` and answer `list` + `install`. That is a spec of its
own, not a line in this one.

**Nothing is installed at generation time.** The generator emits files and
never runs `npm`/`npx`; `026` chose that boundary and this spec keeps it. The
rules carry the exact command, and `--yes --overwrite` is present because
without `--overwrite` the CLI asks a second question, exits 0, and writes
nothing.

## Tests

`tests/generator/ui-shadcn.test.js` (+3, 22 in the file, 1036 in the repo):

- **every published block is accepted** — all eleven names produce an `add`
  command, and no "does not exist" paragraph appears;
- **the browse section is pinned to the same base as the install commands**,
  names the index, the `title`/`description` fields and the `<name>` command,
  and states the negative case;
- **no registry MCP is claimed** — no `shadcn-svelte mcp`, no `mcpServers`.

The two existing assertions that pinned `1.8.0` moved to `1.10.1` in the same
edit, which is the point of them: the catalogue default and the rules' base are
one decision, and a test that names the version is the only thing that notices
when they part company.
