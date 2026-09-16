// tests/generator/file-generator-fetch-launch.test.js

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  it("flips `current` by freeing the name first, never by renaming over it", async () => {
    const script = await scriptOf();

    // `ln -sn tmp` then `mv -f tmp current` reads like the atomic spelling and
    // is silently a no-op: `current` is a symlink to a directory, mv follows it,
    // moves the new link *inside* the previous release, and leaves `current`
    // pointing where it did. The launcher says "installed <version>" and keeps
    // running the version it first installed (mac-studio, v0.1.14 -> v0.1.15).
    // `mv -T` fixes it on GNU and does not exist on macOS.
    expect(script).not.toContain(
      'mv -f "${DEPLOY_DIR}/.current.$$" "$CURRENT"',
    );
    expect(script).toContain('rm -f "$CURRENT" && mv "$flip" "$CURRENT"');

    // This failure's character is that it reports success, so the result is
    // read back: "installed" has to mean "`current` points at it".
    expect(script).toContain(
      'if [ "$(readlink "$CURRENT" 2>/dev/null || true)" != "${RELEASES_DIR}/${version}" ]',
    );

    // Fail open, including here: a flip that cannot be done leaves the host on
    // the release it has, rather than with no `current` at all.
    expect(script).toContain(
      'previous="$(readlink "$CURRENT" 2>/dev/null || true)"',
    );
    expect(script).toContain('ln -sn "$previous" "$CURRENT"');
  });
});

