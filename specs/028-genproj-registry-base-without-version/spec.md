# Spec 028 — the registry base is a host, not a pin

**Status:** implemented 2026-11-14.

## The defect

`COMPONENTS_REGISTRY_URL` (Doppler `common`, `dev`/`stg`/`prd`) held
`http://ryzen:3012/r/v1.11.0` — **the version inside the environment
variable**. genproj had two paths for the same base:

| `ui-shadcn.registryUrl`     | what genproj emitted           | where the version came from  |
| --------------------------- | ------------------------------ | ---------------------------- |
| set (`http://ryzen:3012/r`) | `${base}/v${themeVersion}`     | the catalog's `themeVersion` |
| empty                       | the Doppler value **verbatim** | the environment variable     |

The second path existed because `shadcn-svelte@1.8.1` appends nothing to the base
it is handed (measured in 026: `COMPONENTS_REGISTRY_URL` is used verbatim, only
the `components.json` fallback inserts `/styles/<style>/`). So the version _had_
to be in the secret for that path to work — and the estate then named the same
version in four places: the published index, the Doppler secret,
`NB_THEME_DEFAULT_VERSION`, and the catalog default.

Two of those four were held in step by a test. The Doppler copy was moved by
hand — `v1.8.0 → v1.10.0 → v1.10.1 → v1.11.0`, three times in one day. A
duplicated value that only a human keeps in sync is a value that is wrong
eventually.

## What changed

**The secret is the host**: `COMPONENTS_REGISTRY_URL=http://ryzen:3012/r`.
genproj appends the pin on **both** paths:

```bash
COMPONENTS_REGISTRY_URL="$(doppler secrets get COMPONENTS_REGISTRY_URL \
  --project common --config dev --plain)/v1.11.0" \
  npx shadcn-svelte@1.8.1 add theme --yes --overwrite
```

The composition is visible in the command rather than hidden inside a secret: a
command substitution followed by a literal. Every use site now wraps the base in
double quotes (it may contain a substitution), so the configured case simply
gains harmless quotes: `COMPONENTS_REGISTRY_URL="http://ryzen:3012/r/v1.11.0"`.

`themeVersion` is now the only place a generated project names a version.

## Why the pin is not simply "latest"

The registry endpoint already answers this: an unpinned item read returns
`400 {"error":"version required","available":[...]}`. Install-time float is
rejected on purpose, for reasons that are specific to this registry:

- **The client cannot ask for a version.** Query parameters do not survive its
  URL building, so the base _is_ the pin. A versionless base would not mean "the
  client requests latest" — it would mean the _server_ decides which frozen bytes
  an unchanged project installs.
- **Immutability is the product.** Reads are digest-checked against
  `registry/versions/manifest.json` precisely so a design system cannot change
  under a live project. A floating base re-opens that at the one layer that can
  still move.
- **"Latest" is not even well-defined here.** Four times on 2026-11-14 a version
  existed while being a half-published index (1.9.0, 1.10.0, 1.10.1, 1.11.0 —
  each published as one item). A latest-consuming estate would auto-install that
  window into every new project _during the release_. Add deploy lag (the index
  went `not found` → `1 item` → `12 items` over ~45 s) and "latest" is an
  eventually-consistent pointer to a partially-published catalogue.
- **A look is not a patch.** 1.10.0 added a tab row and page-intro rules; 1.11.0
  drops the footer inside a card. Those must be opt-in.

Discovery is the one consumer that wants "latest", and it has its own endpoint:
`/r/registry.json`, versionless, alongside the gallery.

## Verification

- `tests/generator/ui-shadcn.test.js` — the Doppler path asserts the pin is
  appended _outside_ the substitution, and a shape test asserts **no**
  `$(doppler …)` in the generated rules is followed by a version inside it, so
  restoring a versioned secret cannot pass silently (it would produce
  `/v1.11.0/v1.11.0`, a 404 on the first install rather than a silent drift).
- 1037 tests pass; `prettier --check` clean.
- Buildkite `generated_e2e` runs the emitted command against the real Doppler
  value and reads a computed style, so the composed base is exercised on every
  push — that step is why the two halves cannot disagree again.

## Blast radius

The deployed genproj and the Doppler value have to change together, in that
order (secret first): the old deployed code uses the value verbatim, so between
the two edits a freshly generated project's rules name a versionless base. The
window is one deploy (minutes) and affects documentation in new projects only.
