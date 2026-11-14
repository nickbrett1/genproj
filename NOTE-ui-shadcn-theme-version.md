# ui-shadcn: bump the default `themeVersion` pin to 1.1.0

Date: 2026-11-14
Scope: version-pin correction only. No generation-time registry fetch, no theme
CSS copied into a template (mechanism B, placeholder `src/nb-theme.css` stands).

## Why

`ui-registry` published `@nb/theme` **v1.1.0** today. The only delta from
v1.0.0 is the item's `target`:

| Version | `target`           |
| ------- | ------------------ |
| 1.0.0   | `src/app.css`      |
| 1.1.0   | `src/nb-theme.css` |

Items are immutable, so v1.0.0 keeps serving `src/app.css` forever; a fix can
only ship as a new version. In a Tailwind v4 consumer `src/app.css` holds the
project's own `@import "tailwindcss";`, so installing v1.0.0 there overwrites
it. v1.1.0 installs to `src/nb-theme.css`, which is exactly the path the
`ui-shadcn` capability's emitted `src/app.css` already imports
(`@import "./nb-theme.css";`).

Left at the old default, a generated project pins a version that writes tokens
to a path nothing imports: it builds, looks unstyled, and the cause is
invisible. The capability must pin the fixed version, not the frozen one.

## Changes

- [x] `src/catalog/catalog.json`: `ui-shadcn.themeVersion` default
      `"1.0.0"` -> `"1.1.0"`; description rewritten to explain that the default
      moves with the item's `target` (immutable item => a fix ships as a new
      version, and the capability pins the fixed one).
- [x] `src/generator/file-generator.js`: fallback default now comes from a named
      `NB_THEME_DEFAULT_VERSION = "1.1.0"` with the rationale, and the version
      example in the `params.version` comment says `1.1.0`.
- [x] `tests/generator/ui-shadcn.test.js`: expected pinned version -> `1.1.0`;
      new test asserts the emitted `params.version` equals the catalog default,
      that the default is `1.1.0`, and that the styling rules line names
      `` `@nb/theme` at `1.1.0` ``. This is the coupling that silently broke.
- [x] `specs/026-genproj-ui-shadcn/spec.md`: recorded default, the version
      example, the test list; §5.2 caveat rewritten as closed, with the
      immutability rationale for moving the pin.

No test was weakened. The one existing assertion changed is the literal
`{ version: "1.0.0" }` -> `{ version: "1.1.0" }`, which is the behaviour the
change deliberately alters.

## Verification

- `npx vitest run tests/generator/ui-shadcn.test.js` — 13/13 pass.
- `npm test` (full suite + coverage, templates rebuilt by `pretest`) — **71
  files, 1027 tests, all pass**; coverage 92.94% statements / 84.31% branches /
  93.46% functions / 93.3% lines, above the unchanged gate.
- `npm run lint` — 0 errors.
- Nothing fetches from the registry at generation time; `src/nb-theme.css`
  remains a token-free placeholder.
