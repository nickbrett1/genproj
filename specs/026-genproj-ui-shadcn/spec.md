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
SvelteKit app; `doppler` because the install command resolves the registry base
from `COMPONENTS_REGISTRY_URL` in Doppler (there is no token to resolve: the
endpoint is public, because the only client that reads it sends no auth header).

**No conflict rule with the registry repo.** The design note wanted "the
`ui-registry` repo must not select this capability" expressed as a conflict.
It cannot be: genproj has no notion of "this repository is the registry", and a
`publishesRegistry: true` flag would exist only to be set right once. The
capability is opt-in; the registry repo does not select it.

## What it emits

For a `sveltekit + ui-shadcn` project at the repository root, under the Svelte
directory (`web/`) when the primary language is not node:

| File                                   | Contents                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `package.json`                         | `+ tailwindcss`, `@tailwindcss/vite`, `clsx`, `tailwind-merge`, `tailwind-variants`, `shadcn-svelte`          |
| `vite.config.js`                       | `+ tailwindcss()` — Tailwind v4 is a Vite plugin, not a PostCSS config                                        |
| `src/app.css`                          | `@import "tailwindcss";` and nothing else                                                                     |
| `src/routes/+layout.svelte`            | imports `../app.css` — SvelteKit imports no stylesheet by itself                                              |
| `tsconfig.json`                        | self-contained, with the `$lib` alias the CLI resolves to place a component                                   |
| `components.json`                      | `style`, `tailwind.css`, `aliases`, `typescript` — and **no `registries` block**                              |
| `src/lib/utils.ts`                     | `cn()` over `clsx` + `tailwind-merge`                                                                         |
| `.agents/.rules/styling_guidelines.md` | the agent-facing rules (semantic tokens only, compose, pin) plus one pinned `add` command per requested block |

There is no `src/nb-theme.css` and no import of one. A `registry:theme` item
has no install path: its payload is `cssVars` and `css`, which the CLI merges
into the consumer's own stylesheet. `src/app.css` is therefore the bare
Tailwind v4 entry — exactly the state `shadcn add @nb/theme` expects to merge
into.

Three more corrections came from the same exercise — generating a project,
installing the theme into it and building it:

- **Nothing imported `src/app.css`.** SvelteKit imports no stylesheet by itself,
  so the theme installed perfectly into a file nothing loaded: the build passed
  and the page was unstyled. The capability now emits
  `src/routes/+layout.svelte` with `import "../app.css";`.
- **There was no `tsconfig.json`** while `components.json` said
  `typescript: true`, and the CLI refuses outright: "Failed to find a
  tsconfig.json file". The file is emitted self-contained (not `extends
