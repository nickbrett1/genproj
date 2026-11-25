import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * The `playwright` capability: honest e2e scaffolding.
 *
 * It emits three files — a Playwright config, a hybrid CDP/bundled fixtures
 * module and one real smoke test — keyed under the FRONTEND capability, so a
 * non-node project gets them inside `web/` next to its relocated manifest and a
 * `playwright` selection with no frontend emits none of them.
 *
 * It no longer installs Chromium post-create; CI still does (see
 * file-generator-buildkite.test.js), which is what the bundled fallback needs.
 */

async function renderFiles(capabilities, configuration, projectName = "demo") {
  const files = await generateAllFiles({
    projectName,
    capabilities,
    configuration,
    registryNamespace: "OWNER",
  });
  return {
    files,
    paths: files.map((f) => f.filePath),
    find: (p) => files.find((f) => f.filePath === p)?.content,
  };
}

const PLAYWRIGHT = "playwright";
const E2E_FILES = [
  "playwright.config.js",
  "tests/e2e/smoke.e2e.js",
  "tests/e2e/fixtures.js",
];

describe("playwright e2e files land next to the manifest", () => {
  it("node-primary SvelteKit puts them at the repository root", async () => {
    const { paths } = await renderFiles(
      ["devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "node" },
    );
    for (const path of E2E_FILES) {
      expect(paths).toContain(path);
    }
  });

  it("rust-primary SvelteKit relocates them into web/ and not the root", async () => {
    const { paths } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "rust" },
    );
    for (const path of E2E_FILES) {
      expect(paths).toContain(`web/${path}`);
      expect(paths, `${path} leaked to the repository root`).not.toContain(
        path,
      );
    }
    // Adjacency is the point: the config joins the manifest it configures.
    expect(paths).toContain("web/package.json");
  });
});

describe("the generated e2e files are real, not decorative", () => {
  it("the config imports devices, narrows testDir/testMatch and has no webServer", async () => {
    const { find } = await renderFiles(
      ["devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "node" },
    );
    const config = find("playwright.config.js");
    // `devices` used to be referenced without being imported (ReferenceError).
    expect(config).toContain(
      "import { defineConfig, devices } from '@playwright/test';",
    );
    expect(config).toContain("testDir: './tests/e2e'");
    expect(config).toContain("testMatch: '**/*.e2e.js'");
    expect(config).toContain("process.env.UI_BASE_URL");
    expect(config).toContain("trace: 'on-first-retry'");
    // A dev webServer would be wrong for every non-node primary language.
    expect(config).not.toContain("webServer:");
  });

  it("the fixtures prefer CDP, fall back to bundled chromium, and never close the shared browser", async () => {
    const { find } = await renderFiles(
      ["devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "node" },
    );
    const fixtures = find("tests/e2e/fixtures.js");
    expect(fixtures).toContain("PLAYWRIGHT_CDP_URL");
    expect(fixtures).toContain("http://127.0.0.1:9222");
    expect(fixtures).toContain("/json/version");
    expect(fixtures).toContain("chromium.connectOverCDP");
    expect(fixtures).toContain("chromium.launch()");
    // Killing the shared Chrome would take the whole estate down: the only
    // close is on the bundled browser this module launched.
    expect(fixtures).not.toContain("browser.close()");
    expect(fixtures).toContain("bundled.close()");
    // Which tier ran must be observable.
    expect(fixtures).toContain("browserMode");
  });

  it("the smoke test asserts the shell loaded and reports the browser tier", async () => {
    const { find } = await renderFiles(
      ["devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "node" },
    );
    const smoke = find("tests/e2e/smoke.e2e.js");
    expect(smoke).toContain("toHaveTitle");
    expect(smoke).toContain("pageerror");
    expect(smoke).toContain("browserMode");
    // It consumes the hybrid fixtures, not @playwright/test directly.
    expect(smoke).toContain("from './fixtures.js'");
  });
});

describe("the manifest carries the e2e dependency and script", () => {
  it("node-primary: @playwright/test + test:e2e at the root manifest", async () => {
    const { find } = await renderFiles(
      ["devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "node" },
    );
    const pkg = JSON.parse(find("package.json"));
    expect(pkg.devDependencies["@playwright/test"]).toBe("^1.56.0");
    expect(pkg.scripts["test:e2e"]).toBe("playwright test");
    // The vitest runner keeps its key; e2e must not have displaced it.
    expect(pkg.scripts.test).toBe("vitest --coverage");
  });

  it("rust-primary: both entries follow the manifest into web/", async () => {
    const { find } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "rust" },
    );
    const pkg = JSON.parse(find("web/package.json"));
    expect(pkg.devDependencies["@playwright/test"]).toBe("^1.56.0");
    expect(pkg.scripts["test:e2e"]).toBe("playwright test");
  });
});

describe("playwright without a frontend emits nothing", () => {
  it("selects no e2e files, dependency or script", async () => {
    const { paths, find } = await renderFiles(
      ["devcontainer-node", PLAYWRIGHT],
      { language: "node" },
    );
    for (const path of E2E_FILES) {
      expect(paths).not.toContain(path);
    }
    const pkg = JSON.parse(find("package.json"));
    expect(pkg.devDependencies["@playwright/test"]).toBeUndefined();
    expect(pkg.scripts["test:e2e"]).toBeUndefined();
  });
});

describe("playwright unselected emits nothing", () => {
  it("has no e2e files, dependency or script (no false promise)", async () => {
    const { paths, find } = await renderFiles(
      ["devcontainer-node", "sveltekit"],
      { language: "node" },
    );
    for (const path of E2E_FILES) {
      expect(paths).not.toContain(path);
    }
    const pkg = JSON.parse(find("package.json"));
    expect(pkg.devDependencies["@playwright/test"]).toBeUndefined();
    expect(pkg.scripts["test:e2e"]).toBeUndefined();
  });
});

describe("the README documents the manual server start", () => {
  it("says there is no webServer block and shows preview + test:e2e", async () => {
    const { find } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "rust" },
    );
    const readme = find("README.md");
    expect(readme).toContain("End-to-end tests (Playwright)");
    expect(readme).toContain("no `webServer` block");
    expect(readme).toContain("npm run preview");
    expect(readme).toContain("npm run test:e2e");
    // The manifest is in web/, so the README has to say where to run them.
    expect(readme).toContain("cd web");
  });
});

describe("the post-create script no longer installs Chromium", () => {
  it("does not run `playwright install` even when playwright is selected", async () => {
    const { find } = await renderFiles(
      ["devcontainer-node", "sveltekit", PLAYWRIGHT],
      { language: "node" },
    );
    const script = find(".devcontainer/post-create-setup.sh");
    expect(script).toBeTruthy();
    // Dev uses the shared browser (CDP); CI downloads chromium itself.
    expect(script).not.toContain("playwright install");
  });
});
