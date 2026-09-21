import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * The container's HTTP server follows the PRIMARY LANGUAGE (design memo
 * "Mission control for the a2a-goose fleet — roost"):
 *
 *   - node primary → the SvelteKit app IS the server (adapter-node emits
 *     `build/index.js`, which node runs);
 *   - rust/python/java primary → the Svelte frontend is built to STATIC assets
 *     (adapter-static / plain Vite) and the language's OWN server serves them.
 *     The runtime image is the language image and contains no node.
 *
 * This reverses an earlier fix (680c1fe) that ran the adapter-node server in a
 * node runtime image for every primary language. That diagnosis was right about
 * the symptom (a dead roost image) but wrong about the design: roost §6.2 says
 * the UI is built to static assets "served by the hub", and §9 recommends Rust
 * for the hub. There is no Node backend in the design.
 *
 * These tests render the real Dockerfile (through `generateAllFiles`, the path
 * a project generation takes) and pin the language-follows contract.
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

describe("docker-container runtime follows the primary language", () => {
  it("rust+sveltekit keeps the rust runtime, serves via curl, and has no node", async () => {
    const { find, files } = await renderFiles(
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
    // The frontend is still built in its own node stage (the rust image has no
    // node) — that stage is not in question.
    expect(dockerfile).toContain("FROM node:22-bookworm AS frontend");

    const runtime = runtimeStage(dockerfile);
    // The runtime is the LANGUAGE image: no node anywhere in it.
    expect(runtime).toMatch(/^rust:1-slim$/m);
    expect(runtime).not.toMatch(/^node:/m);
    expect(runtime).not.toContain('CMD ["node"');
    // The rust binary is the entry point (and, once implemented, the server).
    expect(runtime).toContain('CMD ["roost"]');
    // The healthcheck probes with curl, not node, against the language server.
    expect(runtime).toContain("CMD curl -fsS");
    expect(runtime).toContain("/healthz");
    expect(runtime).not.toContain("node -e");
    // curl is auto-installed on the non-node image.
    expect(runtime).toMatch(/apt-get install[^\n]*curl/);
    // The static assets are copied to the documented location.
    expect(runtime).toContain("COPY --from=frontend /app/build ./web/build");

    // /healthz is NOT a SvelteKit +server.js route for a non-node primary.
    expect(files.map((f) => f.filePath)).not.toContain(
      "web/src/routes/health/+server.js",
    );
  });

  it("rust+svelte (plain Vite) copies `dist` and never runs node", async () => {
    const { find } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "svelte", "docker-container"],
      { language: "rust" },
      "roost",
    );
    const runtime = runtimeStage(find("Dockerfile"));
    expect(runtime).toMatch(/^rust:1-slim$/m);
    expect(runtime).not.toMatch(/^node:/m);
    expect(runtime).toContain("COPY --from=frontend /app/dist ./web/dist");
    expect(runtime).toContain('CMD ["roost"]');
  });

  it("rust+svelte gets a default /healthz HEALTHCHECK and a serving harness", async () => {
    // No healthcheck declared: because the harness now serves /healthz,
    // genproj declares one by default (exactly as a node project defaults to
    // /health). The Dockerfile promise and the scaffolded server are emitted
    // together, so the smoke gate is green without a declared command.
    const { find } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "svelte", "docker-container"],
      { language: "rust" },
      "roost",
    );
    const dockerfile = find("Dockerfile");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain(
      "CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1",
    );
    expect(find("src/main.rs")).toContain(
      'const HEALTH_PATH: &str = "/healthz"',
    );
  });

  it("python+svelte gets the same harness in __main__.py", async () => {
    const { find } = await renderFiles(
      [
        "devcontainer-python",
        "devcontainer-node",
        "svelte",
        "docker-container",
      ],
      { language: "python" },
      "pyproj",
    );
    const mainPy = find("src/pyproj/__main__.py");
    expect(mainPy).toContain("ThreadingHTTPServer");
    expect(mainPy).toContain('"0.0.0.0"');
    expect(mainPy).toContain('HEALTH_PATH = "/healthz"');
    expect(mainPy).toContain('STATIC_DIR = Path("web/dist")');
    // The Python runtime image serves with curl, like any non-node image.
    expect(find("Dockerfile")).toContain(
      "CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1",
    );
  });

  it("python+svelte with a custom entry point owns its server: no harness, no promise", async () => {
    // The Python scaffold never clobbers an app-owned entry point, so where a
    // command is declared there is no harness - and therefore no default
    // healthcheck promising /healthz.
    const { find } = await renderFiles(
      [
        "devcontainer-python",
        "devcontainer-node",
        "svelte",
        "docker-container",
      ],
      {
        language: "python",
        "docker-container": { command: ["uvicorn", "app:app"] },
      },
      "pyproj",
    );
    expect(find("src/pyproj/__main__.py")).toBeUndefined();
    expect(find("Dockerfile")).not.toContain("HEALTHCHECK");
  });

  it("a non-node project with no frontend keeps the placeholder and no HEALTHCHECK", async () => {
    const { find } = await renderFiles(
      ["devcontainer-rust", "docker-container"],
      { language: "rust" },
      "plainrust",
    );
    expect(find("src/main.rs")).toContain("is running.");
    expect(find("Dockerfile")).not.toContain("HEALTHCHECK");
  });

  it("node+sveltekit is unchanged: node runtime, node build CMD", async () => {
    const { find } = await renderFiles([
      "devcontainer-node",
      "sveltekit",
      "docker-container",
    ]);
    const runtime = runtimeStage(find("Dockerfile"));
    expect(runtime).toMatch(/^node:22-slim$/m);
    expect(runtime).toContain('CMD ["node", "build/index.js"]');
  });

  it("pure rust (no frontend) is unchanged: rust runtime, rust binary CMD", async () => {
    const { find } = await renderFiles([
      "devcontainer-rust",
      "docker-container",
    ]);
    const runtime = runtimeStage(find("Dockerfile"));
    expect(runtime).toMatch(/^rust:1-slim$/m);
    expect(runtime).toContain('CMD ["demo"]');
    expect(runtime).not.toContain("node");
  });

  it("a declared command still overrides the default entry point", async () => {
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

describe("SvelteKit's adapter follows the primary language", () => {
  it("rust+sveltekit uses adapter-static, not adapter-node", async () => {
    const { find } = await renderFiles(
      [
        "devcontainer-rust",
        "devcontainer-node",
        "sveltekit",
        "docker-container",
      ],
      { language: "rust" },
    );
    const svelteConfig = find("web/svelte.config.js");
    expect(svelteConfig).toContain("@sveltejs/adapter-static");
    expect(svelteConfig).not.toContain("@sveltejs/adapter-node");

    const pkg = JSON.parse(find("web/package.json"));
    expect(pkg.devDependencies).toHaveProperty("@sveltejs/adapter-static");
    expect(pkg.devDependencies).not.toHaveProperty("@sveltejs/adapter-node");

    // adapter-static needs a prerenderable app.
    expect(find("web/src/routes/+layout.js")).toContain(
      "export const prerender = true;",
    );
  });

  it("node+sveltekit keeps adapter-node for docker", async () => {
    const { find } = await renderFiles([
      "devcontainer-node",
      "sveltekit",
      "docker-container",
    ]);
    expect(find("svelte.config.js")).toContain("@sveltejs/adapter-node");
    expect(find("svelte.config.js")).not.toContain("@sveltejs/adapter-static");
  });

  it("node+sveltekit without docker keeps adapter-auto", async () => {
    const { find } = await renderFiles(["devcontainer-node", "sveltekit"]);
    expect(find("svelte.config.js")).toContain("@sveltejs/adapter-auto");
  });
});

describe("adding the svelte dependency does not change a node SvelteKit project", () => {
  const map = (files) =>
    new Map(files.map((file) => [file.filePath, file.content]));

  it("is byte-identical with and without `svelte` explicitly selected", async () => {
    const withoutSvelte = await generateAllFiles({
      projectName: "pshelf",
      capabilities: ["devcontainer-node", "sveltekit", "docker-container"],
      configuration: {},
      registryNamespace: "OWNER",
    });
    const withSvelte = await generateAllFiles({
      projectName: "pshelf",
      capabilities: [
        "devcontainer-node",
        "sveltekit",
        "svelte",
        "docker-container",
      ],
      configuration: {},
      registryNamespace: "OWNER",
    });
    expect(map(withSvelte)).toEqual(map(withoutSvelte));
  });

  it("does not read as two frameworks in the README", async () => {
    const { find } = await renderFiles([
      "devcontainer-node",
      "sveltekit",
      "svelte",
    ]);
    const readme = find("README.md");
    expect(readme).toContain("**SvelteKit**");
    // Svelte is implied by SvelteKit and is not listed as a separate choice.
    expect(readme).not.toMatch(/^- \*\*Svelte\*\*:/m);
  });
});

describe("the emitter's file precedence is deterministic", () => {
  const permutations = (ids) => {
    const results = [];
    const permute = (rest, acc) => {
      if (rest.length === 0) {
        results.push(acc);
        return;
      }
      for (let i = 0; i < rest.length; i += 1) {
        permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
      }
    };
    permute(ids, []);
    return results;
  };

  it("svelte writes the base and sveltekit overwrites, in every selection order", async () => {
    const ids = [
      "devcontainer-rust",
      "devcontainer-node",
      "sveltekit",
      "svelte",
    ];
    const orders = permutations(ids);
    expect(orders.length).toBe(24);

    for (const order of orders) {
      const { files } = await renderFiles(order, { language: "rust" });
      const svelteConfigs = files.filter(
        (f) => f.filePath === "web/svelte.config.js",
      );
      // Exactly one file per path after the last-wins dedupe.
      expect(svelteConfigs).toHaveLength(1);
      // And it is SvelteKit's (the superset), never the plain-Svelte base.
      expect(svelteConfigs[0].content).toContain("@sveltejs/adapter-static");
      expect(svelteConfigs[0].content).not.toContain("vitePreprocess");
    }
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
