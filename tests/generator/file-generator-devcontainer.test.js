import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import { getCapabilityTemplateData } from "../../src/generator/capability-template-utils.js";

const files = (context) => generateAllFiles(context);
const byPath = (generated, filePath) =>
  generated.find((file) => file.filePath === filePath);

describe("file-generator devcontainer merging", () => {
  it("should merge multiple devcontainers", async () => {
    const context = {
      capabilities: ["devcontainer-node", "devcontainer-python"],
      configuration: { language: "python" },
    };

    const generated = await files(context);
    const devcontainerJson = byPath(
      generated,
      ".devcontainer/devcontainer.json",
    );

    expect(devcontainerJson).toBeDefined();
    const parsed = JSON.parse(devcontainerJson.content);
    expect(parsed.features).toBeDefined();
  });
});

describe("primary language (D8): declared, not inferred", () => {
  // Two devcontainers with no declared language is the order-dependent split
  // D8 exists to kill: refuse instead of guessing.
  it("refuses two devcontainers with no declared primary language", async () => {
    await expect(
      files({
        capabilities: ["devcontainer-node", "devcontainer-python"],
        configuration: {},
      }),
    ).rejects.toThrow(/primary language/);
  });

  it("still infers the language from a single devcontainer", async () => {
    const generated = await files({
      capabilities: ["devcontainer-python"],
      configuration: {},
    });
    expect(byPath(generated, ".devcontainer/Dockerfile")).toBeDefined();
  });

  it("follows the declared language, not the first-selected devcontainer", async () => {
    // Rust first, python declared: the base is python and CI is python, so the
    // result does not depend on selection order.
    const generated = await files({
      capabilities: ["devcontainer-rust", "devcontainer-python"],
      configuration: { language: "python" },
    });
    const devcontainerJson = JSON.parse(
      byPath(generated, ".devcontainer/devcontainer.json").content,
    );
    expect(devcontainerJson.name).toBe("Python");
  });

  it("lets a declared language win even when its devcontainer is absent", async () => {
    // Legal and intentional: a rust base image with only python dev tooling.
    const generated = await files({
      capabilities: ["devcontainer-python"],
      configuration: { language: "rust" },
    });
    const devcontainerJson = JSON.parse(
      byPath(generated, ".devcontainer/devcontainer.json").content,
    );
    expect(devcontainerJson.name).toBe("Rust");
  });

  it("derives sonar settings from the primary language, not a JavaScript default", () => {
    const rust = getCapabilityTemplateData("sonarcloud", {
      capabilities: ["sonarcloud"],
      configuration: { language: "rust" },
    });
    // Rust has no sonar mapping: no reportPaths line at all, rather than
    // `sonar.javascript.*` for a project with no JavaScript in it.
    expect(rust.sonarLanguageSettings).toBe("");

    const python = getCapabilityTemplateData("sonarcloud", {
      capabilities: ["sonarcloud"],
      configuration: { language: "python" },
    });
    expect(python.sonarLanguageSettings).toBe(
      "sonar.python.coverage.reportPaths=coverage.xml\nsonar.python.version=3.12",
    );
  });
});
