import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateAllFiles } from "../../src/generator/file-generator.js";

const generate = (capabilities, configuration = {}) =>
  generateAllFiles({ name: "test-project", capabilities, configuration });

const byPath = (files, filePath) =>
  files.find((file) => file.filePath === filePath);

const pipeline = (files) => byPath(files, ".buildkite/pipeline.yml").content;

// The release step is emitted last, so everything from its label on is the
// release. Slicing it out is what lets the "does not rebuild" assertion be
// about the release rather than about the build step's own `npm run build`.
const releaseSection = (yaml) => {
  const start = yaml.indexOf('  - label: ":bookmark: Release"');
  expect(start).toBeGreaterThan(-1);
  return yaml.slice(start);
};

describe("GitHub release file generation", () => {
  it("emits the notes config, the README and the artifact hook", async () => {
    const files = await generate(["github-release", "devcontainer-node"], {});

    expect(byPath(files, ".github/release.yml")).toBeDefined();
    expect(byPath(files, "RELEASING.md")).toBeDefined();
    expect(byPath(files, "scripts/release-artifacts.sh")).toBeDefined();
    // The release is a CI step, not a GitHub Actions workflow: there is no
    // second CI system in the repository.
    expect(byPath(files, ".github/workflows/release.yml")).toBeUndefined();
  });

  it("puts the release in the Buildkite pipeline, gated on the build", async () => {
    const files = await generate(
      ["buildkite", "github-release", "doppler"],
      {},
    );
    const yaml = pipeline(files);
    const release = releaseSection(yaml);

    // The tag is created by CI, after build+test passed on that commit, and
    // only on the default branch.
    expect(release).toContain("key: release");
    expect(release).toContain("depends_on:\n      - build");
    expect(release).toContain('if: build.branch == "main"');
    expect(release).toContain("git tag -a");
    expect(release).toContain('git push origin "refs/tags/$$TAG"');
    expect(release).toContain("gh release create");
    expect(release).toContain("--generate-notes");
    expect(release).not.toContain("--draft");
    // The token is resolved at run time, never stored in the repository.
    expect(release).toContain(
      "doppler secrets get GITHUB_RELEASE_TOKEN --project common --config prd",
    );
    // The artifact hook is what names what gets attached.
    expect(release).toContain("bash scripts/release-artifacts.sh");
  });

  it("installs the gpg binary the Doppler installer verifies with", async () => {
    const files = await generate(
      ["buildkite", "github-release", "doppler"],
      {},
    );
    const release = releaseSection(pipeline(files));

    // cli.doppler.com/install.sh verifies its own download with `gpgv` and
    // exits 3 ("Unable to find gpg binary for signature verification") without
    // it. Debian 13's apt verifies repositories itself and no longer needs
    // `gpgv`, so the step's image is free to ship without it - and `gnupg` only
    // recommends it, which --no-install-recommends drops.
    expect(release).toContain(
      "apt-get install -y --no-install-recommends curl ca-certificates gpgv",
    );
    // The binary has to be there before the installer that looks for it runs.
    expect(
      release.indexOf("-recommends curl ca-certificates gpgv"),
    ).toBeLessThan(release.indexOf("cli.doppler.com/install.sh"));
  });

  it("passes artifacts from the build step to the release instead of rebuilding", async () => {
    const files = await generate(
      ["buildkite", "github-release", "doppler", "devcontainer-node"],
      {},
    );
    const yaml = pipeline(files);
    const release = releaseSection(yaml);

    // The build step uploads what it compiled and tested...
    expect(yaml).toContain("artifact_paths:");
    expect(yaml).toContain('- "dist/**"');
    // ...and the release step fetches those exact bytes back from the agent
    // API, scoped to this step's own artifact path.
    expect(release).toContain('for pattern in "dist/**"; do');
    // `buildkite-agent` is not used at all: on this fleet it is a macOS host
    // binary, and a linux container cannot exec a Mach-O file.
    expect(release).not.toContain("buildkite-agent artifact download");
    expect(release).not.toContain("mount-buildkite-agent");
    // The agent API, not the public REST API: the step holds a per-job token,
    // which the public API rejects (401) and this endpoint accepts. The docker
    // plugin has to forward the token by name to reach the container.
    expect(release).toContain(
      'AGENT_API="https://agent-edge.buildkite.com/v3"',
    );
    expect(release).toContain(
      '"$$AGENT_API/builds/$$BUILDKITE_BUILD_ID/artifacts/search"',
    );
    expect(release).toContain(
      "Authorization: Token $$BUILDKITE_AGENT_ACCESS_TOKEN",
    );
    expect(release).not.toContain("api.buildkite.com/v2");
    expect(release).toContain("            - BUILDKITE_AGENT_ACCESS_TOKEN");
    expect(release).toContain("            - BUILDKITE_BUILD_ID");
    // And it must not compile the same tree a second time.
    expect(release).not.toContain("npm install");
    expect(release).not.toContain("npm run build");
    expect(release).not.toMatch(/cargo build/);
  });

  it("follows the language's output directory", async () => {
    const rust = pipeline(
      await generate(
        ["buildkite", "github-release", "doppler", "devcontainer-rust"],
        {},
      ),
    );

    expect(rust).toContain('- "target/release/**"');
    expect(releaseSection(rust)).toContain(
      'for pattern in "target/release/**"; do',
    );
  });

  it("builds and attaches python artifacts, not notes only", async () => {
    // `dist/**` with nothing creating `dist/` is the silent-empty-match trap:
    // `artifact upload` does not fail on a pattern that matches nothing, so
    // the path and `python -m build` are useless apart. Both, or neither.
    const python = pipeline(
      await generate(
        ["buildkite", "github-release", "doppler", "devcontainer-python"],
        {},
      ),
    );
    const release = releaseSection(python);

    expect(python).toContain("python -m build");
    expect(python).toContain('- "dist/**"');
    expect(release).toContain('for pattern in "dist/**"; do');
  });

  it("releases notes only where there is no known build output", async () => {
    const java = pipeline(
      await generate(
        ["buildkite", "github-release", "doppler", "devcontainer-java"],
        {},
      ),
    );
    const release = releaseSection(java);

    expect(java).not.toContain("artifact_paths:");
    expect(release).not.toContain("buildkite-agent artifact download");
    // Nothing to fetch means no API call and no token forwarded either.
    expect(release).not.toContain("agent-edge.buildkite.com");
    expect(release).not.toContain("BUILDKITE_AGENT_ACCESS_TOKEN");
    expect(release).toContain("the release will carry notes only");
  });

  it("fixes the tag prefix at `v` and ignores configuration", async () => {
    const files = await generate(["buildkite", "github-release", "doppler"], {
      // A prefix is no longer a knob: a stale value in a saved configuration
      // must not change the rendered pipeline.
      "github-release": { tagPrefix: "release-" },
    });
    const release = releaseSection(pipeline(files));

    expect(release).toContain("git tag --list 'v*'");
    expect(release).toContain('TAG="v$$VERSION"');
    expect(release).not.toContain("'release-*'");
    expect(release).not.toContain("release-$$VERSION");
    // Notes are always generated and the release is always published: the
    // parameters that used to choose this were removed, so nothing a project
    // can configure here turns them off.
    expect(release).toContain("--generate-notes");
    expect(release).not.toContain("--notes-from-tag");
    expect(release).not.toContain("--draft");
    expect(release).not.toContain("--prerelease");
  });

  it("leaves the pipeline alone without the capability", async () => {
    const files = await generate(["buildkite", "doppler"], {});

    expect(pipeline(files)).not.toContain("key: release");
    expect(pipeline(files)).not.toContain("artifact_paths:");
    expect(byPath(files, "scripts/release-artifacts.sh")).toBeUndefined();
  });
});

