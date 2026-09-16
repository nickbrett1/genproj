import { describe, it, expect } from "vitest";
import { generatePreview } from "../../src/generator/preview-generator.js";

/**
 * Preview used to re-implement the devcontainer/cloud-login/gitignore file
 * generation instead of reusing the real generator's helpers, and the copies
 * drifted: several templates received neither the key nor the substituted value
 * they needed, so the preview panel showed raw `{{placeholders}}` where a real
 * generation would have rendered a value.
 *
 * These tests run against the real templates (no TemplateEngine mock) and fail
 * if any file in a preview renders with an unresolved `{{...}}` token.
 */

const RICH = [
  "devcontainer-node",
  "coding-agents",
  "shell-tools",
  "doppler",
  "cloudflare-wrangler",
  "docsify",
];

const collectTokens = (files, found = new Set()) => {
  for (const file of files) {
    if (file.type === "folder" && file.children) {
      collectTokens(file.children, found);
    }
    for (const token of (file.content ?? "").match(/{{[^{}]+}}/g) ?? []) {
      found.add(`${file.path}: ${token}`);
    }
  }
  return found;
};

const devcontainerFile = (preview, path) =>
  preview.files
    .find((f) => f.name === ".devcontainer" && f.type === "folder")
    .children.find((f) => f.path === path);

describe("preview renders without unresolved placeholders", () => {
  it("resolves every token in the generated file set", async () => {
    const preview = await generatePreview(
      { name: "TestProject", configuration: {} },
      RICH,
    );

    // A Set so the failure message lists each distinct leaked token.
    expect([...collectTokens(preview.files)]).toEqual([]);
  });

  it("resolves every token when no project name is supplied", async () => {
    const preview = await generatePreview({ configuration: {} }, RICH);

    expect([...collectTokens(preview.files)]).toEqual([]);
  });

  it("uses the request's `name` in the devcontainer shell files", async () => {
    const preview = await generatePreview(
      { name: "TestProject", configuration: {} },
      RICH,
    );

    for (const path of [
      ".devcontainer/post-create-setup.sh",
      ".devcontainer/.zshrc",
      ".devcontainer/post-start-setup.sh",
    ]) {
      const file = devcontainerFile(preview, path);
      expect(file).toBeDefined();
      expect(file.content).toContain("/workspaces/TestProject");
    }
  });

  it("falls back to the my-project placeholder when no name is given", async () => {
    const preview = await generatePreview({ configuration: {} }, RICH);

    const setup = devcontainerFile(
      preview,
      ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();
    expect(setup.content).toContain("/workspaces/my-project");
  });

  it("addresses the resolved doppler project, not the repo name", async () => {
    const shared = await generatePreview(
      { name: "TestProject", configuration: {} },
      RICH,
    );
    const login = shared.files
      .find((f) => f.name === "scripts" && f.type === "folder")
      .children.find((f) => f.name === "cloud_login.sh");
    // doppler scaling memo: the shared `common` project is the default, so the
    // repo name must NOT appear as the doppler project.
    expect(login.content).toContain("--project common");
    expect(login.content).not.toContain("--project TestProject");
  });

  it("honours projectStrategy: new for a dedicated doppler project", async () => {
    const preview = await generatePreview(
      {
        name: "TestProject",
        configuration: { doppler: { projectStrategy: "new" } },
      },
      RICH,
    );
    const login = preview.files
      .find((f) => f.name === "scripts" && f.type === "folder")
      .children.find((f) => f.name === "cloud_login.sh");
    expect(login.content).toContain("--project TestProject");

    const zshrc = devcontainerFile(preview, ".devcontainer/.zshrc");
    expect(zshrc.content).toContain("--project TestProject");
  });
});
