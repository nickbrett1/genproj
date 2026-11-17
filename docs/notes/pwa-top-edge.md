# iOS home-screen "glass strip" fix in the SvelteKit scaffold

Date: 2026-11-17
Capability: `sveltekit` (category `frameworks`) — **not** `docker-container`.

## Symptom

Adding a generated SvelteKit app to an iPhone home screen paints a blurred/glass
strip across the top of the page, over the app's own header. Nothing in the
shipped CSS blurs anything: it is the iOS compositor painting its edge surface
over the pixels the web view was invited to draw in.

The invitation comes from two metas that people add together when they want an
edge-to-edge PWA:

- `apple-mobile-web-app-status-bar-style: black-translucent` (transparent
  status bar → web view draws _under_ it)
- `viewport-fit=cover` (the page claims the whole screen including unsafe area)

Combined, the status-bar band belongs to the page, and iOS composites glass over
it. The fix: ask for an **opaque** status bar (`black`), do not claim `cover`,
and additionally paint our own surface in that band for engines that still
report a non-zero `env(safe-area-inset-top)` in standalone mode.

## What changed

| File                                               | Change                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/generator/templates/svelte-app-html.template` | The emitted `src/app.html` now has `apple-mobile-web-app-status-bar-style: black`, `apple-mobile-web-app-title`, `viewport` with `initial-scale=1` and **no** `viewport-fit=cover`, an inline `<style>` defining `.pwa-status-bar-surface` (before `%sveltekit.head%`), and the surface `<div>` as the first child of `<body>`. |
| `src/generator/templates.generated.js`             | Regenerated via `npm run build:templates` (committed build artefact — do not hand-edit).                                                                                                                                                                                                                                        |
| `src/generator/file-generator.js`                  | New exported builder `buildSveltekitAppHtmlTest()`, emitted as `tests/app-html.test.js` alongside the existing `tests/smoke.test.js` (same guard: `devcontainer-node` + `sveltekit`; relocated to `web/tests/` with the rest of the frontend for non-node primaries).                                                           |
| `tests/generator/file-generator-sveltekit.test.js` | Repo-level tests pinning the app.html head shape and the emitted test file, plus relocation to `web/tests/app-html.test.js`.                                                                                                                                                                                                    |

Detail decisions, all forced by the brief:

- **No `docker-container` change.** It owns Dockerfile/compose/healthcheck and
  never sees `app.html`; this is a document-head problem.
- **`background-clip: text` kept** inside the `@supports` guard: it is the
  feature-detect that keeps the element inert on engines that do not composite
  the edge, not decoration. `-webkit-background-clip: text` is emitted too, as
  the prefixed form iOS actually reads.
- **`background-color: inherit`**, no hex, and `theme-color` untouched — the
  scaffold stays house-agnostic and the @nb theme supplies the colour.
- **The `<style>` is inline and precedes `%sveltekit.head%`**, so the band is
  painted before any stylesheet `<link>` is injected (otherwise it flashes).
- **The CSS is formatted Prettier-style** (one declaration per line) rather than
  the compact form in the brief. The generated project runs
  `prettier --check .` in CI, so the emitted HTML/CSS must already be
  Prettier-clean; the declaration set is identical.

### Note on one line of the brief

The brief says the surface `<div>` must come before `%sveltekit.head%` in source
order. That is not possible in an HTML document: `%sveltekit.head%` is inside
`<head>` and the div is `<body>`'s first child. The _assertion_ the brief asks
for, `indexOf("pwa-status-bar-surface") < indexOf("%sveltekit.head%")`, is
satisfied by the inline style block's selector — which is the ordering that
actually matters (the style paints before any stylesheet). Implemented exactly
as the assertion is written; the div sits first in `<body>` per the snippet.

## The generated test (`tests/app-html.test.js` in a generated project)

Lives in the generated project's own vitest suite — the scaffold already ships
one (`tests/smoke.test.js`, jsdom + `svelteTesting()` in `vite.config.js`), so no
new runner or placement decision was needed. It reads `src/app.html` as text and
asserts:

1. `<meta name="viewport">` exists and its `content` attribute does not contain
   `cover` — parsed with a small attribute reader, because the explanatory
   comment in `app.html` names `viewport-fit=cover` and a whole-file grep would
   fail against the fix itself;
2. `apple-mobile-web-app-status-bar-style` is `black`;
3. `class="pwa-status-bar-surface"` exists, the style block contains
   `background-clip: text`, and
   `indexOf("pwa-status-bar-surface") < indexOf("%sveltekit.head%")`.

## How it was verified

1. `npm run build:templates` — regenerates `templates.generated.js`.
2. Generated a throwaway project (`generateAllFiles` with
   `["devcontainer-node","sveltekit"]`) and inspected `src/app.html` and
   `tests/app-html.test.js` — content matches the brief.
3. Ran the _generated_ test against the _generated_ `app.html` in a scratch dir
   with the repo's vitest: **3 passed**.
4. Negative control: edited the scratch `app.html` to
   `viewport-fit=cover` + `black-translucent`; the viewport and status-bar
   assertions **failed** as intended (the ordering assertion still passed, which
   is correct — the two failures are independent). File restored afterwards.
5. `npx prettier --check` on the generated `src/app.html`,
   `tests/app-html.test.js` and `tests/smoke.test.js`: clean (so the generated
   project's CI lint stays green).
6. `npx vitest run` on genproj: **71 files / 1039 tests pass**. Includes two new
   repo-level tests in `tests/generator/file-generator-sveltekit.test.js`.
7. `npx eslint` on the changed files: 0 errors. One new `sonarjs/no-duplicate-
string` **warning** in the test file (the `["devcontainer-rust",
"devcontainer-node", "sveltekit"]` literal now appears three times there);
   warnings do not fail the repo lint and the file already carries six of them.

## Deliberately not done

- No change to `docker-container`, its Dockerfile, compose, healthcheck or
  watchtower tests.
- No `theme-color` meta introduced or modified.
- No hardcoded band colour; the surface inherits the page ground colour.
- No browser/e2e verification on a real iPhone from here — the test pins the
  _document shape_, not the compositor behaviour, which is the only thing
  testable off-device.
- Nothing added to the vanilla `svelte` capability: the strip is an iOS
  home-screen problem for the SvelteKit `app.html` shell; plain Vite Svelte has
  its own `index.html` and was out of scope.
