import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TemplateEngine,
  GOOSE_INSTALL_FRAGMENT,
  GOOSE_UPDATE_SCRIPT,
  gooseInstallFragment,
  gooseWorktreeZshrc,
  hasGoose,
  generateAllFiles,
  generateMergedDevelopmentContainerFiles,
} from "../../src/generator/file-generator.js";
import { generatePreview } from "../../src/generator/preview-generator.js";

/**
 * spec 012 — goose exists only where it can run.
 *
 * The defect these tests pin: genproj installed the goose binary
 * unconditionally and always defined a `goose()` shell function (the Doppler
 * wrapper when `doppler` was selected, else a wrapper around the *bare*
 * binary). In a repo with no agent capability the bare binary started and then
 * died with `error: No provider configured. Run 'goose configure' first.` —
 * reported from a regenerated `galactic-unicorn` (micropython +
 * code-quality-python).
 *
 * The fix: one predicate, `doppler`, decided by {@link hasGoose}, gates the
 * binary, the shell wrapper, the worktree block, the config/recipes write and
 * the post-start self-update. `doppler` is what makes goose runnable, and every
 * capability that wants goose resolves it (`coding-agents` → `doppler`,
 * `container-agent` → `doppler`, `xcode-development` → `coding-agents`,
 * `circleci` → `doppler`).
 */

/** The four devcontainer languages genproj can generate. */
const LANGUAGES = ["node", "python", "java", "rust"];

function commandExists(command) {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function dockerfileFor(files) {
  return files.find((f) => f.filePath === ".devcontainer/Dockerfile").content;
}

function zshrcFor(files) {
  return files.find((f) => f.filePath === ".devcontainer/.zshrc").content;
}

function postStartFor(files) {
  return files.find((f) => f.filePath === ".devcontainer/post-start-setup.sh")
    .content;
}

describe("hasGoose", () => {
  it("is true only when the resolved selection carries doppler", () => {
    expect(hasGoose(["doppler"])).toBe(true);
    expect(hasGoose(["devcontainer-node", "doppler"])).toBe(true);
    // coding-agents / container-agent / circleci all declare doppler, so a
    // resolved selection always carries it; this is why doppler — not a
    // capability list — is the predicate.
    expect(hasGoose(["coding-agents", "doppler"])).toBe(true);
    expect(hasGoose(["container-agent", "doppler"])).toBe(true);
    expect(hasGoose([])).toBe(false);
    expect(hasGoose(["devcontainer-node"])).toBe(false);
    expect(hasGoose(["micropython", "code-quality-python"])).toBe(false);
  });
});

describe("gooseInstallFragment", () => {
  it("is a self-contained RUN instruction when goose is present", () => {
    const fragment = gooseInstallFragment(["doppler"]);
    expect(fragment).toBe(GOOSE_INSTALL_FRAGMENT);
    expect(fragment.startsWith("RUN ")).toBe(true);
    expect(fragment).toContain("aaif-goose/goose/releases");
    expect(fragment).toContain("install -m 0755 /tmp/goose-extract/goose");
    // A RUN spliced into a `\`-continued chain cannot be empty, so the
    // fragment must never leave a dangling continuation behind.
    expect(fragment.endsWith("\\")).toBe(false);
    expect(fragment.split("\n").at(-1)).toBe(
      "    && rm -rf /tmp/goose.tar.bz2 /tmp/goose-extract",
    );
  });

  it("is empty when goose is not selected", () => {
    expect(gooseInstallFragment(["devcontainer-node"])).toBe("");
  });
});

describe("goose gating across the devcontainer languages", () => {
  for (const language of LANGUAGES) {
    const capability = `devcontainer-${language}`;

    it(`${language}: installs no goose and binds no goose() without doppler`, async () => {
      const engine = new TemplateEngine();
      await engine.initialize();
      const context = { capabilities: [capability], configuration: {} };

      const files = generateMergedDevelopmentContainerFiles(engine, context, [
        capability,
      ]);

      expect(dockerfileFor(files)).not.toContain("goose");
      expect(dockerfileFor(files)).not.toContain("GOOSE_ARCH");
      expect(zshrcFor(files)).not.toContain("goose");
      expect(postStartFor(files)).not.toContain("goose");
    });

    it(`${language}: installs, wraps and updates goose with doppler`, async () => {
      const engine = new TemplateEngine();
      await engine.initialize();
      const context = {
        capabilities: [capability, "doppler"],
        configuration: {},
      };

      // The third argument is the devcontainer-* subset only: `doppler` is a
      // capability, not a devcontainer, and passing it here would make the
      // merger derive a `devcontainer-undefined-json` template id.
      const files = generateMergedDevelopmentContainerFiles(engine, context, [
        capability,
      ]);

      expect(dockerfileFor(files)).toContain("RUN GOOSE_ARCH=");
      expect(zshrcFor(files)).toContain(
        'goose() {\n  echo "Starting goose with Doppler (common + goose)..."',
      );
      expect(zshrcFor(files)).toContain(
        "_wt_ensure doppler run --project common --config dev",
      );
      expect(postStartFor(files)).toContain("goose update");
      // The self-update must not warn about a goose it never installed.
      expect(postStartFor(files)).not.toContain("goose not found");
    });
  }
});

describe("goose config and recipes follow the same gate", () => {
  const selection = {
    name: "gate-project",
    configuration: {},
  };

  it("writes no goose config when the selection resolves no doppler", async () => {
    const files = await generateAllFiles({
      ...selection,
      capabilities: ["devcontainer-node", "sonarcloud"],
    });
    const postCreate = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    ).content;
    // sonarcloud registers a goose MCP extension, but an extensions-only
    // config for a goose that is not installed is inert — and it used to ship
    // beside a broken `goose` command.
    expect(postCreate).not.toContain("GOOSECFGEOF");
    expect(postCreate).not.toContain("goose-recipes");
  });

  it("writes the config and recipes for a resolved agent selection", async () => {
    const files = await generateAllFiles({
      ...selection,
      // What the Worker actually passes for `coding-agents`: dependencies
      // expanded (buildProjectContext → resolveCapabilityDependencies).
      capabilities: ["devcontainer-node", "coding-agents", "doppler"],
    });
    const postCreate = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    ).content;
    expect(postCreate).toContain("GOOSECFGEOF");
    expect(postCreate).toContain(
      "git clone --quiet https://github.com/nickbrett1/goose-recipes.git",
    );
  });
});

