import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * Regression: a SvelteKit + non-node (rust/python/java) project must ship a
 * container that SERVES the app.
 *
 * The bug (roost, current main): `getDockerContainerTemplateData` chose the
 * runtime stage and CMD by the *primary language* alone. For a rust+sveltekit
 * project it built the adapter-node output in a `frontend` stage, copied it
 * into the image, and then ran `rust:1-slim` with `CMD ["<rust-bin>"]` — the
 * scaffolded hello-world that prints one line and exits. Nothing ever served
 * the SvelteKit server, so the image's own HEALTHCHECK
 * (`curl 127.0.0.1:3000/healthz`) could never pass and the container
 * restart-looped. Every CI step was green; the image was dead.
 *
 * These tests render the real Dockerfile through `generateAllFiles` (the path a
 * project generation takes) and pin the served-by-node contract.
 */

async function renderFiles(
  capabilities,
  configuration = {},
  projectName = "demo",
) {
  const files = await generateAllFiles({
    projectName,
    description: "regression fixture",
    capabilities,
    configuration,
    registryNamespace: "OWNER",
  });
  const find = (p) => files.find((f) => f.filePath === p)?.content;
  return { find, files };
}

/** The final (runtime) stage of a rendered Dockerfile. */
function runtimeStage(dockerfile) {
  return dockerfile.split(/\nFROM /).pop();
}

describe("docker-container runtime for SvelteKit + non-node", () => {
  it("rust+sveltekit runs the adapter-node server on a node runtime image", async () => {
    const { find } = await renderFiles(
      [
        "devcontainer-rust",
        "devcontainer-node",
        "sveltekit",
        "docker-container",
      ],
      {
        language: "rust",
        "docker-container": { healthcheck: "http:/healthz" },
      },
      "roost",
    );
    const dockerfile = find("Dockerfile");
    expect(dockerfile).toBeDefined();

    // The build stage still uses the rust toolchain (it has to compile rust).
    expect(dockerfile).toMatch(/^FROM rust:\S+ AS build$/m);

    const runtime = runtimeStage(dockerfile);
    // The runtime is a node image, so the adapter-node server can run.
    expect(runtime).toMatch(/^node:22-slim$/m);
    expect(runtime).not.toMatch(/^rust:1-slim$/m);
    // The SvelteKit server is the entry point, not the rust stub.
    expect(runtime).toContain('CMD ["node", "web/build/index.js"]');
    expect(runtime).not.toContain('CMD ["roost"]');
    // The healthcheck probes the app with node, not curl (node is present).
    expect(runtime).toContain("CMD node -e");
    expect(runtime).toContain("/healthz");
    expect(runtime).not.toMatch(/apt-get install[^\n]*curl/);
    // The built frontend is in the image at the path the CMD names.
    expect(runtime).toContain("COPY --from=frontend /app/build ./web/build");
  });

  it("pure rust (no sveltekit) is unchanged: rust runtime, rust binary CMD", async () => {
    const { find } = await renderFiles([
      "devcontainer-rust",
      "docker-container",
    ]);
    const runtime = runtimeStage(find("Dockerfile"));
    expect(runtime).toMatch(/^rust:1-slim$/m);
    expect(runtime).toContain('CMD ["demo"]');
    expect(runtime).not.toContain("node");
  });

  it("node+sveltekit is unchanged: node runtime, node build CMD", async () => {
    const { find } = await renderFiles([
      "devcontainer-node",
      "sveltekit",
      "docker-container",
    ]);
    const dockerfile = find("Dockerfile");
    const runtime = runtimeStage(dockerfile);
    expect(runtime).toMatch(/^node:22-slim$/m);
    expect(runtime).toContain('CMD ["node", "build/index.js"]');
  });

  it("a declared command still overrides the SvelteKit server (cheap overrule)", async () => {
    const { find } = await renderFiles(
      [
        "devcontainer-rust",
        "devcontainer-node",
        "sveltekit",
        "docker-container",
      ],
      {
        language: "rust",
        "docker-container": { command: ["my-server", "--port", "3000"] },
      },
    );
    const runtime = runtimeStage(find("Dockerfile"));
    expect(runtime).toContain('CMD ["my-server","--port","3000"]');
  });
});

describe("docker-compose environment block", () => {
  it("emits environment: {} when there are no env vars (roost defect 2)", async () => {
    const { find } = await renderFiles([
      "devcontainer-rust",
      "docker-container",
    ]);
    const compose = find("docker-compose.yml");
    expect(compose).toBeDefined();

    // It must parse, and environment must be a mapping (empty), never null.
    const parsed = parseYaml(compose);
    expect(parsed.services.app.environment).toEqual({});
    expect(compose).toContain("environment: {}");
    expect(compose).not.toMatch(/^\s*environment:\s*$/m);
  });

  it("still emits a valid mapping with env var interpolation when set", async () => {
    const { find } = await renderFiles(
      ["devcontainer-rust", "docker-container"],
      { "docker-container": { envVars: ["LOG_LEVEL=info", "FEATURE_FLAG"] } },
    );
    const compose = find("docker-compose.yml");
    const parsed = parseYaml(compose);
    expect(parsed.services.app.environment).toEqual({
      LOG_LEVEL: "${LOG_LEVEL:-info}",
      FEATURE_FLAG: "${FEATURE_FLAG}",
    });
    expect(compose).not.toContain("environment: {}");
  });
});
