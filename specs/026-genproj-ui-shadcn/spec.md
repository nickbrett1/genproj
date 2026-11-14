# 026 — `ui-shadcn`: a generated SvelteKit project starts on the house design system

**Status:** implemented (2026-11-14). Realigned to theme **v1.2.0**
(`cssVars` + `css`, no `files[]`) after `shadcn-svelte@1.8.1` was observed
resolving a `registry:theme` item's `files[].target` against the basename of
the consumer's stylesheet used as a directory (2026-11-14). Design rationale:
`projects/genproj/genproj-ui-shadcn-capability.md`.

Every generated UI project starts from a bare framework default, so the house
look is re-derived per project — the proof being a `theme.css` that has been
hand-copied twice inside the estate. `@nb/theme` now exists as an immutable,
version-addressed registry item, and nothing in genproj consumed it. This
capability is the consumer half.

The generator never runs `npm`, `npx` or `shadcn add`: it emits files. That is
an architectural boundary, not a missing convenience, and it decides what this
capability can honestly promise — see "What it does not do" below.

## The catalog entry

| Field                 | Value                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| `id`                  | `ui-shadcn`                                                                      |
| `category`            | `frameworks`                                                                     |
| `dependencies`        | `["sveltekit", "doppler"]`                                                       |
| `configurationSchema` | `registryUrl` (string, **empty** by default), `themeVersion` (string, `"1.2.0"`) |
| `vscodeExtensions`    | `bradlc.vscode-tailwindcss`                                                      |

`sveltekit` because the theme and `components.json` are only meaningful in a
SvelteKit app; `doppler` because `${NB_REGISTRY_TOKEN}` has to resolve from
somewhere and Doppler is where it lives.

**No conflict rule with the registry repo.** The design note wanted "the
`ui-registry` repo must not select this capability" expressed as a conflict.
It cannot be: genproj has no notion of "this repository is the registry", and a
`publishesRegistry: true` flag would exist only to be set right once. The
capability is opt-in; the registry repo does not select it.

## What it emits

For a `sveltekit + ui-shadcn` project at the repository root, under the Svelte
directory (`web/`) when the primary language is not node:

| File                                   | Contents                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `package.json`                         | `+ tailwindcss`, `@tailwindcss/vite`, `clsx`, `tailwind-merge`, `tailwind-variants` |
| `vite.config.js`                       | `+ tailwindcss()` — Tailwind v4 is a Vite plugin, not a PostCSS config              |
| `src/app.css`                          | `@import "tailwindcss";` and nothing else                                           |
| `components.json`                      | the `@nb` registry block: `{name}.json` URL, bearer header, `params.version`        |
| `src/lib/utils.ts`                     | `cn()` over `clsx` + `tailwind-merge`                                               |
| `.agents/.rules/styling_guidelines.md` | the agent-facing rules (semantic tokens only, compose, pin)                         |

There is no `src/nb-theme.css` and no import of one. A `registry:theme` item
has no install path: its payload is `cssVars` and `css`, which the CLI merges
into the consumer's own stylesheet. `src/app.css` is therefore the bare
Tailwind v4 entry — exactly the state `shadcn add @nb/theme` expects to merge
into.

Two details in `components.json` are load-bearing:

- **`{name}.json` plus `params.version`** is the only shape the registry answers
  for an item (`/r/theme.json?version=1.2.0`). An unversioned request is a `400`
  by design, so a capability that omitted `params.version` would produce a
  project that cannot install anything.
- **`Bearer ${NB_REGISTRY_TOKEN}` is a literal.** `${VAR}` expansion is the
  CLI's job at `shadcn add` time; interpolating it here would put a live token
  in git.

## The theme content is merged by the CLI, never copied

`registryUrl` is empty by default and the emitted URL is
`https://registry.invalid/r/{name}.json` — RFC 2606 reserves `.invalid`, so an
unconfigured project fails loudly at `shadcn add` instead of fetching from a
guess. Baking in `ryzen:3012` would look correct on exactly one machine.

The alternative — inlining the published token sheet into a template at
generation time — is the one thing this capability must not do: a token sheet
copied into a project is the drift problem wearing a capability's clothes. So
the scaffold emits the bare Tailwind entry and the project **builds and is
unstyled**, not broken, until someone runs:

```bash
npx shadcn-svelte@latest add @nb/theme
```

`shadcn-svelte@1.8.1` then merges the item's `cssVars.theme` (the 28 custom
properties) and `css` (the rule grammar keyed by selector) into `src/app.css`,
leaving `@import "tailwindcss"` intact. A generated project therefore ends up
with `@theme inline { --bg: #0f172a; … }` plus every rule, and **no
`nb-theme.css` anywhere**. This is mechanism B from the design note (§5.1), and
it is the only mechanism the generator's architecture permits: a
generation-time fetch that inlined `cssVars`/`css` would still be mechanism A
and is not implemented here.

**The file-and-`target` question (§5.2) is closed, by observation.** A theme
item's `files[]` are not installed at a declared path at all: the CLI resolves
`files[].target` against `path.basename(config.resolvedPaths.tailwindCss)` used
as a directory, i.e. `<cwd>/app.css/src/nb-theme.css`. Installing `@nb/theme`
v1.1.0 that way created a folder named `app.css` containing a stylesheet
nothing imported, and left `src/app.css` untouched. v1.0.0 (`target:
src/app.css`) and v1.1.0 (`target: src/nb-theme.css`) are frozen and still
served — registry items are immutable — so the capability pins **1.2.0**, the
first version published in the merged shape.

## What it does not do

- **No `blocks` multi-select.** Zero blocks are published; an enum of names
  that do not exist is a form control that lies. It arrives with the blocks.
- **No generation-time registry fetch.** See above.
- **No preview output.** `preview-generator.js` reuses
  `generateViteConfigFile`, so a preview shows the Tailwind plugin, but the
  emitted-file list is produced by the generator, not the preview. Previews
  remain a subset until they converge on `generateAllFiles`.

## Tests

`tests/generator/ui-shadcn.test.js`:

- absent unless selected — no files, no Tailwind dependency, no Vite plugin;
- `components.json` pins `1.2.0` (the catalog default, which a test keeps in
  lockstep with the generator), keeps the literal `${NB_REGISTRY_TOKEN}`, uses
  `{name}.json`, honours a configured URL (trailing slash stripped) and a
  version override;
- an unset `registryUrl` yields the `.invalid` placeholder **and** an explicit
  "the block is inert" statement in the styling rules; a set one removes it;
- no `nb-theme.css` is emitted at any path, and `src/app.css` is exactly
  `@import "tailwindcss";` with no `nb-theme` reference — the file-and-import
  model is inverted, not merely absent;
- no emitted file carries a house token (`#0f172a`) — the no-template-copy rule
  is asserted, not merely intended;
- the manifest and Vite plugin are wired, and `resolveDependencies` pulls in
  `sveltekit` and `doppler`;
- a non-node frontend relocates the whole set under `web/` while the agent rules
  stay at the repository root.

All 1027 tests pass; the coverage gate is unchanged.
