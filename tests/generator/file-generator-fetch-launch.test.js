// tests/generator/file-generator-fetch-launch.test.js

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  capabilities,
  validateCapabilityDependencies,
} from "../../src/catalog/index.js";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import {
  TARGET_LABELS,
  UNAME_CANDIDATES,
  UNIVERSAL_TARGET,
} from "../../src/generator/target-labels.js";

const generate = (capabilities_, configuration = {}) =>
  generateAllFiles({
    name: "test-project",
    capabilities: capabilities_,
    configuration,
  });

const byPath = (files, filePath) =>
  files.find((file) => file.filePath === filePath);

const launch = (configuration = {}, extra = ["devcontainer-rust"]) =>
  generate(["buildkite", "github-release", "fetch-launch", ...extra], {
    language: "rust",
    "github-release": { targets: ["aarch64-apple-darwin"] },
    ...configuration,
  });

const scriptOf = async (configuration = {}) =>
  byPath(await launch(configuration), "scripts/fetch-launch.sh").content;

describe("fetch-launch file generation", () => {
  it("emits the launcher and its README", async () => {
    const files = await launch();

    expect(byPath(files, "scripts/fetch-launch.sh")).toBeDefined();
    expect(byPath(files, "LAUNCHING.md")).toBeDefined();
  });

  it("is a shell script that parses", async () => {
    // The launcher runs on a host at boot: a syntax error is a host that does
    // not start. `bash -n` is the only assertion that actually checks that.
    const dir = mkdtempSync(join(tmpdir(), "fetch-launch-"));
    const file = join(dir, "fetch-launch.sh");
    writeFileSync(file, await scriptOf());

    const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("the launcher resolves its target by lookup", () => {
  // The table is rendered from target-labels.js, which is the same module the
  // pipeline builds its targets from. Asserting that the script *contains the
  // module's table* is the check that catches a copy drifting away from it.
  it("renders every uname case from the shared table", async () => {
    const script = await scriptOf();

    for (const [osName, arches] of Object.entries(UNAME_CANDIDATES)) {
      for (const [machine, labels] of Object.entries(arches)) {
        expect(script).toContain(
          `${osName}/${machine}) echo "${[...labels, UNIVERSAL_TARGET].join(" ")}"`,
        );
      }
    }
  });

  it("falls back to the universal key for a host it has no entry for", async () => {
    const script = await scriptOf();

    expect(script).toContain(`*) echo "${UNIVERSAL_TARGET}"`);
  });

  it("never constructs a label from uname", async () => {
    const script = await scriptOf();

    // A concatenation like this is where producer/consumer drift would live, so
    // its absence is the point rather than an accident.
    expect(script).not.toContain("$(uname -s)-");
    expect(script).not.toContain("$(uname -m)-");
    for (const label of TARGET_LABELS) {
      expect(script).not.toContain(`"$(uname -s)${label}`);
    }
  });
});

describe("launcher contract", () => {
  it("verifies the download before it becomes current", async () => {
    const script = await scriptOf();

    expect(script).toContain("sha256sum");
    // macOS has no sha256sum by default.
    expect(script).toContain("shasum -a 256");
    expect(script).toContain('if [ "$actual" != "$expected" ]');
  });

  it("fetches a URL that carries no version", async () => {
    const script = await scriptOf();

    expect(script).toContain("releases/latest/download/manifest.json");
    expect(script).not.toContain("$VERSION");
  });

  it("takes the asset name from the manifest, not from a convention", async () => {
    const script = await scriptOf();

    expect(script).toContain('"file"');
    expect(script).toContain('asset_url="$(dirname "$MANIFEST_URL")/${file}"');
  });

  it("fails open: every failure path starts what is installed", async () => {
    const script = await scriptOf();

    // Each early exit is a log followed by exec_current, and there is no `-e`
    // that would abort the script before it gets there.
    expect(script).not.toContain("set -euo");
    expect(script).toContain("set -uo pipefail");
    for (const failure of [
      "could not fetch",
      "has no version",
      "publishes no target for this host",
      "has no file/sha256",
      "could not download",
      "sha256 mismatch",
      "could not unpack",
    ]) {
      const line = script.split("\n").find((l) => l.includes(failure));
      expect(line, failure).toBeDefined();
    }
    expect(script.match(/exec_current "\$@"/g).length).toBeGreaterThan(7);
  });

  it("exposes the escape hatch", async () => {
    const script = await scriptOf();

    expect(script).toContain('if [ -n "${NO_FETCH:-}" ]');
  });

  it("flips the symlink atomically rather than in place", async () => {
    const script = await scriptOf();

    // A rename over the destination: a reader never sees `current` dangling.
    expect(script).toContain('ln -sn "${RELEASES_DIR}/${version}"');
    expect(script).toContain('mv -f "${DEPLOY_DIR}/.current.$$" "$CURRENT"');
  });
});

describe("launcher configuration", () => {
  it("defaults the entry point and install prefix to the project name", async () => {
    const script = await scriptOf();

    expect(script).toContain('LAUNCHER_NAME="${LAUNCHER_NAME:-test-project}"');
    expect(script).toContain("${HOME}/.local/share/test-project");
  });

  it("takes the launcher name, prefix and env file from configuration", async () => {
    const script = await scriptOf({
      "fetch-launch": {
        launcherName: "a2a-goose",
        prefix: "a2a-goose",
        envFile: "/etc/a2a-goose.env",
      },
    });

    expect(script).toContain('LAUNCHER_NAME="${LAUNCHER_NAME:-a2a-goose}"');
    expect(script).toContain("/etc/a2a-goose.env");
    expect(script).toContain('exec "${CURRENT}/bin/${LAUNCHER_NAME}"');
  });

  it("uses the GitHub owner for the manifest URL when it is known", async () => {
    const files = await generateAllFiles({
      name: "demo",
      registryNamespace: "nickbrett1",
      capabilities: [
        "buildkite",
        "github-release",
        "fetch-launch",
        "devcontainer-rust",
      ],
      configuration: {
        language: "rust",
        "github-release": { targets: ["aarch64-apple-darwin"] },
      },
    });
    const script = byPath(files, "scripts/fetch-launch.sh").content;

    expect(script).toContain(
      "https://github.com/nickbrett1/demo/releases/latest/download/manifest.json",
    );
    expect(script).not.toContain("<owner>");
  });

  it("documents the escape hatch, the env file and the payload contract", async () => {
    const readme = byPath(await launch(), "LAUNCHING.md").content;

    expect(readme).toContain("NO_FETCH");
    expect(readme).toContain("ENV_FILE");
    expect(readme).toContain("releases/latest/download/manifest.json");
    expect(readme).toContain("bin/test-project");
    // A wheel is a release artifact and a useless payload.
    expect(readme).toContain("zipapp");
    // The universal payload is packed with `tar -C dist .`, so dist/ IS the
    // payload root: the entry point has to be at dist/bin/<name>, and no earlier
    // stage can catch its absence (the sha256 matches a payload that cannot run).
    expect(readme).toContain("dist/bin/test-project");
  });
});

describe("fetch-launch guards and conflicts", () => {
  it("refuses a language with no runnable payload", async () => {
    await expect(
      generate(
        ["buildkite", "github-release", "fetch-launch", "devcontainer-java"],
        {
          language: "java",
        },
      ),
    ).rejects.toThrow(/primary language is java/);
  });

  it("refuses rust with no targets, which could never resolve a label", async () => {
    await expect(
      generate(
        ["buildkite", "github-release", "fetch-launch", "devcontainer-rust"],
        {
          language: "rust",
        },
      ),
    ).rejects.toThrow(/no github-release.targets/);
  });

  it("allows a node project: its single asset is resolvable by the universal key", async () => {
    const files = await generate(
      ["buildkite", "github-release", "fetch-launch", "devcontainer-node"],
      { language: "node" },
    );

    expect(byPath(files, "scripts/fetch-launch.sh")).toBeDefined();
  });

  it("conflicts with docker-container, declared on both sides", () => {
    // Two competing update mechanisms on one host is the failure to avoid, and
    // the UI reads the public descriptor - so both sides have to say it.
    const launcher = capabilities.find((c) => c.id === "fetch-launch");
    const container = capabilities.find((c) => c.id === "docker-container");

    expect(launcher.conflicts).toContain("docker-container");
    expect(container.conflicts).toContain("fetch-launch");

    const result = validateCapabilityDependencies([
      "buildkite",
      "github-release",
      "fetch-launch",
      "docker-container",
    ]);
    expect(result.valid).toBe(false);
    expect(result.conflicts).toHaveLength(1);
  });

  it("requires github-release", () => {
    const launcher = capabilities.find((c) => c.id === "fetch-launch");

    expect(launcher.dependencies).toEqual(["github-release"]);
  });
});
