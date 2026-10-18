import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { resolveDependencies } from "../../src/generator/capability-resolver.js";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import { getCapabilityById } from "../../src/catalog/index.js";

const PROJECT = "secret-scan-test";

function context(capabilities, configuration = {}) {
  return { name: PROJECT, capabilities, configuration };
}

function findFile(files, filePath) {
  return files.find((file) => file.filePath === filePath);
}

function contentOf(files, filePath) {
  return findFile(files, filePath)?.content ?? "";
}

describe("secret-scan capability", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is required, with no dependencies and nothing to authenticate", () => {
    const capability = getCapabilityById("secret-scan");
    expect(capability).toBeDefined();
    expect(capability.locked).toBe(true);
    expect(capability.dependencies).toEqual([]);
    expect(capability.requiresAny).toBeUndefined();
    expect(capability.requiresAuth).toEqual([]);
    expect(capability.authServices).toEqual([]);
    expect(capability.externalServices).toEqual([]);
  });

  it("emits its files when it is the only capability selected", async () => {
    // The zero-dependency claim proven, not assumed: resolve from an EMPTY
    // selection, which is still what a project with no optional capability
    // gets. `locked` is what puts secret-scan in that resolution.
    const { resolvedCapabilities } = resolveDependencies([]);
    expect(resolvedCapabilities).toContain("secret-scan");

    const files = await generateAllFiles(context(resolvedCapabilities, {}));

    for (const path of [
      ".githooks/pre-commit",
      ".gitleaks.toml",
      ".gitleaksignore",
      "scripts/install-gitleaks.sh",
      "scripts/setup-git-hooks.sh",
    ]) {
      expect(findFile(files, path), path).toBeDefined();
    }
  });

  it("scans staged changes with redaction and fails open without the binary", async () => {
    const files = await generateAllFiles(context(["secret-scan"]));
    const hook = contentOf(files, ".githooks/pre-commit");

    expect(hook).toContain("gitleaks");
    expect(hook).toContain("--pre-commit");
    expect(hook).toContain("--staged");
    // A scanner that prints the secret it found has moved the leak.
    expect(hook).toContain("--redact");
    // Missing binary must warn and allow the commit; CI is the real gate.
    expect(hook).toContain("gitleaks is not installed - skipping");
    // Lint-staged rides in the same hook rather than a second mechanism.
    expect(hook).toContain("node_modules/.bin/lint-staged");
  });

  it("pins one gitleaks version and verifies every download", async () => {
    const files = await generateAllFiles(context(["secret-scan"]));
    const installer = contentOf(files, "scripts/install-gitleaks.sh");

    expect(installer).toContain('VERSION="8.30.1"');
    expect(installer).toContain(
      "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    );
    expect(installer).toContain(
      "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
    );
    expect(installer).toContain(
      "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
    );
    expect(installer).toContain("sha256sum -c");
    // A floating "latest" is exactly what a pinned binary must not be.
    expect(installer).not.toContain("/latest/");
  });

  it("allowlists only generated and deliberately fake files", async () => {
    const files = await generateAllFiles(context(["secret-scan"]));
    const config = contentOf(files, ".gitleaks.toml");

    expect(config).toContain("useDefault = true");
    expect(config).toContain("package-lock");
    expect(config).toContain("vendor/");
    expect(config).toContain("fixtures/");
    // No blanket "ignore everything" escape hatch.
    expect(config).not.toContain("--no-git");
    expect(config).not.toContain("paths = ['''*''']");
  });

  it("installs core.hooksPath from post-create and fails loudly if it does not stick", async () => {
    const files = await generateAllFiles(
      context(["secret-scan", "devcontainer-python", "code-quality-python"]),
    );
    const postCreate = contentOf(files, ".devcontainer/post-create-setup.sh");

    expect(postCreate).toContain("bash scripts/setup-git-hooks.sh");
    // The old silent-success path must be gone.
    expect(postCreate).not.toContain("npx --yes simple-git-hooks");
    // A failure to wire the hooks has to abort post-create, not warn.
    expect(postCreate).toContain("bash scripts/setup-git-hooks.sh) || exit 1");

    const setup = contentOf(files, "scripts/setup-git-hooks.sh");
    expect(setup).toContain("git config core.hooksPath .githooks");
    expect(setup).toContain('if [ "$HOOKS_PATH" != ".githooks" ]');
  });

  it("does not emit the old simple-git-hooks mechanism beside it", async () => {
    const files = await generateAllFiles(
      context(["secret-scan", "devcontainer-node", "code-quality", "circleci"]),
    );
    const packageJson = JSON.parse(contentOf(files, "package.json"));

    expect(packageJson["lint-staged"]).toBeDefined();
    expect(packageJson["simple-git-hooks"]).toBeUndefined();
    expect(packageJson.scripts.prepare).toBeUndefined();
  });

  it("scans the full history in Buildkite, before the build", async () => {
    const files = await generateAllFiles(
      context(["secret-scan", "devcontainer-node", "buildkite"]),
    );
    const pipeline = contentOf(files, ".buildkite/pipeline.yml");

    expect(pipeline).toContain("Secret scan (gitleaks, full history)");
    expect(pipeline).toContain("key: secret_scan_gitleaks");
    expect(pipeline).toContain("install-gitleaks.sh");
    expect(pipeline).toContain("git --redact --verbose .");
    expect(pipeline.indexOf("secret_scan_gitleaks")).toBeLessThan(
      pipeline.indexOf(":hammer: Build and test"),
    );
  });

  it("scans the full history in CircleCI", async () => {
    const files = await generateAllFiles(
      context(["secret-scan", "devcontainer-python", "circleci"]),
    );
    const config = contentOf(files, ".circleci/config.yml");

    expect(config).toContain("Secret scan (gitleaks, full history)");
    expect(config).toContain("install-gitleaks.sh");
    expect(config).toContain("git --redact --verbose .");
  });

  it("actually blocks the commit when gitleaks finds something", async () => {
    const files = await generateAllFiles(context(["secret-scan"]));
    const hook = contentOf(files, ".githooks/pre-commit");
    const dir = mkdtempSync(join(tmpdir(), "genproj-secret-scan-"));
    const bin = join(dir, "bin");

    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      mkdirSync(bin);
      const fakeGitleaks = join(bin, "gitleaks");
      writeFileSync(fakeGitleaks, "#!/bin/sh\nexit 1\n");
      chmodSync(fakeGitleaks, 0o755);
      const hookPath = join(dir, "pre-commit");
      writeFileSync(hookPath, hook);

      // A non-zero scanner must fail the hook. `expect().toThrow()` is the
      // whole gate: a hook that logs a finding and exits 0 is decoration.
      expect(() =>
        execFileSync("sh", [hookPath], {
          cwd: dir,
          stdio: "pipe",
          env: {
            ...process.env,
            PATH: `${bin}:/usr/bin:/bin`,
            HOME: dir,
          },
        }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets the commit through when the scanner cannot be found", async () => {
    const files = await generateAllFiles(context(["secret-scan"]));
    const hook = contentOf(files, ".githooks/pre-commit");
    const dir = mkdtempSync(join(tmpdir(), "genproj-secret-scan-"));

    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      const hookPath = join(dir, "pre-commit");
      writeFileSync(hookPath, hook);

      // Fail-open by design: the local hook is convenience, CI is the gate.
      expect(() =>
        execFileSync("sh", [hookPath], {
          cwd: dir,
          stdio: "pipe",
          env: { ...process.env, PATH: "/usr/bin:/bin", HOME: dir },
        }),
      ).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tells the reader to rotate before anything else", async () => {
    const files = await generateAllFiles(context(["secret-scan"]));
    const readme = contentOf(files, "README.md");

    expect(readme).toContain("## Secret scanning");
    expect(readme).toContain("rotate the credential first");
    expect(readme).toContain(".gitleaksignore");
  });
});
