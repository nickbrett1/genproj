import { describe, it, expect } from "vitest";
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
    // ...and the release step fetches those exact bytes back.
    expect(release).toContain('buildkite-agent artifact download "dist/**" .');
    // buildkite-agent is a host binary, so it has to be mounted to be callable
    // from inside the step's container.
    expect(release).toContain("mount-buildkite-agent: true");
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
      'buildkite-agent artifact download "target/release/**" .',
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
    expect(release).toContain('buildkite-agent artifact download "dist/**" .');
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
    expect(release).toContain("the release will carry notes only");
  });

  it("takes the tag prefix from configuration and fixes the release flags", async () => {
    const files = await generate(["buildkite", "github-release", "doppler"], {
      "github-release": { tagPrefix: "release-" },
    });
    const release = releaseSection(pipeline(files));

    expect(release).toContain("git tag --list 'release-*'");
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
