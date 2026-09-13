import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";

const generate = (capabilities, configuration = {}) =>
  generateAllFiles({ name: "test-project", capabilities, configuration });

const byPath = (files, filePath) =>
  files.find((file) => file.filePath === filePath);

describe("GitHub release file generation", () => {
  it("emits the workflow, the notes config and the README by default", async () => {
    const files = await generate(["github-release", "devcontainer-node"], {});

    const workflow = byPath(files, ".github/workflows/release.yml");
    expect(workflow).toBeDefined();
    expect(byPath(files, ".github/release.yml")).toBeDefined();
    expect(byPath(files, "RELEASING.md")).toBeDefined();

    // A tag is the trigger; nothing else reaches this workflow.
    expect(workflow.content).toContain("tags:");
    expect(workflow.content).toContain('- "v*"');
    // The release is created with the run's own token, not a PAT.
    expect(workflow.content).toContain("contents: write");
    expect(workflow.content).toContain("${{ github.token }}");
    expect(workflow.content).toContain('gh release create "$GITHUB_REF_NAME"');
    expect(workflow.content).toContain("--generate-notes");
    expect(workflow.content).not.toContain("--draft");
    expect(workflow.content).not.toContain("--prerelease");
  });

  it("renders a non-default configuration", async () => {
    const files = await generate(["github-release", "devcontainer-node"], {
      "github-release": {
        tagPattern: "release-*",
        generateNotes: false,
        draft: true,
        prerelease: true,
      },
    });

    const workflow = byPath(files, ".github/workflows/release.yml");
    expect(workflow.content).toContain('- "release-*"');
    expect(workflow.content).not.toContain('- "v*"');
    // Notes fall back to the annotated tag's message...
    expect(workflow.content).toContain("--notes-from-tag");
    expect(workflow.content).not.toContain("--generate-notes");
    // ...and the release is a draft pre-release.
    expect(workflow.content).toContain("--draft");
    expect(workflow.content).toContain("--prerelease");

    const readme = byPath(files, "RELEASING.md");
    expect(readme.content).toContain("`release-*`");
  });

  it("generates nothing when the capability is not selected", async () => {
    const files = await generate(["devcontainer-node"], {});

    expect(byPath(files, ".github/workflows/release.yml")).toBeUndefined();
    expect(byPath(files, ".github/release.yml")).toBeUndefined();
    expect(byPath(files, "RELEASING.md")).toBeUndefined();
  });
});
