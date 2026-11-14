# 029 — The theme pin and the block list are derived, not restated

## Context

`ui-shadcn` has two facts that are decided in `src/catalog/catalog.json`: the
`themeVersion` default (which registry version a generated project pins) and the
`blocks` enum (which house blocks a project may install). The generator held a
private copy of both:

```js
export const NB_THEME_DEFAULT_VERSION = "1.11.0";
export const NB_BLOCKS = [ "app-shell", "stat-strip", … ];
```

A test asserted the two stayed in step ("lockstep, by a test, not by memory"),
and that test passed while the copies drifted in a way it could not see: it
compared the version, not the list.

The version copy was moved by hand three times in one day — 1.10.1, then 1.11.0 (the `embedded` release), then the Doppler change (028) touched the same block — and each move was
a two-line edit in two files that agreed only because someone remembered. The
block list was worse: a block added to the registry and the catalog but not to
the copy was silently **dropped** from a project's styling rules, because
`requestedBlocks.filter((n) => NB_BLOCKS.includes(n))` treats an unknown name as
a typo rather than as a gap. That is the defect class this spec closes: a list
or value in the generator that stops matching the catalogue.

## The change

`file-generator.js` already imports the catalog module
(`import { capabilities } from "../catalog/index.js"`, used by the capability
resolution path). Both constants are now read from that same array at module
load:

```js
const uiShadcnCatalogEntry = capabilities.find((c) => c.id === "ui-shadcn");
const uiShadcnConfig = uiShadcnCatalogEntry.configurationSchema.properties;

export const NB_THEME_DEFAULT_VERSION = uiShadcnConfig.themeVersion.default;
export const NB_BLOCKS = Object.freeze(uiShadcnConfig.blocks.items.enum);
```

`NB_BLOCKS` is the catalog's own array, not a copy — hence the freeze: a caller
that `push`ed to it would edit the catalog for every later consumer in the
process. The names and their export shape are unchanged, so the two existing
consumers (`file-generator` itself and
`scripts/verify-generated-ui-shadcn-e2e.mjs`) needed no edit.

The prose that justified the old value moved with the value: the shape history
(1.2.0 as the first `cssVars` + `css` theme item, 1.1.0's `target` resolving
against a directory named `app.css`) now lives in the catalog on the
`themeVersion` description, where it is read by whoever changes the default.

## The test states the derivation

The lockstep assertion is gone. In its place, `tests/generator/ui-shadcn.test.js`
asserts the derivation itself:

| Assertion                                                             | What it rules out                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `expect(NB_BLOCKS).toBe(properties.blocks.items.enum)`                | a copy that happens to match today (identity, not equality)              |
| no `NB_THEME_DEFAULT_VERSION = "<literal>"` in the source             | a version restated in the generator                                      |
| the rendered rules carry `/v<themeVersion.default>`                   | a default nobody can install, reaching a scaffold as a command that 404s |
| the rendered rules carry `add <NB_BLOCKS[0]>` and no "does not exist" | a whitelist that rejects what the multi-select offers                    |

A string has no identity to assert, so the version's derivation is stated by the
absence of a literal assignment rather than by equality — an equality test is
exactly the assertion that passed while the list drifted.

`tests/generator/preview-generator.test.js` mocks the catalog module, so its
fixture now carries a `ui-shadcn` entry: the generator dereferences that entry at
module load, and a mock that omits it fails with
`Cannot read properties of undefined (reading 'configurationSchema')`. That is
the cost of reading the catalog eagerly, and it is paid in a fixture rather than
in a defensive fallback that would hide a genuinely missing capability.

## Bumping a version, after this

One edit: `catalog.json`'s `ui-shadcn.themeVersion.default`. The generator, the
styling rules, the e2e harness and the multi-select all move together, because
they all read the same field. What still has to happen by hand is outside
genproj: publishing the version to `ui-registry` and re-vendoring the blocks a
consumer has already copied.
