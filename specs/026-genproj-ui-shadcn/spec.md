# 026 — `ui-shadcn`: a generated SvelteKit project starts on the house design system

**Status:** implemented (2026-11-14). Theme pin corrected to `1.1.0` after
`ui-registry` shipped the `src/nb-theme.css` target (2026-11-14). Design
rationale: `projects/genproj/genproj-ui-shadcn-capability.md`.

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
| `configurationSchema` | `registryUrl` (string, **empty** by default), `themeVersion` (string, `"1.1.0"`) |
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
| `src/app.css`                          | `@import "tailwindcss";` then `@import "./nb-theme.css";`                           |
| `src/nb-theme.css`                     | **a placeholder**, with no tokens, naming the command that replaces it              |
| `components.json`                      | the `@nb` registry block: `{name}.json` URL, bearer header, `params.version`        |
| `src/lib/utils.ts`                     | `cn()` over `clsx` + `tailwind-merge`                                               |
| `.agents/.rules/styling_guidelines.md` | the agent-facing rules (semantic tokens only, compose, pin)                         |

Two details in `components.json` are load-bearing:

- **`{name}.json` plus `params.version`** is the only shape the registry answers
  for an item (`/r/theme.json?version=1.1.0`). An unversioned request is a `400`
  by design, so a capability that omitted `params.version` would produce a
  project that cannot install anything.
- **`Bearer ${NB_REGISTRY_TOKEN}` is a literal.** `${VAR}` expansion is the
  CLI's job at `shadcn add` time; interpolating it here would put a live token
  in git.

## The theme content is installed, not copied

`registryUrl` is empty by default and the emitted URL is
`https://registry.invalid/r/{name}.json` — RFC 2606 reserves `.invalid`, so an
unconfigured project fails loudly at `shadcn add` instead of fetching from a
guess. Baking in `ryzen:3012` would look correct on exactly one machine.

The alternative — inlining the published token sheet into a template at
generation time — is the one thing this capability must not do: a token sheet
copied into a project is the drift problem wearing a capability's clothes. So
`src/nb-theme.css` is an honest placeholder. `src/app.css` imports it, which
means **`npm run build` succeeds and is unstyled**, not broken, until someone
runs:

```bash
npx shadcn-svelte@latest add @nb/theme
```

That is mechanism B from the design note (§5.1), and it is the only mechanism
the generator's architecture permits today. Mechanism A — fetch the immutable
item from the public repo pinned by commit SHA and inline `files[0].content`
into `src/nb-theme.css` — is the natural next increment, needs no Worker secret
and no public endpoint, and is not implemented here.

**The `target` question (§5.2) is closed.** The item targets
`src/nb-theme.css`, and the capability plus the styling rules both state the
explicit `@import "./nb-theme.css"` line, so the two agree.

That agreement is why the pinned version's `target` is load-bearing.
`ui-registry` published `@nb/theme` **v1.1.0** on 2026-11-14 with the only
change being `target: "src/nb-theme.css"` (v1.0.0 declared `src/app.css`,
which in a Tailwind v4 consumer collides with the `@import "tailwindcss"`
line). v1.0.0 is frozen and still serves `src/app.css`: registry items are
immutable, so it can never be corrected in place, and a fix ships only as a new
version. The capability therefore pins **1.1.0** by default — a default that
pinned 1.0.0 would install the tokens to a path nothing imports, and the
project would build, look unstyled, and give no hint why.

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
- `components.json` pins `1.1.0` (the catalog default, which a test keeps in
  lockstep with the generator), keeps the literal `${NB_REGISTRY_TOKEN}`, uses
  `{name}.json`, honours a configured URL (trailing slash stripped) and a
  version override;
- an unset `registryUrl` yields the `.invalid` placeholder **and** an explicit
  "the block is inert" statement in the styling rules; a set one removes it;
- `src/nb-theme.css` carries no house token (`--bg`, `#0f172a`) — the
  no-template-copy rule is asserted, not merely intended;
- the manifest and Vite plugin are wired, and `resolveDependencies` pulls in
  `sveltekit` and `doppler`;
- a non-node frontend relocates the whole set under `web/` while the agent rules
  stay at the repository root.

All 1027 tests pass; the coverage gate is unchanged.