describe("release manifest", () => {
  it("writes a statically-named manifest keyed by target, hashed in place", async () => {
    const files = await generate(
      ["buildkite", "github-release", "devcontainer-node"],
      {},
    );
    const script = byPath(files, "scripts/release-artifacts.sh").content;

    // The manifest is the only stable URL a launcher can read.
    expect(script).toContain("manifest.json");
    expect(script).toContain("sha256sum");
    // Version and hash live in the manifest; the asset name carries the target.
    expect(script).toContain("test-project-any.tar.gz");
    expect(script).not.toContain("$VERSION.tar.gz");
  });

  it("RELEASING.md documents the manifest and the one-language rule", async () => {
    const files = await generate(
      ["buildkite", "github-release", "devcontainer-node"],
      {},
    );
    const readme = byPath(files, "RELEASING.md").content;
    expect(readme).toContain("releases/latest/download/manifest.json");
    expect(readme).toContain("Primary Language");
  });

  it("publishes the launcher and advertises it in the manifest", async () => {
    // The launcher is what a host's init system supervises, so a fix to *it* has
    // to be shippable - otherwise it only changes when a human visits the box.
    // Published verbatim (not packed: one script, not a payload tree) and set
    // beside `assets` in the manifest, not inside it: `assets` is keyed by
    // target, and a candidate lookup must never resolve to the launcher.
    const files = await generate(
      ["buildkite", "github-release", "fetch-launch", "devcontainer-rust"],
      {
        language: "rust",
        "github-release": { targets: ["aarch64-apple-darwin"] },
      },
    );
    const script = byPath(files, "scripts/release-artifacts.sh").content;

    expect(script).toContain("cp scripts/fetch-launch.sh");
    expect(script).toContain('chmod +x "$OUT_DIR/fetch-launch.sh"');
    expect(script).toContain('"launcher": { "file": "fetch-launch.sh"');
  });

  it("writes the launcher's sha256 into the manifest, next to the packing", async () => {
    // A real run: the sha256 in the manifest has to be the sha256 of the file
    // that was actually shipped, or every host refuses the update (fail open,
    // so it would be a silent never-updates).
    const files = await generate(
      ["buildkite", "github-release", "fetch-launch", "devcontainer-rust"],
      {
        language: "rust",
        "github-release": { targets: ["aarch64-apple-darwin"] },
      },
    );
    const script = byPath(files, "scripts/release-artifacts.sh").content;
    const launcher = byPath(files, "scripts/fetch-launch.sh").content;

    const dir = mkdtempSync(join(tmpdir(), "release-artifacts-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "build", "aarch64-apple-darwin", "bin"), {
      recursive: true,
    });
    writeFileSync(join(dir, "scripts", "release-artifacts.sh"), script);
    writeFileSync(join(dir, "scripts", "fetch-launch.sh"), launcher);
    writeFileSync(
      join(dir, "build", "aarch64-apple-darwin", "bin", "test-project"),
      "#!/bin/sh\n",
    );

    const result = spawnSync(
      "bash",
      ["scripts/release-artifacts.sh", "1.2.3"],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    // sha256sum is what the template uses and may not be on a dev's mac; the
    // release step runs it in a Linux container either way.
    if (result.status !== 0 && /sha256sum/.test(result.stderr)) {
      return;
    }
    expect(result.status).toBe(0);

    const manifest = JSON.parse(
      readFileSync(join(dir, "release", "manifest.json"), "utf8"),
    );
    const sha = createHash("sha256").update(launcher).digest("hex");
    expect(manifest.launcher).toEqual({
      file: "fetch-launch.sh",
      sha256: sha,
    });
    // The payload is still keyed by target and hashed the same way.
    expect(manifest.assets["aarch64-apple-darwin"].file).toBe(
      "test-project-aarch64-apple-darwin.tar.gz",
    );
    // And the file it points at is attached, executable.
    expect(readFileSync(join(dir, "release", "fetch-launch.sh"), "utf8")).toBe(
      launcher,
    );
  });

  it("publishes no launcher for a project that has none", async () => {
    // Same real run, without the capability: the step is a guarded no-op, so
    // nothing is attached and the manifest has no `launcher` key - which a
    // running launcher reads as "keep running me".
    const files = await generate(
      ["buildkite", "github-release", "devcontainer-node"],
      {},
    );
    const script = byPath(files, "scripts/release-artifacts.sh").content;

    const dir = mkdtempSync(join(tmpdir(), "release-artifacts-none-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "scripts", "release-artifacts.sh"), script);
    writeFileSync(join(dir, "dist", "index.js"), "// payload\n");

    const result = spawnSync(
      "bash",
      ["scripts/release-artifacts.sh", "1.2.3"],
      {
        cwd: dir,
        encoding: "utf8",
      },
    );
    if (result.status !== 0 && /sha256sum/.test(result.stderr)) {
      return;
    }
    expect(result.status).toBe(0);

    expect(existsSync(join(dir, "release", "fetch-launch.sh"))).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(dir, "release", "manifest.json"), "utf8"),
    );
    expect(manifest.launcher).toBeUndefined();
    // The payload it does have is untouched by any of this.
    expect(manifest.assets.any.file).toBe("test-project-any.tar.gz");
  });
});

describe("per-target release builds", () => {
  const DARWIN = "aarch64-apple-darwin";
  const MUSL = "x86_64-unknown-linux-musl";

  const rust = (targets, extra = {}) =>
    generate(["buildkite", "github-release", "devcontainer-rust"], {
      language: "rust",
      ...extra,
      "github-release": { targets, ...(extra["github-release"] || {}) },
    });

  // A build step's key is the one marker unique to it, so everything from the
  // key to the next step is that step.
  const buildStep = (yaml, target) => {
    const marker = `key: build_${target.replaceAll(/[.-]/g, "_")}`;
    const start = yaml.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const next = yaml.indexOf("\n  - label:", start);
    return yaml.slice(start, next === -1 ? undefined : next);
  };

  it("emits one build step per target, each uploading its own payload", async () => {
    const yaml = pipeline(await rust([DARWIN, MUSL]));

    expect(yaml).toContain("key: build_aarch64_apple_darwin");
    expect(yaml).toContain("key: build_x86_64_unknown_linux_musl");
    // The single-step key is gone: a release that depended on it would attach
    // one target's payload and call the release complete.
    expect(yaml).not.toContain("key: build\n");
    expect(buildStep(yaml, DARWIN)).toContain(
      '- "build/aarch64-apple-darwin/**"',
    );
    expect(buildStep(yaml, MUSL)).toContain(
      '- "build/x86_64-unknown-linux-musl/**"',
    );

    const release = releaseSection(yaml);
    expect(release).toContain("      - build_aarch64_apple_darwin");
    expect(release).toContain("      - build_x86_64_unknown_linux_musl");
    // One search per target pattern, each scoped to its own artifacts so the
    // two targets' payloads cannot be mixed up.
    expect(release).toContain(
      'for pattern in "build/aarch64-apple-darwin/**" "build/x86_64-unknown-linux-musl/**"; do',
    );
  });

  it("builds darwin natively and linux in the toolchain container", async () => {
    const yaml = pipeline(await rust([DARWIN, MUSL]));

    // A macOS binary cannot be linked in a Linux container: that step runs on
    // the agent host, so it has no docker plugin at all.
    const darwin = buildStep(yaml, DARWIN);
    expect(darwin).not.toContain("docker#v5.13.0");
    expect(darwin).toContain(
      `cargo build --release --locked --target "${DARWIN}"`,
    );
    expect(darwin).not.toContain("musl-tools");
    expect(darwin).not.toContain("CARGO_TARGET_");

    const musl = buildStep(yaml, MUSL);
    expect(musl).toContain("docker#v5.13.0");
    expect(musl).toContain('rustup target add "x86_64-unknown-linux-musl"');
    // musl-tools is host-architecture, so on the arm64 container a bare install
    // is inert for an x86_64 target. The target's own architecture is asked for
    // by name, which repoints /usr/bin/musl-gcc at its wrapper.
    expect(musl).toContain("dpkg --add-architecture amd64");
    expect(musl).toContain("musl-tools:amd64");
    // And the toolchain is only used if rustc is told to use it: without this
    // the final link goes through the host `cc` and dies with
    // "unrecognized command-line option '-m64'".
    expect(musl).toContain(
      "CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER: musl-gcc",
    );
    // ...and the plugin actually forwards it. A step-level `env:` value does
    // not enter the container: only names in the plugin's `environment:` list
    // do, taking their value from the job environment.
    expect(musl).toContain("environment:\n            - RELEASE_TARGET");
    expect(musl).toContain(
      "            - CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER",
    );
  });

  it("keeps a darwin target off a queue that only runs containers", async () => {
    // The queue is where the *containers* run, so a project moving it to a
    // Linux queue is not asking for its darwin build to move with it: that
    // build has no container to run in.
    const yaml = pipeline(
      await rust([DARWIN, MUSL], { buildkite: { queue: "linux-medium" } }),
    );

    expect(buildStep(yaml, DARWIN)).toContain("queue: mac-studio-linux");
    expect(buildStep(yaml, MUSL)).toContain("queue: linux-medium");
  });

  it("leaves a project with no darwin target on its configured queue", async () => {
    // The override belongs to the darwin step alone: a pipeline of Linux
    // targets is not quietly split across two queues.
    const yaml = pipeline(
      await rust([MUSL], { buildkite: { queue: "linux-medium" } }),
    );

    expect(yaml).toContain("queue: linux-medium");
    expect(yaml).not.toContain("queue: mac-studio-linux");
  });

  it("maps the toolchain architecture from the target, not the container", async () => {
    const ARM = "aarch64-unknown-linux-musl";
    const yaml = pipeline(await rust([ARM]));

    // Same on an arm64 container, where the arm64 package is the native one:
    // the mapping is a property of the target, so it cannot silently depend on
    // whatever host happens to pick the step up.
    const musl = buildStep(yaml, ARM);
    expect(musl).toContain("dpkg --add-architecture arm64");
    expect(musl).toContain("musl-tools:arm64");
    expect(musl).toContain(
      "CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER: musl-gcc",
    );
    expect(musl).not.toContain("musl-tools:amd64");
  });

  it("runs the tests once, against the host toolchain", async () => {
    const yaml = pipeline(await rust([DARWIN, MUSL]));

    // A cross-compiled binary cannot be executed by the build host, so only the
    // first target's step tests.
    expect(yaml.match(/cargo test --locked/g)).toHaveLength(1);
    expect(buildStep(yaml, DARWIN)).toContain("cargo test --locked");
    expect(buildStep(yaml, MUSL)).not.toContain("cargo test --locked");
  });

  it("names each target for anything the project adds to the step", async () => {
    const yaml = pipeline(await rust([MUSL]));

    expect(buildStep(yaml, MUSL)).toContain(`RELEASE_TARGET: ${MUSL}`);
  });

  it("refuses targets on a language that has no native build", async () => {
    // Otherwise the matrix would emit N identical steps producing the same
    // architecture-independent output under a triple none of them honours.
    await expect(
      generate(["buildkite", "github-release", "devcontainer-node"], {
        language: "node",
        "github-release": { targets: [DARWIN] },
      }),
    ).rejects.toThrow(/native build triples/);
  });

  it("packs one asset per target, read from build/<target>/", async () => {
    const files = await rust([DARWIN, MUSL]);
    const script = byPath(files, "scripts/release-artifacts.sh").content;

    expect(script).toContain(`for target in ${DARWIN} ${MUSL}; do`);
    expect(script).toContain('-C "build/$target" .');
    // Still target-only: a version in the name would make the asset
    // unlaunchable, because nothing can name the current version in advance.
    expect(script).not.toContain("$VERSION.tar.gz");
  });

  it("leaves the single-artifact pipeline alone without targets", async () => {
    const yaml = pipeline(await rust([]));

    expect(yaml).toContain("key: build\n");
    expect(yaml).toContain('- "target/release/**"');
    expect(yaml).not.toContain('"build/');
    expect(yaml).not.toContain("RELEASE_TARGET");
  });
});
