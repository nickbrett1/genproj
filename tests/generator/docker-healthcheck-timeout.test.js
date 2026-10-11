import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * Regression: the generated Docker HEALTHCHECK `--timeout` must not be a
 * hardcoded value that is too tight for a health endpoint doing real work.
 *
 * The bug: every emitter site hardcoded `--timeout=3s`. A service whose health
 * endpoint does real work (notes-mcp) failed its own smoke step and the
 * container restart-looped until the timeout was hand-loosened to 10s in the
 * generated Dockerfile.
 *
 * The fix: `docker-container.healthcheckTimeout` (a duration string), with a
 * SPLIT default - 10s for an `http:<path>` probe (the app answers a request),
 * 3s for a `command:<cmd>` probe (a local process). These tests render the real
 * Dockerfile for each language so all three emitter sites (node `fetch`, curl,
 * `command:`) are covered, and pin both the defaults and the override.
 */

const NODE_HTTP = {
  capabilities: ["devcontainer-node", "sveltekit", "docker-container"],
  "docker-container": { healthcheck: "http:/health" },
};
const PYTHON_HTTP = {
  capabilities: ["devcontainer-python", "docker-container"],
  "docker-container": { healthcheck: "http:/healthz" },
};
const PYTHON_COMMAND = {
  capabilities: ["devcontainer-python", "docker-container"],
  "docker-container": {
    healthcheck: "command:wget -q -O- http://localhost:3000/",
  },
};

async function dockerfileFor(caps, dc) {
  const files = await generateAllFiles({
    projectName: "timeout-probe",
    description: "probe",
    capabilities: caps,
    configuration: { "docker-container": dc },
    registryNamespace: "nickbrett1",
  });
  return files.find((f) => f.filePath === "Dockerfile").content;
}

describe("docker HEALTHCHECK --timeout (split default + override)", () => {
  it("defaults an http: check to 10s (node fetch site)", async () => {
    const content = await dockerfileFor(
      NODE_HTTP.capabilities,
      NODE_HTTP["docker-container"],
    );
    expect(content).toContain("HEALTHCHECK --interval=30s --timeout=10s");
    expect(content).toContain("node -e");
  });

  it("defaults an http: check to 10s (curl site)", async () => {
    const content = await dockerfileFor(
      PYTHON_HTTP.capabilities,
      PYTHON_HTTP["docker-container"],
    );
    expect(content).toContain("HEALTHCHECK --interval=30s --timeout=10s");
    expect(content).toContain("curl -fsS http://127.0.0.1:3000/healthz");
  });

  it("defaults a command: check to 3s (command site, unchanged)", async () => {
    const content = await dockerfileFor(
      PYTHON_COMMAND.capabilities,
      PYTHON_COMMAND["docker-container"],
    );
    expect(content).toContain("HEALTHCHECK --interval=30s --timeout=3s");
    expect(content).toContain("CMD wget -q -O- http://localhost:3000/");
  });

  it("honours an explicit http: override", async () => {
    const content = await dockerfileFor(PYTHON_HTTP.capabilities, {
      ...PYTHON_HTTP["docker-container"],
      healthcheckTimeout: "20s",
    });
    expect(content).toContain("HEALTHCHECK --interval=30s --timeout=20s");
    expect(content).not.toContain("--timeout=10s");
  });

  it("honours an explicit command: override", async () => {
    const content = await dockerfileFor(PYTHON_COMMAND.capabilities, {
      ...PYTHON_COMMAND["docker-container"],
      healthcheckTimeout: "7s",
    });
    expect(content).toContain("HEALTHCHECK --interval=30s --timeout=7s");
    expect(content).not.toContain("--timeout=3s");
  });
});
