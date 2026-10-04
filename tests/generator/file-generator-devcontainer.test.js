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
    // The base is python: its feature is present (rust's is not).
    // Additional devcontainers merge features/extensions only, so rust's
    // remoteUser cannot leak in. The python base now emits an explicit
    // remoteUser (vscode), matching its image, rather than leaving it
    // implicit. The `name` field is the project name, not the language, so it
    // can no longer be used as the language signal.
    expect(
      devcontainerJson.features["ghcr.io/devcontainers/features/python:1"],
    ).toEqual({ version: "3.12" });
    expect(devcontainerJson.remoteUser).toBe("vscode");
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
    // The rust base is selected (its remoteUser survives), even though no
    // devcontainer-rust capability is selected.
    expect(devcontainerJson.remoteUser).toBe("vscode");
  });

  it("gives every language a descriptive, deterministic container name", async () => {
    // `name` is the VS Code display label, and `--name` forwarded through
    // runArgs is what docker actually names the container. Both must be the
    // project name so a generated project never shows up as a random
    // adjective-scientist name in Docker UIs.
    for (const language of ["rust", "node", "python", "java"]) {
      const generated = await files({
        projectName: "copper-lantern",
        capabilities: [`devcontainer-${language}`],
        configuration: {},
      });
      const devcontainerJson = JSON.parse(
        byPath(generated, ".devcontainer/devcontainer.json").content,
      );
      expect(devcontainerJson.name).toBe("copper-lantern");
      expect(devcontainerJson.runArgs.slice(0, 2)).toEqual([
        "--name",
        "copper-lantern-devcontainer",
      ]);
    }
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

describe("mount home follows the devcontainer's actual user", () => {
  const devcontainerJsonFor = async (context) => {
    const generated = await files(context);
    return JSON.parse(
      byPath(generated, ".devcontainer/devcontainer.json").content,
    );
  };

  it("mounts to /home/node for a node project", async () => {
    const json = await devcontainerJsonFor({
      projectName: "gaggle",
      capabilities: ["devcontainer-node", "doppler", "coding-agents"],
      configuration: {},
    });
    expect(json.remoteUser).toBe("node");
    for (const mount of json.mounts) {
      if (mount.includes("/.ssh") || mount.includes("/.doppler")) {
        expect(mount).toContain("target=/home/node/");
      }
    }
    expect(json.mounts.some((m) => m.includes("target=/home/vscode/"))).toBe(
      false,
    );
  });

  it("mounts to /home/vscode when a python image also selects devcontainer-node (devdash regression)", async () => {
    // The python image runs as `vscode` even though the node capability (and
    // its node feature) is selected: the mount home must follow the image's
    // user, not the bare presence of devcontainer-node. Getting this wrong put
    // the host ~/.ssh under /home/node, where the running user never read it,
    // so `git push` had no key.
    const json = await devcontainerJsonFor({
      projectName: "devdash",
      capabilities: [
        "devcontainer-python",
        "devcontainer-node",
        "doppler",
        "coding-agents",
      ],
      configuration: { language: "python" },
    });
    expect(json.remoteUser).toBe("vscode");
    expect(
      json.features["ghcr.io/devcontainers/features/common-utils:2"].username,
    ).toBe("vscode");
    for (const mount of json.mounts) {
      if (mount.includes("/.ssh") || mount.includes("/.doppler")) {
        expect(mount).toContain("target=/home/vscode/");
      }
    }
    expect(json.mounts.some((m) => m.includes("target=/home/node/"))).toBe(
      false,
    );
  });

  it("mounts to /home/vscode for java and rust projects", async () => {
    for (const language of ["java", "rust"]) {
      const json = await devcontainerJsonFor({
        projectName: "quartz-anvil",
        capabilities: [`devcontainer-${language}`, "doppler"],
        configuration: {},
      });
      expect(json.remoteUser).toBe("vscode");
      expect(
        json.mounts
          .find((m) => m.includes("/.ssh"))
          .includes("target=/home/vscode/.ssh"),
      ).toBe(true);
    }
  });
});