describe("launcher configuration", () => {
  it("defaults the entry point and install prefix to the project name", async () => {
    const script = await scriptOf();

    expect(script).toContain('LAUNCHER_NAME="${LAUNCHER_NAME:-test-project}"');
    expect(script).toContain("${HOME}/.local/share/test-project");
  });

  it("defaults the env file to the project's XDG config directory", async () => {
    const script = await scriptOf();

    // The install directory is XDG data, so the host's own configuration
    // belongs in the XDG config directory beside it - a host has somewhere
    // obvious to put it, and the release still carries nothing.
    expect(script).toContain(
      'ENV_FILE="${ENV_FILE:-$HOME/.config/test-project/env}"',
    );
  });

  it("derives the three values from the project name, not a published default", async () => {
    // These were catalog defaults a client submitted verbatim, resolved from a
    // `{{projectName}}` token; nothing ever varied them, so they are derived
    // from the project name instead (see getFetchLaunchTemplateData). For a
    // project named X the launcher carries launcherName X, prefix X and env
    // file $HOME/.config/X/env.
    const script = await scriptOf();

    expect(script).toContain('LAUNCHER_NAME="${LAUNCHER_NAME:-test-project}"');
    expect(script).toContain("${HOME}/.local/share/test-project");
    expect(script).toContain(
      'ENV_FILE="${ENV_FILE:-$HOME/.config/test-project/env}"',
    );

    // And the catalog no longer offers them as configuration.
    const fetchLaunch = capabilities.find((c) => c.id === "fetch-launch");
    const properties = Object.keys(fetchLaunch.configurationSchema.properties);
    expect(properties).not.toContain("launcherName");
    expect(properties).not.toContain("prefix");
    expect(properties).not.toContain("envFile");
  });

  it("sources the env file, once, on the way to the exec", async () => {
    const script = await scriptOf();

    // Sourcing it is the whole point of the setting: a launcher that defines
    // ENV_FILE and never reads it is a setting that does nothing.
    expect(script).toContain("set -a\n  set +u");
    expect(script).toContain('. "${ENV_FILE}"');
    // Every exit path is an exec, so one call site is enough - and it has to be
    // before the exec, or the payload is the process that does not get it.
    const call = script.indexOf("source_env_file\n");
    const exec = script.indexOf('exec "${CURRENT}/bin/${LAUNCHER_NAME}"');
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(exec);
    // One call site, not one per exit path.
    expect(script.match(/^ {2}source_env_file$/gm)).toHaveLength(1);
  });

  it("stays fail-open for a host's own env file", async () => {
    const script = await scriptOf();

    // The file is the host's script, not ours. Bash exits a non-interactive
    // shell on a syntax error in a sourced file, so it is checked first; and an
    // unset variable in it must not be fatal under `set -u`.
    expect(script).toContain('bash -n "${ENV_FILE}"');
    expect(script).toContain("set +u");
    expect(script).toContain('[ -n "${ENV_FILE}" ] && [ -f "${ENV_FILE}" ]');
    // A missing file is the normal case, not a log line.
    expect(script).not.toContain("no env file");
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

describe("the launcher sources the host's env file", () => {
  // The launcher runs on a host, so the only assertion that proves the setting
  // works is running it: a payload that prints the variable it was handed.
  const host = async ({ envFileContent }) => {
    const dir = mkdtempSync(join(tmpdir(), "fetch-launch-env-"));
    const payload = join(dir, "current", "bin", "test-project");
    mkdirSync(join(dir, "current", "bin"), { recursive: true });
    writeFileSync(
      payload,
      '#!/bin/sh\nprintf "%s\\n" "${FROM_ENV_FILE:-<unset>}"\n',
    );
    chmodSync(payload, 0o755);
    const envFile = join(dir, "env");
    if (envFileContent !== null) {
      writeFileSync(envFile, envFileContent);
    }
    const script = join(dir, "fetch-launch.sh");
    writeFileSync(script, await scriptOf());

    return spawnSync("bash", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        NO_FETCH: "1",
        DEPLOY_DIR: dir,
        ENV_FILE: envFile,
        LAUNCHER_NAME: "test-project",
      },
    });
  };

  it("exports what the file defines to the payload", async () => {
    const result = await host({
      envFileContent: "FROM_ENV_FILE=from-the-host\n",
    });

    expect(result.stdout.trim()).toBe("from-the-host");
    expect(result.status).toBe(0);
  });

  it("starts the payload anyway when the file does not parse", async () => {
    // Bash exits a non-interactive shell on a syntax error in a sourced file,
    // so without the pre-check this host would not start at all - the one
    // failure mode the launcher exists to avoid.
    const result = await host({
      envFileContent: "FROM_ENV_FILE=ok\nif [ ; then\n",
    });

    expect(result.stdout.trim()).toBe("<unset>");
    expect(result.stderr).toContain("syntax error");
    expect(result.status).toBe(0);
  });

  it("says nothing and starts the payload when there is no file", async () => {
    const result = await host({ envFileContent: null });

    expect(result.stdout.trim()).toBe("<unset>");
    expect(result.stderr).not.toContain("env file");
    expect(result.status).toBe(0);
  });
});

describe("fetch-launch upgrades a host that is already running a release", () => {
  // The static assertions above cannot see this defect: the script that had the
  // bug passed every one of them. The only thing that catches it is an upgrade -
  // a host with a `current` that already points at an unpacked release, which is
  // every host after its first boot. The manifest is served over `file://`, the
  // payload is a real tarball with a real sha256, and the assertion is what the
  // host ends up executing.
  const sha256 = (file) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");

  const upgradeHost = async () => {
    const dir = mkdtempSync(join(tmpdir(), "fetch-launch-upgrade-"));
    const serve = join(dir, "serve");
    const pack = join(dir, "pack");
    mkdirSync(serve, { recursive: true });

    // What is installed and running: 1.0.0, with `current` pointing at it, the
    // way every host looks after its first boot.
    const installed = join(dir, "releases", "1.0.0", "bin");
    mkdirSync(installed, { recursive: true });
    writeFileSync(
      join(installed, "test-project"),
      '#!/bin/sh\nprintf "%s\\n" 1.0.0\n',
    );
    chmodSync(join(installed, "test-project"), 0o755);
    symlinkSync(join(dir, "releases", "1.0.0"), join(dir, "current"), "dir");

    // What the manifest offers: 1.0.1, packed the way
    // `scripts/release-artifacts.sh` packs it (`tar -C <dir> .`), under the
    // universal key - which every host's candidate list ends with, so this test
    // does not depend on the machine it runs on.
    const stage = join(pack, "bin");
    mkdirSync(stage, { recursive: true });
    writeFileSync(
      join(stage, "test-project"),
      '#!/bin/sh\nprintf "%s\\n" 1.0.1\n',
    );
    chmodSync(join(stage, "test-project"), 0o755);
    const asset = join(serve, "test-project-any.tar.gz");
    expect(spawnSync("tar", ["-czf", asset, "-C", pack, "."]).status).toBe(0);
    // One asset per line, the shape `scripts/release-artifacts.sh` writes: the
    // launcher reads an entry with grep and two `sed`s, not a JSON parser.
    const sha = sha256(asset);
    writeFileSync(
      join(serve, "manifest.json"),
      `{
  "name": "test-project",
  "version": "1.0.1",
  "tag": "v1.0.1",
  "assets": {
    "any": { "file": "test-project-any.tar.gz", "sha256": "${sha}" }
  }
}
`,
    );

    const script = join(dir, "fetch-launch.sh");
    writeFileSync(script, await scriptOf());
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_DIR: dir,
        ENV_FILE: join(dir, "no-such-env-file"),
        LAUNCHER_NAME: "test-project",
        MANIFEST_URL: `file://${join(serve, "manifest.json")}`,
      },
    });

    return { dir, result };
  };

  it("replaces `current` and execs the new release", async () => {
    const { dir, result } = await upgradeHost();

    expect(result.stderr).toContain("installed 1.0.1");
    expect(result.status).toBe(0);
    // The payload that ran is the fetched one, not the installed one.
    expect(result.stdout.trim()).toBe("1.0.1");
    expect(readlinkSync(join(dir, "current"))).toBe(
      join(dir, "releases", "1.0.1"),
    );
  });

  it("leaves no half-flipped link inside the release it replaced", async () => {
    // The bug's fingerprint: `current` untouched, and a stray `.current.<pid>`
    // sitting under the previous version.
    const { dir } = await upgradeHost();

    // An asymmetric matcher inside `toContain` would pass vacuously; these are
    // plain arrays so a stray fails the test rather than the assertion.
    expect(
      readdirSync(join(dir, "releases", "1.0.0")).filter((entry) =>
        entry.startsWith(".current."),
      ),
    ).toEqual([]);
    expect(
      readdirSync(dir).filter((entry) => entry.startsWith(".current.")),
    ).toEqual([]);
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
