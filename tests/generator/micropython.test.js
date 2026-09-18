import { describe, it, expect } from "vitest";

import { getCapabilityById } from "../../src/catalog/index.js";
import {
  TemplateEngine,
  collectNonDevelopmentContainerFiles,
  generateMergedDevelopmentContainerFiles,
  generateReadmeFile,
  micropythonInstallationFragment,
  micropythonRunArgs,
} from "../../src/generator/file-generator.js";
import { resolveProjectLanguage } from "../../src/generator/capability-template-utils.js";

async function engine() {
  const templateEngine = new TemplateEngine();
  await templateEngine.initialize();
  return templateEngine;
}

describe("micropython capability descriptor", () => {
  it("is an embedded capability that composes on devcontainer-python", () => {
    const capability = getCapabilityById("micropython");
    expect(capability).toBeDefined();
    expect(capability.category).toBe("embedded");
    expect(capability.dependencies).toEqual(["devcontainer-python"]);
    // Deliberately no `provides`: it tells the generator nothing about the
    // project language, so it must not participate in language resolution.
    expect(capability.provides).toEqual([]);
    expect(capability.selectedByDefault).toBe(false);
  });

  it("cuts the pinned `device` mode from the enum (v1.2)", () => {
    const deviceAccess =
      getCapabilityById("micropython").configurationSchema.properties
        .deviceAccess;
    expect(deviceAccess.enum).toEqual(["cgroup-rule", "privileged"]);
    expect(deviceAccess.enum).not.toContain("device");
    expect(deviceAccess.default).toBe("cgroup-rule");
  });

  it("does not change language resolution", () => {
    // It is python-plus-a-hardware-grant; devcontainer-python owns the language.
    expect(
      resolveProjectLanguage({
        capabilities: ["micropython", "devcontainer-python"],
        configuration: {},
      }),
    ).toBe("python");
  });
});

describe("micropythonRunArgs", () => {
  it("defaults to the bench-verified cgroup rule plus the /dev bind", () => {
    expect(micropythonRunArgs({})).toEqual([
      "--device-cgroup-rule=c *:* rmw",
      "--volume=/dev:/dev",
    ]);
    expect(micropythonRunArgs({ deviceAccess: "cgroup-rule" })).toEqual([
      "--device-cgroup-rule=c *:* rmw",
      "--volume=/dev:/dev",
    ]);
  });

  it("uses --privileged for the escape hatch", () => {
    expect(micropythonRunArgs({ deviceAccess: "privileged" })).toEqual([
      "--privileged",
    ]);
  });

  it("never emits a glob --device (Docker does not expand it)", () => {
    const args = micropythonRunArgs({ deviceAccess: "cgroup-rule" }).join(" ");
    expect(args).not.toContain("--device=/dev/tty");
  });
});

describe("micropythonInstallationFragment", () => {
  it("grants the vscode user the dialout group", () => {
    const fragment = micropythonInstallationFragment(["micropython"], {
      capabilities: ["micropython", "devcontainer-python"],
      configuration: {},
    });
    expect(fragment).toContain("groupadd -f dialout");
    expect(fragment).toContain("usermod -aG dialout vscode");
  });

  it("is empty when the capability is not selected", () => {
    expect(
      micropythonInstallationFragment(["devcontainer-python"], {
        capabilities: ["devcontainer-python"],
        configuration: {},
      }),
    ).toBe("");
  });
});

