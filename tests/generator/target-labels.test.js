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
    // Every label must carry a full arch-vendor-os(-env) triple: it is what
    // `cargo --target` takes, and it is the manifest key. This is the property
    // that matters, not the exact membership.
    for (const label of TARGET_LABELS) {
      expect(label.split("-").length).toBeGreaterThanOrEqual(3);
      expect(label).toMatch(/^(aarch64|x86_64)-/);
    }
    expect(TARGET_LABELS).toContain("x86_64-unknown-linux-musl");
    expect(TARGET_LABELS).toContain("aarch64-unknown-linux-musl");
    expect(TARGET_LABELS).toContain("aarch64-apple-darwin");
  });

  it("offers one Linux libc, and it is musl", () => {
    // Musl is pinned rather than preferred. It is the libc that can be linked
    // statically, so one artifact runs on a musl host and a glibc host alike;
    // a `-gnu` label would be a second, non-interchangeable binary for the
    // same `uname`, and picking the wrong one fails at exec rather than at
    // download, because the file is intact.
    const linux = TARGET_LABELS.filter((label) => label.includes("linux"));
    expect(linux).toHaveLength(2);
    for (const label of linux) {
      expect(label).toMatch(/-musl$/);
    }
    expect(TARGET_LABELS.some((label) => label.endsWith("-gnu"))).toBe(false);
  });

  it("is the universal key the release template publishes under", () => {
    const data = getCapabilityTemplateData("github-release", {
      capabilities: [],
      configuration: {},
    });
    expect(data.githubReleaseUniversalTarget).toBe(UNIVERSAL_TARGET);
    expect(UNIVERSAL_TARGET).toBe("any");
    // With no declared label the single payload is packed under the universal
    // key, so the default is unchanged from before the field existed.
    expect(data.githubReleaseDistTarget).toBe(UNIVERSAL_TARGET);
  });

  it("packs the single payload under the declared label when there is one", () => {
    const data = getCapabilityTemplateData("github-release", {
      capabilities: [],
      configuration: { "github-release": { target: "aarch64-apple-darwin" } },
    });
    expect(data.githubReleaseDistTarget).toBe("aarch64-apple-darwin");
  });

  it("is the same table the catalog publishes (one source, two consumers)", () => {
    // The pipeline's matrix and the launcher's lookup must consume the same
    // label set. A literal copy that drifts is a silent 404; this asserts the
    // catalog's enum and the module's constant cannot diverge.
    const githubRelease = getCapabilityById("github-release");
    const properties = githubRelease.configurationSchema.properties;
    expect(properties.targets.items.enum).toEqual([...TARGET_LABELS]);
    // The singular label offers the same vocabulary, and must not invent one.
    expect(properties.target.enum).toEqual([...TARGET_LABELS]);
  });

  it("shows exactly one label control, chosen by the primary language", () => {
    // The form is schema-driven and has no conditional vocabulary of its own, so
    // the split lives here: a rust project declares a matrix (Targets), every
    // other language declares one artifact's label (Target). A rust user never
    // sees a singular control to ignore, and vice versa.
    const properties =
      getCapabilityById("github-release").configurationSchema.properties;
    expect(properties.targets.visibleWhen).toEqual({ language: ["rust"] });
    // `not` rather than an enumeration, so a language added later gets the
    // singular control instead of silently losing both.
    expect(properties.target.visibleWhen).toEqual({
      language: { not: ["rust"] },
    });
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
    expect(names["x86_64-unknown-linux-musl"]).toBe("Linux x86-64 (musl)");
    expect(names["aarch64-unknown-linux-musl"]).toBe("Linux arm64 (musl)");
  });

  it("does not offer a target the fleet cannot build", () => {
    // An Intel Mac target was offered and removed: no queue in the fleet has an
    // Intel Mac agent, so `x86_64-apple-darwin` can never be produced and
    // offering it only promised an artifact no release could contain.
    expect(TARGET_LABELS).not.toContain("x86_64-apple-darwin");
    expect(TARGET_LABELS).toHaveLength(3);
  });
});

describe("uname -> candidate labels", () => {
  it("maps a fleet Linux/x86_64 host", () => {
    expect(targetCandidates("Linux", "x86_64")).toEqual([
      "x86_64-unknown-linux-musl",
      "any",
    ]);
  });

  it("maps a fleet Linux/arm64 host", () => {
    expect(targetCandidates("Linux", "aarch64")).toEqual([
      "aarch64-unknown-linux-musl",
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
  it("selects the candidate the manifest contains", () => {
    // The lookup is an intersection, not a guess: this host has one possible
    // label, and it is used only if the release actually published it.
    expect(selectTarget("Linux", "x86_64", ["x86_64-unknown-linux-musl"])).toBe(
      "x86_64-unknown-linux-musl",
    );
    // The other architecture's artifact is not a match, and it is not a 404
    // either - it is the same "nothing for this host" as an empty manifest.
    expect(
      selectTarget("Linux", "x86_64", ["aarch64-unknown-linux-musl"]),
    ).toBeUndefined();
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
