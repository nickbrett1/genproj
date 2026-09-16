// tests/catalog.test.js

import { describe, expect, it } from "vitest";

import {
  buildCatalog,
  capabilities,
  getCapabilitiesByCategory,
  getCapabilityById,
  getRequiredAuthServices,
  validateCapabilityDependencies,
} from "../src/catalog/index.js";

// The catalog's job in phase 0 is to expose exactly the capability set the
// existing UI knows about. Any change here is a deliberate catalog change, so
// the expected list is pinned rather than derived.
const EXPECTED_IDS = [
  "coding-agents",
  "xcode-development",
  "editor-tools",
  "shell-tools",
  "spec-kit",
  "docker",
  "devcontainer-node",
  "sveltekit",
  "dagster",
  "devcontainer-python",
  "devcontainer-java",
  "devcontainer-rust",
  "circleci",
  "buildkite",
  "github-release",
  "fetch-launch",
  "doppler",
  "gitguardian",
  "sonarcloud",
  "code-quality",
  "code-quality-python",
  "sonarlint",
  "cloudflare-wrangler",
  "google-cloud",
  "docker-container",
  "dependabot",
  "lighthouse-ci",
  "playwright",
];

describe("catalog metadata", () => {
  it("exposes the capability set the UI knows about", () => {
    expect(capabilities.map((capability) => capability.id)).toEqual(
      EXPECTED_IDS,
    );
  });

  it("describes every capability", () => {
    for (const capability of capabilities) {
      expect(capability.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(capability.name).toBeTruthy();
      expect(capability.description).toBeTruthy();
      expect(capability.category).toBeTruthy();
      // Icon selection is driven from the catalog, not from a client-side map
      // keyed by capability id: a new capability that reuses a token needs no
      // UI change.
      expect(capability.icon).toMatch(/^[a-z]+$/);
      expect(capability.iconColor).toMatch(/^[a-z]+$/);
      expect(capability.configurationSchema).toMatchObject({ type: "object" });
      expect(typeof capability.selectedByDefault).toBe("boolean");
      expect(Array.isArray(capability.provides)).toBe(true);
      expect(Array.isArray(capability.dependencies)).toBe(true);
      expect(Array.isArray(capability.conflicts)).toBe(true);
      expect(Array.isArray(capability.authServices)).toBe(true);
      expect(Array.isArray(capability.externalServices)).toBe(true);
    }
  });

  it("does not leak generator internals", () => {
    const serialised = JSON.stringify(capabilities);
    expect(serialised).not.toContain('"templates"');
    expect(serialised).not.toContain("templateId");
    expect(serialised).not.toContain("filePath");
  });

  it("marks the core capabilities as selected by default", () => {
    const defaults = capabilities
      .filter((capability) => capability.selectedByDefault)
      .map((capability) => capability.id);
    expect(defaults).toEqual(["coding-agents", "editor-tools", "shell-tools"]);

    for (const capability of capabilities) {
      expect(capability.selectedByDefault).toBe(capability.category === "core");
    }
  });

  it("declares the project-level Primary Language", () => {
    // The primary language is a project fact, not a capability's: it governs
    // the single-valued outputs (CI, release paths, sonar, devcontainer base).
    // It must be discoverable from the public descriptor so a UI can render it.
    const catalog = buildCatalog();
    const language = catalog.configurationSchema.properties.language;
    expect(language.enum).toEqual(["python", "node", "java", "rust"]);
  });

  it("declares the release knobs a project can set, and no tag prefix", () => {
    // The tag prefix was removed: it is written and read only by the release
    // step, so it is not a project choice. `targets` is the real knob.
    const githubRelease = getCapabilityById("github-release");
    expect(githubRelease.configurationSchema.properties).toHaveProperty(
      "targets",
    );
    expect(githubRelease.configurationSchema.properties).not.toHaveProperty(
      "tagPrefix",
    );
  });

  it("declares what the devcontainer capabilities provide", () => {
    const provided = Object.fromEntries(
      capabilities
        .filter((capability) => capability.provides.length > 0)
        .map((capability) => [capability.id, capability.provides]),
    );
    expect(provided).toEqual({
      "devcontainer-node": [
        { type: "sonarcloud.language", value: "javascript" },
      ],
      "devcontainer-python": [{ type: "sonarcloud.language", value: "python" }],
      "devcontainer-java": [{ type: "sonarcloud.language", value: "java" }],
    });
  });

  it("derives authServices from the external services that need auth", () => {
    const withAuth = Object.fromEntries(
      capabilities
        .filter((capability) => capability.authServices.length > 0)
        .map((capability) => [capability.id, capability.authServices]),
    );
    expect(withAuth).toEqual({
      circleci: ["circleci"],
      doppler: ["doppler"],
      gitguardian: ["gitguardian"],
      sonarcloud: ["sonarcloud"],
      "docker-container": ["registry"],
    });

    for (const capability of capabilities) {
      for (const service of capability.authServices) {
        const declared = capability.externalServices.some(
          (external) => external.type === service && external.requiresAuth,
        );
        expect(declared).toBe(true);
      }
    }
  });

  it("builds a catalog envelope with a count", () => {
    const catalog = buildCatalog();
    expect(catalog.count).toBe(EXPECTED_IDS.length);
    expect(catalog.capabilities).toBe(capabilities);
  });
});

describe("catalog lookups", () => {
  it("finds a capability by id", () => {
    expect(getCapabilityById("sonarcloud")?.name).toBe(
      "SonarCloud Code Quality",
    );
    expect(getCapabilityById("nope")).toBeUndefined();
  });

  it("filters by category", () => {
    expect(
      getCapabilitiesByCategory("core").map((capability) => capability.id),
    ).toEqual(["coding-agents", "editor-tools", "shell-tools"]);
    expect(getCapabilitiesByCategory("nope")).toEqual([]);
  });
});

describe("getRequiredAuthServices", () => {
  it("returns a unique list across the selection", () => {
    expect(
      getRequiredAuthServices(["circleci", "doppler", "gitguardian"]),
    ).toEqual(["circleci", "doppler", "gitguardian"]);
  });

  it("deduplicates and ignores unknown ids", () => {
    expect(
      getRequiredAuthServices(["sonarcloud", "sonarcloud", "nope"]),
    ).toEqual(["sonarcloud"]);
  });

  it("returns nothing for a selection that needs no auth", () => {
    expect(getRequiredAuthServices(["shell-tools", "buildkite"])).toEqual([]);
  });
});

describe("validateCapabilityDependencies", () => {
  it("accepts a self-consistent selection", () => {
    expect(
      validateCapabilityDependencies(["docker", "devcontainer-node"]),
    ).toEqual({
      valid: true,
      missing: [],
      conflicts: [],
    });
  });

  it("reports a missing dependency", () => {
    expect(validateCapabilityDependencies(["xcode-development"])).toEqual({
      valid: false,
      missing: [
        { capability: "xcode-development", dependency: "coding-agents" },
      ],
      conflicts: [],
    });
  });

  it("reports a conflict once, whichever side is checked first", () => {
    for (const order of [
      ["docker", "docker-container", "cloudflare-wrangler"],
      ["docker", "cloudflare-wrangler", "docker-container"],
    ]) {
      const result = validateCapabilityDependencies(order);
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual([]);
      expect(result.conflicts).toHaveLength(1);
      expect(
        [
          result.conflicts[0].capability1,
          result.conflicts[0].capability2,
        ].sort(),
      ).toEqual(["cloudflare-wrangler", "docker-container"]);
    }
  });

  it("ignores unknown ids", () => {
    expect(validateCapabilityDependencies(["nope"])).toEqual({
      valid: true,
      missing: [],
      conflicts: [],
    });
  });
});
