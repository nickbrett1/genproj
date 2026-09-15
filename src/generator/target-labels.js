// src/generator/target-labels.js

/**
 * The release target vocabulary — Rust triples, and the only vocabulary.
 *
 * A `mac-arm64`-style short label cannot express musl vs glibc:
 * `x86_64-unknown-linux-musl` and `x86_64-unknown-linux-gnu` are distinct,
 * non-interchangeable binaries that share one `uname`. Collapsing both to
 * `linux-x64` publishes a glibc-linked artifact under a label a musl target
 * will happily download — and the sha256 check passes, because the file is
 * intact and simply the wrong file. So the labels are triples and nothing else.
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
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-musl",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-musl",
  "aarch64-unknown-linux-gnu",
]);

/**
 * Maps `uname -s` / `uname -m` to the labels a host may be running, in
 * preference order (first present in the manifest wins).
 *
 * The value is a *candidate list*, not a single label, because `uname` cannot
 * see libc: it reports `Linux`/`x86_64` for both a musl and a glibc host. The
 * launcher is not entitled to guess which one it is, so it asks the manifest
 * which of the plausible labels the producer actually published. Musl is
 * ordered first because it is the portable choice; a host that must link
 * against glibc's DSM publishes and resolves the `-gnu` label.
 *
 * `Darwin`/`x86_64` is listed for completeness only: it is not a fleet target
 * and no queue produces it (there is no Intel Mac runner).
 */
const UNAME_CANDIDATES = Object.freeze({
  Darwin: Object.freeze({
    arm64: Object.freeze(["aarch64-apple-darwin"]),
    x86_64: Object.freeze(["x86_64-apple-darwin"]),
  }),
  Linux: Object.freeze({
    x86_64: Object.freeze([
      "x86_64-unknown-linux-musl",
      "x86_64-unknown-linux-gnu",
    ]),
    aarch64: Object.freeze([
      "aarch64-unknown-linux-musl",
      "aarch64-unknown-linux-gnu",
    ]),
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
  // eslint-disable-next-line security/detect-object-injection
  return UNAME_CANDIDATES[unameS]?.[unameM] ?? [];
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
