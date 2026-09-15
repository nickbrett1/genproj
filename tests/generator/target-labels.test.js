// tests/generator/target-labels.test.js

import { describe, expect, it } from "vitest";

import { getCapabilityById } from "../../src/catalog/index.js";
import {
  TARGET_LABELS,
  selectTarget,
  targetCandidates,
} from "../../src/generator/target-labels.js";

describe("target label vocabulary", () => {
  it("is Rust triples only — no short labels", () => {
    // A short label cannot express musl vs glibc, so every label must carry a
    // full arch-vendor-os(-env) triple. This is the property that matters, not
    // the exact membership.
    for (const label of TARGET_LABELS) {
      expect(label.split("-").length).toBeGreaterThanOrEqual(3);
      expect(label).toMatch(/^(aarch64|x86_64)-/);
    }
    expect(TARGET_LABELS).toContain("x86_64-unknown-linux-musl");
    expect(TARGET_LABELS).toContain("x86_64-unknown-linux-gnu");
    expect(TARGET_LABELS).toContain("aarch64-apple-darwin");
  });

  it("is the same table the catalog publishes (one source, two consumers)", () => {
    // The pipeline's matrix and the launcher's lookup must consume the same
    // label set. A literal copy that drifts is a silent 404; this asserts the
    // catalog's enum and the module's constant cannot diverge.
    const githubRelease = getCapabilityById("github-release");
    expect(
      githubRelease.configurationSchema.properties.targets.items.enum,
    ).toEqual([...TARGET_LABELS]);
  });
});

describe("uname -> candidate labels", () => {
  it("maps a fleet Linux/x86_64 host musl-first", () => {
    expect(targetCandidates("Linux", "x86_64")).toEqual([
      "x86_64-unknown-linux-musl",
      "x86_64-unknown-linux-gnu",
    ]);
  });

  it("maps a fleet Linux/arm64 host musl-first", () => {
    expect(targetCandidates("Linux", "aarch64")).toEqual([
      "aarch64-unknown-linux-musl",
      "aarch64-unknown-linux-gnu",
    ]);
  });

  it("maps Apple silicon", () => {
    expect(targetCandidates("Darwin", "arm64")).toEqual([
      "aarch64-apple-darwin",
    ]);
  });

  it("returns nothing for an unknown host", () => {
    expect(targetCandidates("FreeBSD", "riscv64")).toEqual([]);
  });
});

describe("manifest lookup (never string construction)", () => {
  it("selects the first candidate the manifest contains", () => {
    // A glibc-only release on a Linux/x86_64 host resolves the -gnu key
    // instead of 404ing; musl is preferred only when both are published.
    expect(selectTarget("Linux", "x86_64", ["x86_64-unknown-linux-gnu"])).toBe(
      "x86_64-unknown-linux-gnu",
    );
    expect(
      selectTarget("Linux", "x86_64", [
        "x86_64-unknown-linux-musl",
        "x86_64-unknown-linux-gnu",
      ]),
    ).toBe("x86_64-unknown-linux-musl");
  });

  it("returns undefined for a host the release does not publish", () => {
    // Fail-open: the launcher logs and execs `current`, it does not fail.
    expect(selectTarget("Linux", "aarch64", [])).toBeUndefined();
    expect(
      selectTarget("Darwin", "arm64", ["x86_64-unknown-linux-musl"]),
    ).toBeUndefined();
  });
});
