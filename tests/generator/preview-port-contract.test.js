import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * The preview server's address is a contract, not a Vite default.
 *
 * Four places encode the same target — `playwright.config.js` (baseURL),
 * the harness's `GENPROJ_E2E_APP_PORT`, `DEFAULT_PAGE_URL` in ui-check.mjs,
 * and the README check:ui section — and all of them say 127.0.0.1:4173.
 * `vite preview --port 4173` alone does NOT enforce that: when 4173 is busy
 * Vite silently increments to 4174, so `npm run preview` would advertise
 * 4173 while listening elsewhere and every one of those four would point at
 * whatever squatted the port. `--strictPort` makes the wrong-port case fail
 * loudly instead, which is the only safe behaviour.
 *
 * The escape hatch survives: `npm run preview -- --port 4198` appends after
 * the script's own arguments, and a later `--port` wins.
 */
async function previewScriptFor(capabilities) {
  const files = await generateAllFiles({
    projectName: "demo",
    capabilities,
    configuration: { "devcontainer-node": { nodeVersion: "20" } },
  });
  const manifest = files.find((f) => f.filePath === "package.json");
  expect(manifest).toBeDefined();
  return JSON.parse(manifest.content).scripts.preview;
}

describe("the emitted preview script pins 127.0.0.1:4173", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["sveltekit", ["sveltekit", "devcontainer-node"]],
    ["plain svelte", ["svelte", "devcontainer-node"]],
  ])("%s emits --port 4173 --strictPort", async (_label, capabilities) => {
    const preview = await previewScriptFor(capabilities);
    expect(preview).toContain("--port 4173 --strictPort");
    expect(preview).toBe(
      "vite preview --host 127.0.0.1 --port 4173 --strictPort",
    );
  });
});
