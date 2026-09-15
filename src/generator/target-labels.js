// src/generator/target-labels.js

/**
 * The release target vocabulary — Rust triples, and the only vocabulary.
 *
 * These are the toolchain's own names. A target is handed to `cargo --target`
 * verbatim, and the same string is the manifest key, the pipeline step, the
 * artifact path and the launcher's lookup, so no reader translates between two
 * spellings of one idea.
 *
 * The vocabulary is deliberately **one Linux libc, and it is musl**. Rust
 * triples are the natural spelling for that because musl and glibc are distinct,
 * non-interchangeable binaries sharing one `uname` — a `linux-x64` label would
 * let a glibc artifact be fetched by a musl host, pass its sha256 check because
 * the file is intact, and fail at exec. Musl is the half worth keeping: it is
 * the libc that can be linked statically, so one artifact runs on Alpine, on a
 * Debian host and on the NAS alike. `-gnu` is therefore not offered at all
 * rather than offered as a second choice — a target list that can publish both
 * is a target list where picking wrong is possible, and the caller here owns
 * every host it deploys to.
 *
 * This module is the single source of truth for two consumers that must agree
 * byte-for-byte:
 *
 *   1. the pipeline, which builds one artifact per target label, and
 *   2. the launcher, which looks its label up in the release manifest.
 *
 * The launcher must never *construct* a label from `uname` (that concatenation
 * is where producer/consumer drift would live) — it imports the candidate list
 * below and picks the first entry the manifest actually contains. Both sides
 * importing this table is the whole guarantee.
 */

/** Every label a release may publish. One vocabulary, no short forms. */
export const TARGET_LABELS = Object.freeze([
  "aarch64-apple-darwin",
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-musl",
]);

/**
 * A human name for each label, for the one audience a triple is wrong for: a
 * person choosing targets in a form. `aarch64-apple-darwin` is the correct
 * identifier and stays the value; this is only what a UI prints beside it.
 *
 * Kept beside {@link TARGET_LABELS} rather than in the client because the
 * vocabulary is the thing being named: a client that hardcoded these strings
 * would need editing the day a target is added, which is the drift the shared
 * table exists to prevent. The catalog publishes this map, so the client
 * renders whatever it is given.
 *
 * The triple is not replaced by the name anywhere - a release target is a
 * build input, and "Linux x86-64 (musl)" is not a value any toolchain accepts.
 * The libc qualifier stays in the name because it is part of what the artifact
 * is, and a name that dropped it would be the one thing that had to change the
 * day a second libc appears.
 */
export const TARGET_DISPLAY_NAMES = Object.freeze({
  "aarch64-apple-darwin": "macOS (Apple silicon)",
  "x86_64-unknown-linux-musl": "Linux x86-64 (musl)",
  "aarch64-unknown-linux-musl": "Linux arm64 (musl)",
});

/**
 * The universal target key: an artifact that is not architecture-specific (a
 * Node bundle, a pure-python `.pyz`) publishes under this key rather than
 * claiming a triple. It is appended as the **last** candidate in
 * {@link targetCandidates}, so a launcher resolves it through the same
 * lookup-and-intersect path as any other key — there is no special case for
 * `any` in the consumer.
 */
export const UNIVERSAL_TARGET = "any";

/**
 * Maps `uname -s` / `uname -m` to the labels a host may be running, in
 * preference order (first present in the manifest wins).
 *
 * One entry per host, because there is now nothing for `uname` to be confused
 * about: the fleet publishes one libc, so `Linux`/`x86_64` has exactly one
 * possible label. The list survives as a list because of `{@link
 * UNIVERSAL_TARGET}`, which is appended to every host's candidates — a host
 * prefers a real triple for itself and falls back to an architecture-independent
 * payload, through one lookup rather than a special case.
 *
 * `Darwin`/`x86_64` has no entry: it is not a fleet target and no queue can
 * produce it (the fleet has no Intel Mac runner), so no producer can ever
 * publish `x86_64-apple-darwin`. An Intel Mac therefore resolves a universal
 * payload through the `any` fallback and never an arm64 binary, which it
 * could not run.
 *
 * Exported because the launcher is a shell script: {@link getFetchLaunchTemplateData}
 * renders this table into its `case` statement rather than restating it, so the
 * launcher and the pipeline read the same table in the only way a shell script
 * can.
 */
export const UNAME_CANDIDATES = Object.freeze({
  Darwin: Object.freeze({
    arm64: Object.freeze(["aarch64-apple-darwin"]),
  }),
  Linux: Object.freeze({
    x86_64: Object.freeze(["x86_64-unknown-linux-musl"]),
    aarch64: Object.freeze(["aarch64-unknown-linux-musl"]),
  }),
});

/**
 * The candidate target labels for a host, most-preferred first. Pure: the
 * caller supplies what `uname` would report, so this is testable without a
 * project, a manifest or a machine.
 *
 * @param {string} unameS - `uname -s` (e.g. "Darwin", "Linux")
 * @param {string} unameM - `uname -m` (e.g. "arm64", "x86_64", "aarch64")
 * @returns {string[]} Candidate labels, or [] for a host we have no label for
 */
export function targetCandidates(unameS, unameM) {
  // The universal key is the last candidate: prefer a real triple for this
  // host, fall back to the architecture-independent payload, and only then
  // fail open. Same lookup, no special case.
  // eslint-disable-next-line security/detect-object-injection
  const host = UNAME_CANDIDATES[unameS]?.[unameM] ?? [];
  return [...host, UNIVERSAL_TARGET];
}

/**
 * The label a launcher running on this host should use, given the labels the
 * manifest actually published: the first candidate present in `available`.
 *
 * The launcher never synthesises a label; it intersects its candidate list
 * with the manifest's keys. Returns `undefined` when nothing matches — which
 * is a log-and-exec-`current` condition (fail-open), never a hard failure.
 *
 * @param {string} unameS - `uname -s`
 * @param {string} unameM - `uname -m`
 * @param {Iterable<string>} available - Labels present in the manifest
 * @returns {string | undefined} The matching label, if any
 */
export function selectTarget(unameS, unameM, available) {
  const present = new Set(available);
  return targetCandidates(unameS, unameM).find((label) => present.has(label));
}