./.svelte-kit/tsconfig.json`, which does not exist until kit has run) and
  carries the `$lib` path alias, which is what the CLI resolves.
- **`style: "new-york"` is unsupported.** That is React-CLI vocabulary; the
  Svelte CLI warns "Unsupported style ... Using nova instead" and substitutes,
  so the file claimed a style the install did not use. It now emits `vega`, the
  style the registry's contract test exercises.

**`components.json` carries no registry block, and that is the correction this
spec needed.** Earlier revisions specified
`registries: { "@nb": { url, headers: { Authorization: "Bearer
${NB_REGISTRY_TOKEN}" }, params: { version } } }`. That is shadcn/ui (React)
syntax: `shadcn-svelte@1.8.1` implements no `registries` map, no `headers`, no
`{name}` template and no `params.version`. A generated project therefore carried
a file that read as a working, pinned registry and did nothing at all — a
silently wrong configuration, which is the failure mode this capability exists
to remove. Found by generating a project and running the CLI against it (the
`ui-registry` contract test, `scripts/cli-contract.js`), not by reading.

What the Svelte CLI does read: `style`, `tailwind.css` and `aliases`. Its
registry base comes from `COMPONENTS_REGISTRY_URL`, **used verbatim** — it
appends no `/styles/<style>/` to it and has no way to carry `?version=`. So the
version is a path segment of the base (`…/r/v1.2.0`), and the base lives in
Doppler, not in a committed file.

## The theme content is merged by the CLI, never copied

`registryUrl` is empty by default and is **not** written into `components.json`
at all. It exists to spell the install command out: with a URL configured the
rules carry `…/r/v<themeVersion>`; empty, they carry the Doppler lookup for the
same variable. Nothing points at a guessed host — baking in `ryzen:3012` would
look correct on exactly one machine — and nothing pretends to be a pin that the
CLI does not read.

The alternative — inlining the published token sheet into a template at
generation time — is the one thing this capability must not do: a token sheet
copied into a project is the drift problem wearing a capability's clothes. So
the scaffold emits the bare Tailwind entry and the project **builds and is
unstyled**, not broken, until someone runs:

```bash
# with ui-shadcn.registryUrl configured:
COMPONENTS_REGISTRY_URL=<registryUrl>/v<themeVersion> \
  npx shadcn-svelte@1.8.1 add theme --yes --overwrite

# with it empty — the same value, resolved from Doppler:
COMPONENTS_REGISTRY_URL="$(doppler secrets get COMPONENTS_REGISTRY_URL \
  --project common --config dev --plain)" \
  npx shadcn-svelte@1.8.1 add theme --yes --overwrite
```

Three parts of that command are load-bearing, each learned by running it:

- **`add theme`, not `add @nb/theme`.** There are no namespaces in this CLI.
- **`--overwrite`.** `add` asks a second question about overwriting existing CSS
  variables that `--yes` does not answer. Non-interactively it prints the
  question and **exits 0 having written nothing** — a success exit and no
  theme. `--yes` alone is not enough, and an agent that checks only the exit
  code records a success it did not get.
- **A pinned CLI.** `@latest` would make the install depend on the day it ran,
  and the flags and item shapes above were verified against `1.8.1`.

The merge also injects `@import "shadcn-svelte/tailwind.css";`, so
`shadcn-svelte` is emitted as a dependency: without it the project's next build
fails on a missing import. That dependency comes from the install path, not
from the registry item, so it is invisible in the item's own metadata.

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

## Blocks are opt-in, and pinned to the same version as the theme

`blocks` is an array of block names on the `ui-shadcn`
capability, defaulting to empty. Each name is validated against the nine the
registry publishes at the same version as the theme
(`NB_BLOCKS` in `file-generator.js`, mirrored by the catalog's `items.enum`):

| Block            | What it is                                                      |
| ---------------- | --------------------------------------------------------------- |
| `app-shell`      | sticky blurred top bar, wordmark, back pill, 68rem main, footer |
| `stat-strip`     | KPI row of label / big tabular value / sub-line                 |
| `result-list`    | ranked rows with a fold (`Show N more…`)                        |
| `filter-panel`   | facet card on desktop, chip row + bottom sheet on mobile        |
| `empty-state`    | cause-aware zero results (filters / query / error / empty)      |
| `status-view`    | status lanes as cards, count per lane, empty lane handled       |
| `detail-panel`   | record header, metadata grid, prose body, back button           |
| `burst-timeline` | interval bars plus a timestamp / event / value / explains table |
| `request-form`   | schema-driven form with per-constraint error notices            |

What a selected block produces is one line in
`.agents/.rules/styling_guidelines.md`, under a `## Blocks` heading:

```
COMPONENTS_REGISTRY_URL=<base>/v1.3.0 npx shadcn-svelte@1.8.1 add app-shell --yes --overwrite
```

Four properties of that line matter, and each has a test:

- **The base is the theme's base.** Blocks are published at the same version as
  the theme, so the version segment is the pin for both. `themeVersion` moved
  from `1.2.0` to `1.3.0` for exactly this reason: a project that installs
  blocks must not pin a version that does not publish them, or `add app-shell`
  404s at the end of a scaffold. The catalog default and
  `NB_THEME_DEFAULT_VERSION` are kept in lockstep by a test.
- **`--overwrite`, not `--yes`.** `add` asks a second question about overwriting
  existing CSS variables; non-interactively without the flag it prints the
  question and exits 0 having written nothing.
- **A block's install target is alias-relative.** The item says
  `nb/AppShell.svelte`, and the CLI resolves that against
  `aliases.components`, so it lands at `$lib/components/nb/AppShell.svelte`.
  The first published items said `src/lib/components/nb/AppShell.svelte` and
  installed themselves at
  `src/lib/components/src/lib/components/nb/AppShell.svelte` — found by running
  the consumer contract test, not by reading. The rules state the correct form.
- **Unknown names are dropped, and named.** A typo must not become an
  instruction to install a block that does not exist: nothing is emitted for
  it, and the rules list what was dropped. An empty or absent list emits no
  `## Blocks` section at all — a heading telling a project to install zero
  blocks is noise.

Nothing is installed at generation time, because the generator never runs
`npm` or `npx`. The capability writes instructions, and the e2e is what proves
those instructions work.

## What it does not do

- **No block content in the project at generation time.** Blocks are installed
  by the CLI from the registry, never emitted by the generator: same rule as
  the theme, for the same reason.
- **No generation-time registry fetch.** See above.
- **No preview output.** `preview-generator.js` reuses
  `generateViteConfigFile`, so a preview shows the Tailwind plugin, but the
  emitted-file list is produced by the generator, not the preview. Previews
  remain a subset until they converge on `generateAllFiles`.

## Tests

`tests/generator/ui-shadcn.test.js`:

- absent unless selected — no files, no Tailwind dependency, no Vite plugin;
- `components.json` has **no** `registries` key and no token literal, and the
  other keys the Svelte CLI reads are present (absence asserted, not assumed);
- the styling rules carry the exact contract-tested command: the pinned CLI,
  `--overwrite`, and `…/v<themeVersion>` after stripping a trailing slash; the
  version is the catalog default (a test keeps them in lockstep);
- an unset `registryUrl` yields the Doppler lookup in the rules and no guessed
  host; a set one prints the explicit base and drops the "empty at generation
  time" note;
- `shadcn-svelte` is emitted as a dependency of an `ui-shadcn` project;
- no `nb-theme.css` is emitted at any path, and `src/app.css` is exactly
  `@import "tailwindcss";` with no `nb-theme` reference — the file-and-import
  model is inverted, not merely absent;
- no emitted file carries a house token (`#0f172a`) — the no-template-copy rule
  is asserted, not merely intended;
- the manifest and Vite plugin are wired, and `resolveDependencies` pulls in
  `sveltekit` and `doppler`;
- a non-node frontend relocates the whole set under `web/` while the agent rules
  stay at the repository root;
- blocks: one pinned `add <name> --yes --overwrite` per requested block, at the
  same base as the theme; no `## Blocks` section when none were requested; an
  unknown name is dropped and named; with no `registryUrl` the block command
  resolves the base from Doppler too.

All 1029 tests pass; the coverage gate is unchanged.

## The end-to-end check

Unit tests cannot see the defects this capability actually shipped. Every one of
them appeared only when a _generated_ project was built and rendered: a
`components.json` the Svelte CLI ignores, an install command that prints success
and writes nothing, a dependency the merge injects but the project never
declared, no `tsconfig.json` while `components.json` says `typescript: true`,
and — the expensive one — nothing importing `src/app.css`, so the build was
green and every page was unstyled.

`scripts/verify-generated-ui-shadcn-e2e.mjs` therefore asserts the seam, and is
wired into `.buildkite/pipeline.yml` as the `generated_e2e` step:

- generates the fixture with `generateAllFiles()` and checks the _emitted
  shape_ (no `registries`, a style the Svelte CLI has, a self-contained
  tsconfig with the `$lib` alias, a layout that imports `../app.css`, a bare
  `src/app.css`, rules carrying the pinned `--overwrite` command);
- runs `npm install` (a generated project has no lockfile, so `npm ci` cannot);
- runs the pinned CLI **against the deployed registry**, with stdin closed and a
  timeout — the CLI blocks forever on its CSS-overwrite prompt if stdin is left
  open, and `--yes` alone answers a different question;
- builds, then asserts the _built bundle_ carries the theme tokens and rules;
- launches chromium and asserts a **computed style**: `body` renders `--bg` and
  the value equals the resolved token, `.card` renders a non-zero radius,
  `.pill.ok` renders its own colour. Transparent `--bg` means the token is
  defined and never applied.

`COMPONENTS_REGISTRY_URL` comes from Doppler (`common`), not the repository, so
the check consumes the same value a generated project documents. The render
check is on by default and must stay on in CI: it is the only assertion that
distinguishes "token present" from "token applied".
