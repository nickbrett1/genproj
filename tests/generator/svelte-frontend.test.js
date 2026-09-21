import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * The `svelte` capability: a Svelte 5 + Vite frontend built to STATIC assets.
 *
 * Frontend only — no adapter, no `routes/`, no `+server.js`, no server of any
 * kind. In a non-node project it is scaffolded into its own `web/` directory and
 * the primary language's server serves the output. Selecting `sveltekit` forces
 * `svelte` on (it is a superset), and the emitter's last-wins precedence lets
 * SvelteKit override the base files.
 */

async function renderFiles(
  capabilities,
  configuration = {},
  projectName = "demo",
) {
  const files = await generateAllFiles({
    projectName,
    capabilities,
    configuration,
    registryNamespace: "OWNER",
  });
  const find = (p) => files.find((f) => f.filePath === p)?.content;
  return { find, files };
}

describe("the svelte capability scaffolds a static frontend into web/", () => {
  it("rust+svelte scaffolds into web/, never into the Rust src/", async () => {
    const { files } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "svelte"],
      { language: "rust" },
      "roost",
    );
    const paths = files.map((f) => f.filePath);

    expect(paths).toContain("web/index.html");
    expect(paths).toContain("web/src/main.js");
    expect(paths).toContain("web/src/App.svelte");
    expect(paths).toContain("web/svelte.config.js");
    expect(paths).toContain("web/vite.config.js");
    expect(paths).toContain("web/package.json");
    expect(paths).toContain("web/README.md");
    // The Rust source tree is untouched.
    expect(paths).toContain("src/main.rs");
    expect(paths).not.toContain("src/main.js");
    expect(paths).not.toContain("index.html");
    expect(paths).not.toContain("package.json");
  });

  it("has no adapter, no routes/ and no server of any kind", async () => {
    const { find, files } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "svelte"],
      { language: "rust" },
    );
    const paths = files.map((f) => f.filePath);
    expect(paths.some((p) => p.includes("routes/"))).toBe(false);
    expect(paths).not.toContain("web/src/routes/+page.svelte");
    expect(paths).not.toContain("web/src/app.html");
    expect(paths).not.toContain("web/src/routes/health/+server.js");

    // svelte.config.js is the vitePreprocess base, with no adapter import.
    const svelteConfig = find("web/svelte.config.js");
    expect(svelteConfig).toContain("vitePreprocess");
    expect(svelteConfig).not.toContain("adapter");
    expect(svelteConfig).not.toContain("@sveltejs/kit");

    // vite.config.js is plain Vite + the svelte plugin, not the kit plugin.
    const viteConfig = find("web/vite.config.js");
    expect(viteConfig).toContain("@sveltejs/vite-plugin-svelte");
    expect(viteConfig).not.toContain("@sveltejs/kit");
  });

  it("builds to static assets (vite build) and documents the serving seam", async () => {
    const { find } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "svelte"],
      { language: "rust" },
    );
    const pkg = JSON.parse(find("web/package.json"));
    expect(pkg.scripts.build).toBe("vite build");
    expect(pkg.devDependencies).toHaveProperty("svelte");
    expect(pkg.devDependencies).toHaveProperty("@sveltejs/vite-plugin-svelte");
    expect(pkg.devDependencies).not.toHaveProperty("@sveltejs/kit");
    expect(pkg.devDependencies).not.toHaveProperty("@sveltejs/adapter-static");

    const readme = find("web/README.md");
    // The README names the static output and that the language server owns /healthz.
    expect(readme).toContain("web/dist");
    expect(readme).toContain("/healthz");
    expect(readme).toContain("no Node runtime");
  });

  it("honours an explicit svelte.directory / outputDirectory override", async () => {
    const { files } = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "svelte"],
      {
        language: "rust",
        svelte: { directory: "frontend", outputDirectory: "public" },
      },
    );
    const paths = files.map((f) => f.filePath);
    expect(paths).toContain("frontend/index.html");
    expect(paths).toContain("frontend/src/App.svelte");
  });

  it("defaults a node-primary Svelte app to the repository root", async () => {
    const { files } = await renderFiles(["devcontainer-node", "svelte"]);
    const paths = files.map((f) => f.filePath);
    expect(paths).toContain("index.html");
    expect(paths).toContain("package.json");
    expect(paths).not.toContain("web/index.html");
  });
});