describe("micropython devcontainer generation", () => {
  it("merges the grant into runArgs and the dialout group into the Dockerfile", async () => {
    const templateEngine = await engine();
    const context = {
      capabilities: ["devcontainer-python", "micropython"],
      configuration: {},
      projectName: "unicorn",
    };

    const files = generateMergedDevelopmentContainerFiles(
      templateEngine,
      context,
      ["devcontainer-python"],
    );

    const devcontainerJson = JSON.parse(
      files.find((f) => f.filePath === ".devcontainer/devcontainer.json")
        .content,
    );
    expect(devcontainerJson.runArgs).toContain(
      "--device-cgroup-rule=c *:* rmw",
    );
    expect(devcontainerJson.runArgs).toContain("--volume=/dev:/dev");
    // The tailnet flags the base carries are preserved.
    expect(devcontainerJson.runArgs).toContain("--sysctl");

    const dockerfile = files.find(
      (f) => f.filePath === ".devcontainer/Dockerfile",
    ).content;
    expect(dockerfile).toContain("usermod -aG dialout vscode");
    expect(dockerfile).not.toContain("{{micropythonInstallation}}");

    const postCreate = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    ).content;
    expect(postCreate).toContain("post-create-micropython.sh");
    expect(postCreate).not.toContain("{{micropythonSetup}}");
  });

  it("leaves runArgs untouched when the capability is not selected", async () => {
    const templateEngine = await engine();
    const files = generateMergedDevelopmentContainerFiles(
      templateEngine,
      {
        capabilities: ["devcontainer-python"],
        configuration: {},
        projectName: "x",
      },
      ["devcontainer-python"],
    );
    const devcontainerJson = JSON.parse(
      files.find((f) => f.filePath === ".devcontainer/devcontainer.json")
        .content,
    );
    expect(devcontainerJson.runArgs.join(" ")).not.toContain(
      "device-cgroup-rule",
    );
  });

  it("honours the privileged escape hatch", async () => {
    const templateEngine = await engine();
    const files = generateMergedDevelopmentContainerFiles(
      templateEngine,
      {
        capabilities: ["devcontainer-python", "micropython"],
        configuration: { micropython: { deviceAccess: "privileged" } },
        projectName: "x",
      },
      ["devcontainer-python"],
    );
    const devcontainerJson = JSON.parse(
      files.find((f) => f.filePath === ".devcontainer/devcontainer.json")
        .content,
    );
    expect(devcontainerJson.runArgs).toContain("--privileged");
    expect(devcontainerJson.runArgs).not.toContain(
      "--device-cgroup-rule=c *:* rmw",
    );
  });
});

describe("micropython emitted scripts", () => {
  it("emits find-board.sh that probes candidates using the configured glob", async () => {
    const templateEngine = await engine();
    const files = collectNonDevelopmentContainerFiles(
      templateEngine,
      {
        capabilities: ["devcontainer-python", "micropython"],
        configuration: { micropython: { deviceGlob: "/dev/ttyUSB*" } },
        projectName: "unicorn",
      },
      ["micropython"],
    );

    const findBoard = files.find((f) => f.filePath === "scripts/find-board.sh");
    expect(findBoard).toBeDefined();
    expect(findBoard.content).toContain("/dev/ttyUSB*");
    expect(findBoard.content).toContain("mpremote connect");
    // F3: the classic Linux port must never be hard-coded.
    expect(findBoard.content).not.toContain("ttyACM0");

    const postCreate = files.find(
      (f) => f.filePath === ".devcontainer/post-create-micropython.sh",
    );
    expect(postCreate).toBeDefined();
    expect(postCreate.content).toContain("mpremote");
    expect(postCreate.content).not.toContain("{{micropythonPackages}}");
  });

  it("installs the configured package list", async () => {
    const templateEngine = await engine();
    const files = collectNonDevelopmentContainerFiles(
      templateEngine,
      {
        capabilities: ["devcontainer-python", "micropython"],
        configuration: { micropython: { packages: ["mpremote", "esptool"] } },
        projectName: "unicorn",
      },
      ["micropython"],
    );
    const postCreate = files.find(
      (f) => f.filePath === ".devcontainer/post-create-micropython.sh",
    );
    expect(postCreate.content).toContain("mpremote esptool");
  });
});

describe("micropython README section", () => {
  it("documents exclusivity, the grant breadth and the board check", () => {
    const readme = generateReadmeFile({
      projectName: "unicorn",
      capabilities: ["devcontainer-python", "micropython"],
      configuration: { micropython: { board: "pico-w" } },
    });
    expect(readme.content).toContain("Pico W");
    expect(readme.content).toContain("Access is exclusive");
    expect(readme.content).toContain("--device-cgroup-rule=c *:* rmw");
    expect(readme.content).toContain("find-board.sh");
    // The broad grant must be stated, never described as scoped to serial.
    expect(readme.content).toContain("not");
    expect(readme.content).toContain("any host character device");
  });

  it("omits the section when the capability is not selected", () => {
    const readme = generateReadmeFile({
      projectName: "plain",
      capabilities: ["devcontainer-python"],
      configuration: {},
    });
    expect(readme.content).not.toContain("MicroPython board");
  });
});