describe("the preview agrees with the generator", () => {
  it("shows no goose for a selection that resolves no doppler", async () => {
    const preview = await generatePreview({ name: "PreviewProject" }, [
      "devcontainer-node",
    ]);
    const devcontainer = preview.files.find(
      (f) => f.name === ".devcontainer" && f.type === "folder",
    );
    const zshrc = devcontainer.children.find(
      (f) => f.name === ".zshrc",
    ).content;
    const dockerfile = devcontainer.children.find(
      (f) => f.name === "Dockerfile",
    ).content;
    const postStart = devcontainer.children.find(
      (f) => f.name === "post-start-setup.sh",
    ).content;

    expect(zshrc).not.toContain("goose");
    expect(dockerfile).not.toContain("goose");
    expect(postStart).not.toContain("goose");
  });

  it("shows goose for a selection that resolves doppler", async () => {
    const preview = await generatePreview({ name: "PreviewProject" }, [
      "devcontainer-node",
      "doppler",
    ]);
    const devcontainer = preview.files.find(
      (f) => f.name === ".devcontainer" && f.type === "folder",
    );
    const zshrc = devcontainer.children.find(
      (f) => f.name === ".zshrc",
    ).content;
    const dockerfile = devcontainer.children.find(
      (f) => f.name === "Dockerfile",
    ).content;

    expect(zshrc).toContain("Starting goose with Doppler");
    expect(zshrc).toContain("Goose Multi-Session Worktree Workflow");
    expect(dockerfile).toContain("RUN GOOSE_ARCH=");
  });
});

describe.skipIf(!commandExists("zsh"))("generated .zshrc parses", () => {
  it("is valid zsh with and without the goose worktree block", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();
    const dir = mkdtempSync(join(tmpdir(), "genproj-zshrc-"));

    for (const [name, capabilities] of [
      ["plain", ["devcontainer-node"]],
      ["goose", ["devcontainer-node", "doppler"]],
    ]) {
      const files = generateMergedDevelopmentContainerFiles(
        engine,
        { capabilities, configuration: {} },
        capabilities.filter((c) => c.startsWith("devcontainer-")),
      );
      const path = join(dir, `${name}.zshrc`);
      writeFileSync(path, zshrcFor(files));
      expect(() => execFileSync("zsh", ["-n", path])).not.toThrow();
    }
  });

  it("keeps the goose worktree block syntactically self-contained", async () => {
    // The block is appended to the rendered template rather than substituted
    // through a placeholder, so check the seam as the engine produces it.
    const engine = new TemplateEngine();
    await engine.initialize();
    const block = gooseWorktreeZshrc(engine, ["doppler"]);
    expect(block.startsWith("\n")).toBe(true);
    expect(block).toContain("Goose Multi-Session Worktree Workflow");
    expect(gooseWorktreeZshrc(engine, ["devcontainer-node"])).toBe("");
    expect(GOOSE_UPDATE_SCRIPT).toContain("goose update");
  });
});
