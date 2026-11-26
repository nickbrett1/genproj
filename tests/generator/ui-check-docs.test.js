import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * The `check:ui` target contract is the preview server on 127.0.0.1:4173, not
 * a dev server. A header that called 4173 "a running dev server" was the seed
 * of a false bug report ("4173 is the wrong port, vite dev uses 5173"), and a
 * README that documented `check:ui` only when `playwright` was selected left a
 * sveltekit-only project with the script and no documentation at all.
 *
 * These tests pin the corrected wording at both ends: the emitted script (by
 * running it against a dead port, not by matching a comment) and the README.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(
  here,
  "../../src/generator/templates/ui-check-mjs.template",
);
const templateSource = readFileSync(templatePath, "utf8");

const CHECK_UI_CMD = "npm run check:ui";
const PREVIEW_URL = "127.0.0.1:4173";
const NODE_SVELTE = ["devcontainer-node", "sveltekit"];

async function renderFiles(capabilities, configuration, projectName = "demo") {
  const files = await generateAllFiles({
    projectName,
    capabilities,
    configuration,
    registryNamespace: "OWNER",
  });
  return {
    paths: files.map((f) => f.filePath),
    find: (p) => files.find((f) => f.filePath === p)?.content,
  };
}

describe("the emitted ui-check script names the preview server as its target", () => {
  it("header does not call the default target a dev server", () => {
    const header = templateSource.split("*/")[0];
    expect(header).toContain("preview server");
    expect(header).not.toMatch(/verdict for a running dev server/);
  });

  it("an unreachable target names the cause and both escape hatches", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ui-check-docs-"));
    const script = path.join(dir, "ui-check.mjs");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is a mkdtemp() result, not input.
    writeFileSync(script, templateSource);

    // Port 9 (discard) has no listener here, so tier 1 fails at connect().
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--no-cdp",
        "--json",
        "--url",
        "http://127.0.0.1:9",
        "--timeout",
        "5000",
      ],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(1);
    const verdict = JSON.parse(result.stdout);
    const unreachable = verdict.errors.find((e) => e.code === "unreachable");
    expect(unreachable, JSON.stringify(verdict.errors)).toBeTruthy();
    expect(unreachable.message).toContain("no server answered");
    expect(unreachable.message).toContain("npm run preview");
    expect(unreachable.message).toContain(PREVIEW_URL);
    expect(unreachable.message).toContain("UI_BASE_URL");
    expect(unreachable.message).toContain("5173");
  });
});

describe("the README documents check:ui for every frontend project", () => {
  it("a sveltekit project without playwright still gets the note", async () => {
    const { find } = await renderFiles(NODE_SVELTE, {
      language: "node",
    });
    const readme = find("README.md");
    expect(readme).toContain(CHECK_UI_CMD);
    expect(readme).toContain("scripts/ui-check.mjs");
    expect(readme).toContain("preview server");
    expect(readme).toContain(PREVIEW_URL);
    expect(readme).toContain("UI_BASE_URL");
    expect(readme).toContain("5173");
    // playwright-only prose must not appear without playwright.
    expect(readme).not.toContain("End-to-end tests (Playwright)");
  });

  it("a relocated frontend gets the cd into its directory", async () => {
    const { find } = await renderFiles(
      ["devcontainer-rust", ...NODE_SVELTE],
      { language: "rust" },
      "roost",
    );
    const readme = find("README.md");
    expect(readme).toContain(CHECK_UI_CMD);
    expect(readme).toMatch(/```sh\ncd web\/\nnpm run build/);
  });

  it("a project with no frontend gets no check:ui note", async () => {
    const { find } = await renderFiles(["devcontainer-node"], {
      language: "node",
    });
    expect(find("README.md")).not.toContain(CHECK_UI_CMD);
  });
});
