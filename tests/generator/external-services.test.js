import { describe, it, expect } from "vitest";
import {
  getServiceConfig,
  resolveBuildkiteDeployment,
} from "../../src/generator/external-services.js";

describe("resolveBuildkiteDeployment", () => {
  it("reports unconfigured when both variables are unset", () => {
    const result = resolveBuildkiteDeployment({});
    expect(result.configured).toBe(false);
    expect(result.organization).toBeUndefined();
    expect(result.clusterId).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("is configured with a warning when only the organisation is set", () => {
    const result = resolveBuildkiteDeployment({
      GENPROJ_BUILDKITE_ORG: "acme",
    });
    expect(result.configured).toBe(true);
    expect(result.organization).toBe("acme");
    expect(result.clusterId).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("GENPROJ_BUILDKITE_CLUSTER_ID");
  });

  it("errors and reports unconfigured when only the cluster id is set", () => {
    const result = resolveBuildkiteDeployment({
      GENPROJ_BUILDKITE_CLUSTER_ID: "cluster-1",
    });
    expect(result.configured).toBe(false);
    expect(result.organization).toBeUndefined();
    expect(result.clusterId).toBe("cluster-1");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("GENPROJ_BUILDKITE_ORG");
  });

  it("resolves cleanly when both are set", () => {
    const result = resolveBuildkiteDeployment({
      GENPROJ_BUILDKITE_ORG: "acme",
      GENPROJ_BUILDKITE_CLUSTER_ID: "cluster-1",
    });
    expect(result).toEqual({
      organization: "acme",
      clusterId: "cluster-1",
      configured: true,
      errors: [],
      warnings: [],
    });
  });

  it("trims values and treats whitespace-only strings as unset", () => {
    const result = resolveBuildkiteDeployment({
      GENPROJ_BUILDKITE_ORG: "  acme  ",
      GENPROJ_BUILDKITE_CLUSTER_ID: "   ",
    });
    expect(result.organization).toBe("acme");
    expect(result.clusterId).toBeUndefined();
    // Cluster treated as unset, so no "cluster without org" error — just the
    // "org without cluster" warning.
    expect(result.configured).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("serviceConfigs.buildkite", () => {
  it("does not carry the deployment identity", () => {
    const config = getServiceConfig("buildkite");
    expect(config.organization).toBeUndefined();
    expect(config.clusterId).toBeUndefined();
  });
});
