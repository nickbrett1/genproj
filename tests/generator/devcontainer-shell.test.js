// tests/generator/devcontainer-shell.test.js

/**
 * Spec 023: a `language: shell` project must open as a devcontainer.
 *
 * A script repo has no toolchain to opt into, so it selects no devcontainer-*
 * capability — and the generator used to emit no `.devcontainer/` at all. The
 * result is a repository the devcontainer CLI refuses outright:
 *
 *   Error: Dev container config (.../.devcontainer/devcontainer.json) not found.
 *
 * (observed on the genproj-generated `um790-backup`). `devcontainer-shell` is
 * the base every other language already has, and `language: shell` implies it.
 *
 * These tests pin the implication, the shape of the shell base (Debian, no
 * language runtime feature, `vscode` user), and that it changes nothing for a
 * project that selects no devcontainer on purpose in another language.
 */

import { describe, it, expect } from "vitest";

import { generateAllFiles } from "../../src/generator/file-generator.js";
import { primaryDevcontainerCapabilityId } from "../../src/generator/capability-template-utils.js";

const CONTEXT = {
  projectName: "um790-backup",
  description: "backup runner",
  registryNamespace: "nickbrett1",
  configuration: { language: "shell" },
};

async function generate(capabilities, extraConfiguration = {}) {
  const files = await generateAllFiles({
    ...CONTEXT,
    capabilities,
    configuration: { ...CONTEXT.configuration, ...extraConfiguration },
  });
  return {
    files,
    get: (path) => files.find((f) => f.filePath === path),
  };
}

const DEVCONTAINER_FILES = [
  ".devcontainer/devcontainer.json",
  ".devcontainer/Dockerfile",
  ".devcontainer/.zshrc",
  ".devcontainer/.p10k.zsh",
  ".devcontainer/.tmux.conf",
  ".devcontainer/post-create-setup.sh",
  ".devcontainer/post-start-setup.sh",
];

describe("the shell base", () => {
  it("resolves devcontainer-shell from the primary language", () => {
    expect(
      primaryDevcontainerCapabilityId({ configuration: { language: "shell" } }),
    ).toBe("devcontainer-shell");
  });

  it("is emitted for a shell project that selects no devcontainer", async () => {
    const { files } = await generate(["docker-container"], {
      "docker-container": { entrypoint: ["/usr/local/bin/backup.sh"] },
    });
    const produced = files
      .map((file) => file.filePath)
      .filter((path) => path.startsWith(".devcontainer/"));

    expect(produced.sort()).toEqual([...DEVCONTAINER_FILES].sort());
  });

  it("is emitted for a batch shell project, the um790-backup shape", async () => {
    const { get } = await generate(
      ["docker-container", "doppler", "secret-scan", "buildkite"],
      {
        "docker-container": {
          workload: "batch",
          entrypoint: ["/usr/local/bin/um790-backup.sh"],
        },
      },
    );

    expect(get(".devcontainer/devcontainer.json")).toBeTruthy();
    // The project's own image is single-stage and job-shaped; the devcontainer
    // is not the deliverable and stays a normal service container.
    expect(get("Dockerfile").content).not.toContain("EXPOSE");
  });

  it("builds on a Debian base with no language runtime feature", async () => {
    const { get } = await generate([]);

    const dockerfile = get(".devcontainer/Dockerfile").content;
    const json = JSON.parse(get(".devcontainer/devcontainer.json").content);

    expect(
      dockerfile.startsWith("FROM mcr.microsoft.com/devcontainers/base"),
    ).toBe(true);
    // `/dev/net/tun` + NET_ADMIN are in runArgs for the tailscale net, so the
    // container user is the base image's non-root `vscode`, as for python.
    expect(json.remoteUser).toBe("vscode");
    expect(dockerfile).toContain("USER vscode");
    expect(Object.keys(json.features)).toEqual([
      "ghcr.io/devcontainers/features/common-utils:2",
      "ghcr.io/devcontainers-extra/features/apt-packages:1",
    ]);
  });

  it("installs ShellCheck only for a project that opted into the CI gate", async () => {
    const without = await generate([]);
    const with_ = await generate(["code-quality-shell"]);

    expect(without.get(".devcontainer/Dockerfile").content).not.toContain(
      "shellcheck",
    );
    expect(with_.get(".devcontainer/Dockerfile").content).toContain(
      "xclip shellcheck",
    );
    // The editor extension follows the same gate.
    expect(
      JSON.parse(with_.get(".devcontainer/devcontainer.json").content)
        .customizations.vscode.extensions,
    ).toContain("timonwong.shellcheck");
  });

  it("keeps the shell base when another devcontainer is selected", async () => {
    // The base follows the PRIMARY language (memo D8), not the selection: a
    // shell project that also selected devcontainer-python reads python as a
    // toolbox, and its python feature is merged into the shell base rather than
    // replacing it.
    const { get } = await generate(["devcontainer-python"]);
    const json = JSON.parse(get(".devcontainer/devcontainer.json").content);

    expect(get(".devcontainer/Dockerfile").content).toContain(
      "FROM mcr.microsoft.com/devcontainers/base",
    );
    expect(Object.keys(json.features)).toContain(
      "ghcr.io/devcontainers/features/python:1",
    );
  });

  it("does not stack the node feature on the shell base's apt Node", async () => {
    // The shell base deliberately carries no language runtime, so Node comes
    // from Debian's apt packages. A toolbox capability (python/rust/java) asks
    // for the devcontainers "node" feature, and installing both puts Debian's
    // corepack underneath the feature's `corepack enable` - EACCES on
    // /usr/bin/pnpm, and the image never builds. The base's apt Node wins, so
    // the redundant feature has to leave the merge.
    const { get } = await generate(["devcontainer-python"]);
    const json = JSON.parse(get(".devcontainer/devcontainer.json").content);

    expect(get(".devcontainer/Dockerfile").content).toMatch(
      /apt-get[^\n]*\bnodejs\b/,
    );
    expect(
      Object.keys(json.features).filter((id) =>
        id.startsWith("ghcr.io/devcontainers/features/node"),
      ),
    ).toEqual([]);
  });

  it("keeps the devcontainer out of the image build context", async () => {
    // The devcontainer's Dockerfile, .zshrc and .p10k.zsh are host-side tooling.
    // Without the exclusion `COPY . .` carries ~125 KB of editor config into
    // every job image.
    const { get } = await generate(["docker-container"], {
      "docker-container": { entrypoint: ["/usr/local/bin/backup.sh"] },
    });

    expect(get(".dockerignore").content.split("\n")).toContain(".devcontainer");
  });

  it("changes nothing for another language with no devcontainer selected", async () => {
    // `node` still means "no devcontainer unless you ask for one": only shell
    // has no capability to ask for.
    const files = await generateAllFiles({
      ...CONTEXT,
      capabilities: ["docker-container"],
      configuration: { language: "node" },
    });

    expect(
      files.some((file) => file.filePath.startsWith(".devcontainer/")),
    ).toBe(false);
  });
});
