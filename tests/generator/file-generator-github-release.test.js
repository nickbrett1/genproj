import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";

const generate = (capabilities, configuration = {}) =>
  generateAllFiles({ name: "test-project", capabilities, configuration });

const byPath = (files, filePath) =>
  files.find((file) => file.filePath === filePath);

const pipeline = (files) => byPath(files, ".buildkite/pipeline.yml").content;

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

    // The tag is created by CI, after build+test passed on that commit, and
    // only on the default branch.
    expect(yaml).toContain("key: release");
    expect(yaml).toContain('if: build.branch == "main"');
    expect(yaml).toContain("git tag -a");
    expect(yaml).toContain('git push origin "refs/tags/$$TAG"');
    expect(yaml).toContain("gh release create");
    expect(yaml).toContain("--generate-notes");
    expect(yaml).not.toContain("--draft");
    // The token is resolved at run time, never stored in the repository.
    expect(yaml).toContain(
      "doppler secrets get GITHUB_RELEASE_TOKEN --project common --config prd",
    );
    // The artifact hook is what names what gets attached.
    expect(yaml).toContain("bash scripts/release-artifacts.sh");
  });

  it("renders a non-default configuration", async () => {
    const files = await generate(["buildkite", "github-release", "doppler"], {
      "github-release": {
        tagPrefix: "release-",
        generateNotes: false,
        draft: true,
        prerelease: true,
      },
    });
    const yaml = pipeline(files);

    expect(yaml).toContain("git tag --list 'release-*'");
    expect(yaml).toContain("--notes-from-tag");
    expect(yaml).toContain("--draft");
    expect(yaml).toContain("--prerelease");
    expect(pipeline(files)).not.toContain("--generate-notes");
  });

  it("leaves the pipeline alone without the capability", async () => {
    const files = await generate(["buildkite", "doppler"], {});

    expect(pipeline(files)).not.toContain("key: release");
    expect(byPath(files, "scripts/release-artifacts.sh")).toBeUndefined();
  });
});
