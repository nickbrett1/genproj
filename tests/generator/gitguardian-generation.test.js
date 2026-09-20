import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";

describe("GitGuardian Generation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should add GitGuardian orb and job to CircleCI config when GitGuardian and CircleCI are selected", async () => {
    const context = {
      name: "gitguardian-test-project",
      capabilities: ["gitguardian", "circleci"],
      configuration: {},
    };

    const files = await generateAllFiles(context);
    const circleCiConfig = files.find(
      (f) => f.filePath === ".circleci/config.yml",
    );

    expect(circleCiConfig).toBeDefined();
    // Verify Orb injection
    expect(circleCiConfig.content).toContain(
      "ggshield: gitguardian/ggshield@1",
    );

    // Verify Job injection in Workflow
    expect(circleCiConfig.content).toContain("- ggshield/scan:");
    expect(circleCiConfig.content).toContain(
      "base_revision: << pipeline.git.base_revision >>",
    );
    expect(circleCiConfig.content).toContain(
      "requires:\n            - ggshield-scan",
    );
  });

  it("contributes the secret scan to Buildkite with no CircleCI config", async () => {
    // gitguardian requires *some* CI (requiresAny), not CircleCI specifically:
    // the Buildkite secret_scan step already existed, only the dependency was
    // over-tight.
    const context = {
      name: "gitguardian-buildkite",
      capabilities: ["gitguardian", "buildkite"],
      configuration: {},
    };

    const files = await generateAllFiles(context);
    const pipeline = files.find(
      (f) => f.filePath === ".buildkite/pipeline.yml",
    );

    expect(pipeline).toBeDefined();
    expect(pipeline.content).toContain("key: secret_scan");
    expect(pipeline.content).toContain("gitguardian/ggshield");
    expect(
      files.find((f) => f.filePath === ".circleci/config.yml"),
    ).toBeUndefined();
  });

  it("fails generation when no CI provider is selected", async () => {
    const context = {
      name: "gitguardian-no-ci",
      capabilities: ["gitguardian"],
      configuration: {},
    };

    await expect(generateAllFiles(context)).rejects.toThrow(
      /requires a CI capability/,
    );
  });

  it("should not add GitGuardian config if capability is not selected", async () => {
    const context = {
      name: "no-gitguardian-test",
      capabilities: ["circleci"],
      configuration: {},
    };

    const files = await generateAllFiles(context);
    const circleCiConfig = files.find(
      (f) => f.filePath === ".circleci/config.yml",
    );

    expect(circleCiConfig).toBeDefined();
    expect(circleCiConfig.content).not.toContain(
      "ggshield: gitguardian/ggshield",
    );
    expect(circleCiConfig.content).not.toContain("- ggshield/scan:");
  });
});
