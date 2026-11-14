# ui-shadcn: the theme is `cssVars` + `css`, not a file and an import

Date: 2026-11-14
Scope: remove the file-and-import model from the `ui-shadcn` capability. No
generation-time registry fetch, no theme CSS copied into a template — both
decisions stand. This aligns the scaffold with the shape `shadcn-svelte@1.8.1`
actually accepts.

## Findings

### The old model was unsupported by the CLI

`@nb/theme` v1.1.0 was published as a `registry:theme` item with
`files[].target = "src/nb-theme.css"`. `shadcn-svelte@1.8.1` has no install
path for a theme item's `files`: it resolves `files[].target` against the
**basename of the consumer's tailwind CSS file used as a directory**:

```js
os(config, "registry:theme") -> path.basename(config.resolvedPaths.tailwindCss) // "app.css"
path.resolve(that, file.target)                                                 // <cwd>/app.css/src/nb-theme.css
```

So `shadcn add @nb/theme` created a directory literally named `app.css`
containing a stylesheet nothing imported, and left `src/app.css` untouched.
A theme item's payload is `cssVars` and `css`; the CLI merges both into the
consumer's own stylesheet.

### What `ui-registry` publishes now

Checked against the local clone of `nickbrett1/ui-registry` at commit
`950168df803875de70506fbd7024e35e21195720` (`registry/versions/v1.2.0/theme.json`):

- `type: "registry:theme"`
- no `files` key at all
- `cssVars` has one key, `theme`, with **28** custom properties
  (`--bg: #0f172a`, …)
- `css` is an object keyed by selector — 41 entries including `:root`, the
  primitive element rules, `.card`, `.pill`, `.micro`, both media queries
- `color-scheme: dark` is carried in `css` because it is not a token

`v1.0.0` (`target: src/app.css`) and `v1.1.0` (`target: src/nb-theme.css`) are
immutable and still served, so pinning the version is what keeps a project's
look fixed.

Note: the live `ryzen:3012` registry in this environment still answers
`{"error":"not found","available":["1.0.0","1.1.0"]}` for `?version=1.2.0` —
the code is committed but not deployed there. The item shape above is from the
committed source, and the end-to-end CLI result is the user's observed
verification.

## Changes made

- [x] `src/catalog/catalog.json`: default `1.1.0` → `1.2.0`, description rewritten.
- [x] `src/generator/file-generator.js`: no `src/nb-theme.css`; `src/app.css` is only `@import "tailwindcss";`.
- [x] `tests/generator/ui-shadcn.test.js`: inverted assertions + "no nb-theme anywhere".
- [x] `specs/026-genproj-ui-shadcn/spec.md`: old mechanism corrected.
- [x] `NOTE-ui-shadcn-theme-version.md`: marked superseded.

## Verification

- `npx vitest run tests/generator/ui-shadcn.test.js` — 13/13 pass.
- `npm test -- --run` — **71 files, 1027 tests, all pass**; coverage 92.94%
  statements / 84.3% branches / 93.46% functions / 93.3% lines, above the
  unchanged gate.
- `npm run lint` — prettier clean, eslint 0 errors (656 pre-existing warnings).
- `NB_THEME_DEFAULT_VERSION` was not placeholder-only (it also feeds
  `components.json` `params.version`), so it was kept and bumped to `1.2.0`.
- No generation-time registry fetch; no token CSS in a template.
