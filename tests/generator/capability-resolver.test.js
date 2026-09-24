import { describe, it, expect, afterEach, vi } from "vitest";

import {
  resolveDependencies,
  validateCapabilitySelection,
  getCapabilitiesRequiringAuth,
  getRequiredAuthServices,
  sortCapabilitiesByDependency,
  getCapabilityExecutionOrder,
  canAddCapability,
  getCapabilitySelectionSummary,
} from "../../src/generator/capability-resolver.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capability resolver", () => {
  describe("resolveDependencies", () => {
    it("adds missing dependencies and tracks them", () => {
      const result = resolveDependencies(["sonarlint"]);
      expect(result.resolvedCapabilities).toEqual(
        expect.arrayContaining([
          "sonarlint",
          "sonarcloud",
          "devcontainer-java",
        ]),
      );
      expect(result.addedDependencies).toEqual(
        expect.arrayContaining(["sonarcloud", "devcontainer-java"]),
      );
      expect(result.conflicts).toEqual([]);
      expect(result.isValid).toBe(true);
    });

    it("auto-adds doppler when circleci is selected", () => {
      const result = resolveDependencies(["circleci"]);
      expect(result.resolvedCapabilities).toEqual(
        expect.arrayContaining(["circleci", "doppler"]),
      );
      expect(result.addedDependencies).toContain("doppler");
      expect(result.isValid).toBe(true);
    });

    it("records conflicts when present", () => {
      const result = resolveDependencies([
        "cloudflare-wrangler",
        "docker-container",
      ]);
      expect(result.conflicts).toContain("docker-container");
      expect(result.isValid).toBe(false);
    });

    it("resolves dependencies transitively across multiple levels", () => {
      // container-agent → coding-agents → doppler is a two-level chain.
      // coding-agents is locked, so it is already in the baseline and only its
      // own dependency (doppler) is newly added by selecting container-agent.
      const result = resolveDependencies(["container-agent"]);
      expect(result.resolvedCapabilities).toEqual(
        expect.arrayContaining(["container-agent", "coding-agents", "doppler"]),
      );
      expect(result.addedDependencies).toContain("doppler");
      expect(result.isValid).toBe(true);
    });

    it("always applies the locked agent baseline", () => {
      // Both agent capabilities are core+locked: any selection resolves them
      // and their doppler dependency.
      const result = resolveDependencies(["devcontainer-rust"]);
      expect(result.resolvedCapabilities).toEqual(
        expect.arrayContaining([
          "devcontainer-rust",
          "docker",
          "coding-agents",
          "container-agent",
          "doppler",
        ]),
      );
      expect(result.addedDependencies).not.toContain("coding-agents");
      expect(result.addedDependencies).not.toContain("container-agent");
    });

    it("does not duplicate an explicitly selected dependency", () => {
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

  describe("validateCapabilitySelection", () => {
    it("returns errors for unknown capabilities", () => {
      const result = validateCapabilitySelection(["unknown-cap"]);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Unknown capability: unknown-cap");
    });

    it("adds warnings for auth requirements", () => {
      const result = validateCapabilitySelection(["circleci"]);
      expect(result.warnings).toContain(
        "Authentication required for: circleci",
      );
    });

    it("reports conflicts as errors", () => {
      const result = validateCapabilitySelection([
        "cloudflare-wrangler",
        "docker-container",
      ]);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Conflicting capability: Docker Container",
      );
    });
  });

  it("identifies capabilities requiring authentication", () => {
    expect(getCapabilitiesRequiringAuth(["circleci", "sonarlint"])).toEqual([
      "circleci",
    ]);
  });

  it("aggregates auth services without duplicates", () => {
    expect(
      getRequiredAuthServices(["circleci", "doppler", "circleci"]).sort(),
    ).toEqual(["circleci", "doppler"]);
  });

  it("sorts capabilities with dependencies first", () => {
    const order = sortCapabilitiesByDependency([
      "sonarlint",
      "devcontainer-java",
      "docker",
    ]);
    expect(order.indexOf("docker")).toBeLessThan(
      order.indexOf("devcontainer-java"),
    );
    expect(order.indexOf("devcontainer-java")).toBeLessThan(
      order.indexOf("sonarlint"),
    );
  });

  it("computes execution order including dependencies", () => {
    const order = getCapabilityExecutionOrder(["sonarlint"]);
    expect(order.indexOf("docker")).toBeGreaterThan(-1);
    expect(order.indexOf("docker")).toBeLessThan(
      order.indexOf("devcontainer-java"),
    );
    expect(order.indexOf("devcontainer-java")).toBeLessThan(
      order.indexOf("sonarlint"),
    );
  });

  describe("canAddCapability", () => {
    it("rejects unknown capabilities", () => {
      expect(canAddCapability("missing-cap", [])).toEqual({
        canAdd: false,
        reason: "Unknown capability",
      });
    });

    it("rejects already selected capability", () => {
      expect(
        canAddCapability("devcontainer-node", ["devcontainer-node"]),
      ).toEqual({
        canAdd: false,
        reason: "Already selected",
      });
    });

    it("rejects conflicting capability", () => {
      expect(
        canAddCapability("docker-container", ["cloudflare-wrangler"]),
      ).toEqual({
        canAdd: false,
        reason: "Conflicts with Cloudflare Wrangler",
      });
    });

    it("allows capability when no conflicts", () => {
      expect(canAddCapability("devcontainer-node", ["sveltekit"])).toEqual({
        canAdd: true,
        reason: null,
      });
    });
  });

  it("summarizes capability selection", () => {
    const summary = getCapabilitySelectionSummary(["sonarlint", "circleci"]);
    expect(summary.totalSelected).toBe(2);
    expect(summary.totalResolved).toBeGreaterThanOrEqual(2);
    expect(summary.addedDependencies).toBeGreaterThanOrEqual(1);
    expect(summary.authServices).toBeGreaterThanOrEqual(1);
    expect(summary.executionOrder).toEqual(
      expect.arrayContaining(["sonarlint", "devcontainer-java"]),
    );
  });
});
