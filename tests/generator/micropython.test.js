import { describe, it, expect } from "vitest";

import { getCapabilityById } from "../../src/catalog/index.js";
import {
  TemplateEngine,
  collectNonDevelopmentContainerFiles,
  generateAllFiles,
  generateMergedDevelopmentContainerFiles,
  generatePyProjectToml,
  generateReadmeFile,
  micropythonInstallationFragment,
  micropythonRunArgs,
} from "../../src/generator/file-generator.js";
import {
  isMicropython,
  resolveMicropythonChip,
  resolveProjectLanguage,
  ruffCheckCommand,
} from "../../src/generator/capability-template-utils.js";

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

describe("micropython firmware scaffold (layout + lint target)", () => {
  const firmwareContext = () => ({
    projectName: "unicorn",
    description: "Unicorn firmware",
    capabilities: ["devcontainer-python", "micropython", "code-quality-python"],
    configuration: { micropython: { board: "galactic-unicorn" } },
  });

  it("is detected as MicroPython and lints the repository root", () => {
    expect(isMicropython(firmwareContext())).toBe(true);
    expect(isMicropython({ capabilities: ["devcontainer-python"] })).toBe(
      false,
    );
    expect(ruffCheckCommand(firmwareContext())).toBe("ruff check .");
    expect(ruffCheckCommand({ capabilities: ["devcontainer-python"] })).toBe(
      "ruff check src tests",
    );
  });

  it("emits the root + lib/ firmware layout, not a src-layout package", () => {
    const files = generatePyProjectToml(firmwareContext());
    const paths = files.map((f) => f.filePath).sort();
    expect(paths).toEqual([
      "config.py",
      "lib/example.py",
      "main.py",
      "pyproject.toml",
    ]);
    // None of the host-package scaffold leaks into a firmware repo.
    expect(paths.some((p) => p.startsWith("src/"))).toBe(false);
    expect(paths).not.toContain("tests/test_smoke.py");
  });

  it("points ruff at the firmware and drops the host requires-python claim", () => {
    const pyproject = generatePyProjectToml(firmwareContext()).find(
      (f) => f.filePath === "pyproject.toml",
    ).content;
    // Defect 1: ruff must cover root + lib/, not just src/tests.
    expect(pyproject).toContain("[tool.ruff]");
    expect(pyproject).toContain('src = [".", "lib"]');
    expect(pyproject).not.toContain('src = ["src", "tests"]');
    // Defect 2: the lint target is decoupled from the container interpreter.
    expect(pyproject).not.toContain('requires-python = ">=3.11"');
    expect(pyproject).toContain('target-version = "py37"');
    // The firmware is not installable, but pip install -e ".[dev]" must still
    // work so the devcontainer gets ruff.
    expect(pyproject).toContain("packages = []");
    expect(pyproject).toContain('"ruff>=0.4"');
  });

  it("documents the residual lint gap and never promises a CI job", () => {
    const readme = generateReadmeFile(firmwareContext());
    expect(readme.content).toContain("Linting firmware");
    expect(readme.content).toContain("MicroPython 1.19.1");
    expect(readme.content).toContain("py37");
    expect(readme.content).toContain("floor, not a guarantee");
    // The quickstart lints the firmware, not the empty src/tests tree.
    expect(readme.content).toContain("ruff check .");
    expect(readme.content).not.toContain("ruff check src tests");
    // Defect 3: no CI capability selected, so no CI job may be claimed.
    expect(readme.content).not.toMatch(/CI test job/i);
    expect(readme.content).not.toMatch(/\bin CI\b/i);
  });

  it("mentions ruff in CI only when a CI capability is also selected", () => {
    const withoutCi = generateReadmeFile(firmwareContext());
    expect(withoutCi.content).not.toMatch(/\bin CI\b/i);

    const withCi = generateReadmeFile({
      ...firmwareContext(),
      capabilities: [
        "devcontainer-python",
        "micropython",
        "code-quality-python",
        "circleci",
      ],
    });
    expect(withCi.content).toMatch(/CI pipeline also runs `ruff check`/);
  });

  it("does not run a host pytest step in CircleCI for firmware", async () => {
    const context = {
      projectName: "unicorn",
      description: "Unicorn firmware",
      capabilities: [
        "devcontainer-python",
        "micropython",
        "code-quality-python",
        "circleci",
      ],
      configuration: { micropython: { board: "galactic-unicorn" } },
    };
    const files = await generateAllFiles(context);
    const ci = files.find((f) => f.filePath === ".circleci/config.yml");
    expect(ci).toBeDefined();
    // The firmware lint command covers root + lib/.
    expect(ci.content).toContain("ruff check .");
    expect(ci.content).not.toContain("ruff check src tests");
    // `pytest -v` over an empty tree exits 5, so it must not be emitted.
    expect(ci.content).not.toContain("Test (pytest)");
    expect(ci.content).not.toContain("pytest -v");
  });

  it("leaves a host Python project on the src layout unchanged", () => {
    const host = generatePyProjectToml({
      projectName: "plain",
      capabilities: ["devcontainer-python", "code-quality-python"],
      configuration: {},
    });
    const pyproject = host.find((f) => f.filePath === "pyproject.toml").content;
    expect(pyproject).toContain('requires-python = ">=3.11"');
    expect(pyproject).toContain('src = ["src", "tests"]');
    expect(host.map((f) => f.filePath)).toContain("src/plain/__init__.py");
    expect(host.map((f) => f.filePath)).toContain("tests/test_smoke.py");
  });
});

