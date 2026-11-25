import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The checked-in script `scripts/verify-generated-playwright-e2e.mjs` is what
 * proves the *emitted* Playwright suite runs. Its load-bearing properties are
 * easy to lose in a well-meaning refactor — drop the liveness assertion and it
 * stops detecting a fixture that closes the shared browser; drop the
 * `shared-cdp` assertion and a bundled fallback reports as a pass. Pin them.
 *
 * This is a text pin on the script, not a substitute for running it: the run
 * itself is the CI step `generated_playwright_e2e`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(
  here,
  "../../scripts/verify-generated-playwright-e2e.mjs",
);

const script = fs.readFileSync(scriptPath, "utf8");

describe("verify-generated-playwright-e2e.mjs load-bearing invariants", () => {
  it("exists at scripts/ and is executable JavaScript", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(script).toMatch(/^#!\/usr\/bin\/env node/);
  });

  it("generates the sveltekit + playwright capability set", () => {
    const capabilities = /capabilities:\s*\[([^\]]+)\]/.exec(script)?.[1];
    expect(capabilities).toBeTruthy();
    expect(capabilities).toContain('"devcontainer-node"');
    expect(capabilities).toContain('"sveltekit"');
    expect(capabilities).toContain('"playwright"');
  });

  it("runs the emitted suite through npm run test:e2e", () => {
    expect(script).toContain('"test:e2e"');
    expect(script).toMatch(/"run",\s*"test:e2e"/);
  });

  it("uses the dev server on 4173, not preview", () => {
    expect(script).toMatch(/"run",\s*"dev"/);
    expect(script).not.toMatch(/"run",\s*"preview"/);
    expect(script).toContain('"--port"');
    expect(script).toContain("4173");
    expect(script).toContain('"--host"');
    expect(script).toContain('"127.0.0.1"');
    expect(script).toContain("UI_BASE_URL");
  });

  it("points the fixtures at the Chromium it launched over CDP", () => {
    expect(script).toContain("PLAYWRIGHT_CDP_URL");
    expect(script).toContain("--remote-debugging-port");
    expect(script).toContain("playwright install chromium");
  });

  it("asserts the run used the shared-cdp tier, not the bundled fallback", () => {
    expect(script).toContain("shared-cdp");
    expect(script).toContain("bundled-chromium");
  });

  it("asserts the launched Chromium is still alive after the suite", () => {
    // The runtime proof that no fixture called browser.close().
    expect(script).toContain("STILL ALIVE");
    expect(script).toContain("exitCode === null");
    expect(script).toMatch(/\/json\/version/);
  });

  it("always kills the browser and the dev server in cleanup", () => {
    expect(script).toContain("killTree");
    expect(script).toContain("SIGKILL");
    expect(script).toMatch(/killTree\(chrome\)/);
    expect(script).toMatch(/killTree\(devServer\)/);
    expect(script).toContain("GENPROJ_E2E_KEEP");
  });

  it("records the honest limit: it does not prove Chrome 158 compatibility", () => {
    expect(script).toContain("Chrome 158");
    expect(script).toContain("devcontainer");
  });
});
