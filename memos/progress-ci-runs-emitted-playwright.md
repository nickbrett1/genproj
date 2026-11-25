# Progress: CI runs the emitted Playwright suite

Branch: `feat/ci-runs-emitted-playwright` (off `main` @ eb988b5). Not merged.

## Facts reported

- Catalog: `playwright` has `provides: []`; it is the 36th entry (1-based) of 37
  in `src/catalog/catalog.json`'s `capabilities` array. It carries no numeric
  id/order field of its own; only its array position and its category
  (`monitoring`, category order 110).
- Generated manifest for `[devcontainer-node, sveltekit, playwright]` gains
  `"test:e2e": "playwright test"` and `"@playwright/test": "^1.56.0"` (verified
  by generating the project and printing package.json).

## Implemented

- `scripts/verify-generated-playwright-e2e.mjs`: generate → assert shape →
  install → install/locate the project-matched Chromium → launch it with
  `--remote-debugging-port` → `npm run dev` (not preview) on 4173 → `npm run
test:e2e` with PLAYWRIGHT_CDP_URL + CI=1 → assert `shared-cdp` → assert the
  Chromium is STILL ALIVE → always kill dev server + chromium + temp dir.
  Honest limit documented: does not prove Chrome 158 compatibility.
- `.buildkite/pipeline.yml`: separate `generated_playwright_e2e` step,
  depends_on `[build]` only; deploy unchanged; 25 min; node:22-bookworm arm64.
- `tests/generator/verify-generated-playwright-e2e-script.test.js`: 9 text-pin
  invariants.

## Real run result: SUSITE IS BROKEN AS MERGED (no template fix made)

1. `playwright.config.js` does not parse. Its block comment line 10 contains
   `` `**/*.{test,spec}...` ``; the `*/` inside `**/` closes the comment early,
   so Playwright reports `SyntaxError ... Unexpected token (10:10)`.
2. After manually patching only the temp copy's comment, the smoke test fails:
   `expect(page).toHaveTitle(/.+/)` — the SvelteKit `src/app.html` template
   emits no `<title>`, so the title is "". (Plain `svelte` has a title; only
   sveltekit is affected.)
3. With BOTH manually patched in a throwaway temp copy (never in the repo), the
   suite passes via `shared-cdp (http://127.0.0.1:<port>)` and the launched
   Chromium survives — so the CDP tier and the no-close behaviour are sound;
   the two text defects above are what block it.

## Gates

- `npm test`: 74 files / 1062 tests passed (exit 0).
- `npx prettier --check .`: clean.
- `npx eslint .`: 0 errors.
- `npm run build:templates` twice: 99 templates, sha256 identical (zero diff).
