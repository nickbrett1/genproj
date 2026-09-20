// tests/catalog.test.js

import { describe, expect, it } from "vitest";

import {
  buildCatalog,
  capabilities,
  categories,
  getCapabilitiesByCategory,
  getCapabilityById,
  getCategoryById,
  getRequiredAuthServices,
  getVisibleCategories,
  validateCapabilityDependencies,
} from "../src/catalog/index.js";
import { resolveDependencies } from "../src/generator/capability-resolver.js";

// The catalog's job in phase 0 is to expose exactly the capability set the
// existing UI knows about. Any change here is a deliberate catalog change, so
// the expected list is pinned rather than derived.
const EXPECTED_IDS = [
  "coding-agents",
  "container-agent",
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
  "micropython",
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
    expect(defaults).toEqual(["editor-tools", "shell-tools"]);

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
    // A single platform-specific artifact is a distinct fact from a build
    // matrix, so it has its own knob rather than overloading `targets`.
    expect(githubRelease.configurationSchema.properties).toHaveProperty(
      "target",
    );
    expect(githubRelease.configurationSchema.properties).not.toHaveProperty(
      "tagPrefix",
    );
  });

  it("requires doppler, so the release token never comes from the fleet env", () => {
    // The release step resolves GITHUB_RELEASE_TOKEN through Doppler. Without
    // the capability it would fall back to a GH_TOKEN in the agent's
    // environment, which puts a repository write token on every job on the
    // fleet - so the dependency is what makes the token plumbing non-optional.
    expect(getCapabilityById("github-release").dependencies).toEqual([
      "buildkite",
      "doppler",
    ]);
    const result = resolveDependencies(["buildkite", "github-release"]);
    expect(result.resolvedCapabilities).toContain("doppler");
    expect(result.addedDependencies).toContain("doppler");
  });

  it("declares what the devcontainer capabilities provide", () => {
    const provided = Object.fromEntries(
      capabilities
        .filter((capability) => capability.provides.length > 0)
        .map((capability) => [capability.id, capability.provides]),
    );
    expect(provided).toEqual({
      "devcontainer-node": [
        { type: "language", value: "node" },
        { type: "sonarcloud.language", value: "javascript" },
      ],
      "devcontainer-python": [
        { type: "language", value: "python" },
        { type: "sonarcloud.language", value: "python" },
      ],
      "devcontainer-java": [
        { type: "language", value: "java" },
        { type: "sonarcloud.language", value: "java" },
      ],
      "devcontainer-rust": [{ type: "language", value: "rust" }],
    });
  });

  it("provides the effective Primary Language for every devcontainer", () => {
    // A client resolves the language implied by a selection from these, so a
    // `visibleWhen` condition on `language` is evaluable without re-implementing
    // resolveProjectLanguage. Each value must be one the generator accepts.
    const languages = capabilities
      .filter((capability) => capability.id.startsWith("devcontainer-"))
      .map((capability) => {
        const provide = capability.provides.find(
          (entry) => entry.type === "language",
        );
        return [capability.id, provide?.value];
      });
    expect(Object.fromEntries(languages)).toEqual({
      "devcontainer-node": "node",
      "devcontainer-python": "python",
      "devcontainer-java": "java",
      "devcontainer-rust": "rust",
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

describe("the agent capabilities", () => {
  it("live in their own `agents` category, distinct from core", () => {
    expect(getCapabilityById("coding-agents").category).toBe("agents");
    expect(getCapabilityById("container-agent").category).toBe("agents");
  });

  it("are optional — not pre-selected and not locked", () => {
    for (const id of ["coding-agents", "container-agent"]) {
      const capability = getCapabilityById(id);
      expect(capability.selectedByDefault).toBe(false);
      expect(capability.locked).not.toBe(true);
    }
  });

  it("both require doppler, which is where their provider and secrets come from", () => {
    expect(getCapabilityById("coding-agents").dependencies).toContain(
      "doppler",
    );
    expect(getCapabilityById("container-agent").dependencies).toContain(
      "doppler",
    );
  });

  it("resolves container-agent → coding-agents → doppler transitively", () => {
    const result = resolveDependencies(["container-agent"]);
    expect(result.resolvedCapabilities).toEqual(
      expect.arrayContaining(["container-agent", "coding-agents", "doppler"]),
    );
    expect(result.addedDependencies).toEqual(
      expect.arrayContaining(["coding-agents", "doppler"]),
    );
  });

  it("is not pulled in by a devcontainer (a choice, not a default)", () => {
    const devcontainers = capabilities.filter((capability) =>
      capability.id.startsWith("devcontainer-"),
    );
    expect(devcontainers.map((capability) => capability.id)).toEqual([
      "devcontainer-node",
      "devcontainer-python",
      "devcontainer-java",
      "devcontainer-rust",
    ]);
    for (const devcontainer of devcontainers) {
      expect(devcontainer.dependencies).not.toContain("container-agent");
      expect(devcontainer.dependencies).not.toContain("coding-agents");
    }
    const result = resolveDependencies(["devcontainer-rust"]);
    expect(result.resolvedCapabilities).not.toContain("container-agent");
  });

  it("does not duplicate container-agent when it is also selected", () => {
    const result = resolveDependencies([
      "devcontainer-python",
      "container-agent",
    ]);
    expect(result.resolvedCapabilities).toEqual(
      expect.arrayContaining(["container-agent", "coding-agents"]),
    );
    expect(result.resolvedCapabilities.length).toBe(
      new Set(result.resolvedCapabilities).size,
    );
    expect(result.addedDependencies).not.toContain("container-agent");
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
    ).toEqual(["editor-tools", "shell-tools"]);
    expect(
      getCapabilitiesByCategory("agents").map((capability) => capability.id),
    ).toEqual(["coding-agents", "container-agent"]);
    expect(getCapabilitiesByCategory("nope")).toEqual([]);
  });
});

// The category list is what the UI renders its sections from. Before it lived
// here, the client kept its own order and headings, so a new category stayed
// invisible until the client was redeployed.
describe("category metadata", () => {
  it("declares the sections the UI renders, in order", () => {
    expect(getVisibleCategories().map((category) => category.id)).toEqual([
      "core",
      "agents",
      "frameworks",
      "devcontainer",
      "embedded",
      "apple-development",
      "ci-cd",
      "code-quality",
      "secrets",
      "deployment",
      "monitoring",
      "project-structure",
    ]);
  });

  it("gives the agents category its own heading", () => {
    expect(getCategoryById("agents")?.label).toBe("Agents");
  });

  it("keeps the dependency-only category out of the rendered sections", () => {
    // docker is pulled in as a dependency; it is not a user choice and has no
    // section of its own.
    expect(getCategoryById("internal")?.visible).toBe(false);
    expect(
      getCapabilitiesByCategory("internal").map((capability) => capability.id),
    ).toEqual(["docker"]);
  });

  it("declares a category for every capability", () => {
    const declared = new Set(categories.map((category) => category.id));
    for (const capability of capabilities) {
      expect(declared.has(capability.category)).toBe(true);
    }
  });

  it("orders the sections uniquely", () => {
    const orders = categories.map((category) => category.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("does not reorder the catalog it was loaded from", () => {
    expect(categories.map((category) => category.id)).toEqual([
      "core",
      "agents",
      "frameworks",
      "devcontainer",
      "embedded",
      "apple-development",
      "ci-cd",
      "code-quality",
      "secrets",
      "deployment",
      "monitoring",
      "project-structure",
      "internal",
    ]);
  });

  it("travels with the catalog over HTTP", () => {
    expect(buildCatalog().categories).toEqual(categories);
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
      validateCapabilityDependencies([
        "docker",
        "devcontainer-node",
        "container-agent",
        "coding-agents",
        "doppler",
      ]),
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
