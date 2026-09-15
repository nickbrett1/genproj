// tests/generator/target-labels.test.js

import { describe, expect, it } from "vitest";

import { getCapabilityById } from "../../src/catalog/index.js";
import {
  TARGET_LABELS,
  UNIVERSAL_TARGET,
  selectTarget,
  targetCandidates,
} from "../../src/generator/target-labels.js";
import { getCapabilityTemplateData } from "../../src/generator/capability-template-utils.js";

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

  it("is the universal key the release template publishes under", () => {
    const data = getCapabilityTemplateData("github-release", {
      capabilities: [],
      configuration: {},
    });
    expect(data.githubReleaseUniversalTarget).toBe(UNIVERSAL_TARGET);
    expect(UNIVERSAL_TARGET).toBe("any");
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

  it("publishes a human name for every label, for the form that offers them", () => {
    const githubRelease = getCapabilityById("github-release");
    const items = githubRelease.configurationSchema.properties.targets.items;
    const names = items.enumLabels;

    // Keyed by the label, so a label cannot be offered without a name and a
    // name cannot outlive its label.
    expect(Object.keys(names)).toEqual([...TARGET_LABELS]);
    for (const name of Object.values(names)) {
      expect(name).toMatch(/^(macOS|Linux) /);
      // A name that contained a triple would just be the label again.
      expect(name).not.toMatch(/-unknown-|-apple-|x86_64|aarch64|-gnu/);
    }
    expect(names["x86_64-unknown-linux-musl"]).not.toBe(
      names["x86_64-unknown-linux-gnu"],
    );
  });

  it("does not offer a target the fleet cannot build", () => {
    // An Intel Mac target was offered and removed: no queue in the fleet has an
    // Intel Mac agent, so `x86_64-apple-darwin` can never be produced and
    // offering it only promised an artifact no release could contain.
    expect(TARGET_LABELS).not.toContain("x86_64-apple-darwin");
    expect(TARGET_LABELS).toHaveLength(5);
  });
});

describe("uname -> candidate labels", () => {
  it("maps a fleet Linux/x86_64 host musl-first", () => {
    expect(targetCandidates("Linux", "x86_64")).toEqual([
      "x86_64-unknown-linux-musl",
      "x86_64-unknown-linux-gnu",
      "any",
    ]);
  });

  it("maps a fleet Linux/arm64 host musl-first", () => {
    expect(targetCandidates("Linux", "aarch64")).toEqual([
      "aarch64-unknown-linux-musl",
      "aarch64-unknown-linux-gnu",
      "any",
    ]);
  });

  it("maps Apple silicon", () => {
    expect(targetCandidates("Darwin", "arm64")).toEqual([
      "aarch64-apple-darwin",
      "any",
    ]);
  });

  it("returns the universal key for an unknown host", () => {
    // A host we have no triple for still resolves an architecture-independent
    // payload; it is the same lookup, not a special case.
    expect(targetCandidates("FreeBSD", "riscv64")).toEqual(["any"]);
  });

  it("resolves an Intel Mac to a universal payload only", () => {
    // Not a fleet target, so there is no Intel-native candidate to try; and it
    // must never fall through to the arm64 label, which it cannot execute.
    expect(targetCandidates("Darwin", "x86_64")).toEqual(["any"]);
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
  });

  it("falls back to the universal key", () => {
    // A pure-JS/python payload publishes under `any`; every host resolves it
    // through the same candidate list, with no consumer-side special case.
    expect(selectTarget("Linux", "aarch64", ["any"])).toBe("any");
    expect(
      selectTarget("Darwin", "arm64", ["x86_64-unknown-linux-musl"]),
    ).toBeUndefined();
  });
});