describe("micropython board/chip decoupling (D4)", () => {
  const mpContext = (config = {}) => ({
    projectName: "unicorn",
    description: "Unicorn firmware",
    capabilities: ["devcontainer-python", "micropython", "code-quality-python"],
    configuration: { micropython: config },
  });

  it("does not assert a chip inside a product label", () => {
    const board =
      getCapabilityById("micropython").configurationSchema.properties.board;
    // The Galactic Unicorn is a product name, not a chip: it must not carry a
    // silent RP2040 assertion. Boards sold today are Pico 2 W / RP2350.
    expect(board.enumLabels["galactic-unicorn"]).toBe(
      "Pimoroni Galactic Unicorn",
    );
    expect(board.enumLabels["galactic-unicorn"]).not.toMatch(/RP\d/);
    expect(board.enumLabels["pico-w"]).not.toMatch(/RP\d/);
    expect(board.enumLabels["pico-2-w"]).not.toMatch(/RP\d/);
  });

  it("exposes chip as an axis separate from board", () => {
    const chip =
      getCapabilityById("micropython").configurationSchema.properties.chip;
    expect(chip).toBeDefined();
    expect(chip.enum).toEqual(["rp2040", "rp2350", "unknown"]);
    expect(chip.default).toBe("unknown");
    expect(chip.description).toContain("os.uname().machine");
    expect(chip.description).toContain("2e8a:0005");
  });

  it("resolves chip explicitly, definitionally, or not at all", () => {
    // Explicit chip always wins, even over a product name.
    expect(
      resolveMicropythonChip(
        mpContext({ board: "galactic-unicorn", chip: "rp2040" }),
      ),
    ).toBe("rp2040");
    expect(
      resolveMicropythonChip(
        mpContext({ board: "galactic-unicorn", chip: "rp2350" }),
      ),
    ).toBe("rp2350");
    // Pico W / Pico 2 W are definitional single-chip products.
    expect(resolveMicropythonChip(mpContext({ board: "pico-w" }))).toBe(
      "rp2040",
    );
    expect(resolveMicropythonChip(mpContext({ board: "pico-2-w" }))).toBe(
      "rp2350",
    );
    // A multi-chip product with no chip chosen must not be guessed.
    expect(
      resolveMicropythonChip(mpContext({ board: "galactic-unicorn" })),
    ).toBe("unknown");
    expect(resolveMicropythonChip(mpContext({}))).toBe("unknown");
  });

  it("states the chosen chip and the firmware repo for a known product", () => {
    const readme = generateReadmeFile(
      mpContext({ board: "galactic-unicorn", chip: "rp2040" }),
    );
    expect(readme.content).toContain("Pimoroni Galactic Unicorn");
    expect(readme.content).toContain("https://github.com/pimoroni/unicorn");
    expect(readme.content).toContain("RP2040");
    expect(readme.content).toContain("RPI_PICO_W");
  });

  it("refuses to assert a chip it cannot know, and teaches the banner", () => {
    const readme = generateReadmeFile(mpContext({ board: "galactic-unicorn" }));
    expect(readme.content).toContain("not recorded for this repo");
    // The decisive lesson: read the runtime banner, never the USB PID.
    expect(readme.content).toContain("os.uname().machine");
    expect(readme.content).toContain("2e8a:0005");
    expect(readme.content).toMatch(/USB PID/i);
    expect(readme.content).toContain("says nothing about");
    // It must not silently assert the product's historical chip.
    expect(readme.content).not.toContain(
      "**Pimoroni Galactic Unicorn** (RP2040)",
    );
  });

  it("records the chip next to the board in config.py", () => {
    const files = generatePyProjectToml(
      mpContext({ board: "galactic-unicorn", chip: "rp2350" }),
    );
    const config = files.find((f) => f.filePath === "config.py").content;
    expect(config).toContain('BOARD = "galactic-unicorn"');
    expect(config).toContain('CHIP = "rp2350"');
  });
});
