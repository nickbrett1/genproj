// tests/generator/ui-shadcn.test.js

/**
 * `ui-shadcn` — the capability that makes a generated SvelteKit project
 * consume the house design system instead of re-deriving it (spec 026).
 *
 * What these tests pin:
 *
 * 1. Off by default: a project generated without `ui-shadcn` is unchanged —
 *    no `components.json`, no Tailwind dependency, no Vite plugin.
 * 2. On, the wiring is real: Tailwind v4 through the Vite plugin, the
 *    primitives' `cn()` helper, `components.json` pinned to a version that the
 *    registry serves, and the token literal `${NB_REGISTRY_TOKEN}` left for the
 *    CLI to expand (never a secret written into git).
 * 3. The theme's CONTENT is absent on purpose. `src/nb-theme.css` is a
 *    placeholder, so `npm run build` succeeds and the project does not carry a
 *    hand-copied token sheet - the drift this capability exists to end.
 * 4. An empty `registryUrl` produces an honest, unresolvable placeholder plus a
 *    documented "the block is inert" statement, not a guessed host.
 */

import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import { resolveDependencies } from "../../src/generator/capability-resolver.js";

async function render(capabilities, ui = {}, projectName = "demo") {
  const files = await generateAllFiles({
    projectName,
    description: "ui-shadcn fixture",
    capabilities,
    configuration: { "ui-shadcn": ui },
    registryNamespace: "OWNER",
  });
  const find = (path) => files.find((f) => f.filePath === path)?.content;
  return { files, find };
}

const BASE = ["devcontainer-node", "sveltekit"];

describe("ui-shadcn: absent unless selected", () => {
  it("emits no design-system files and no Tailwind wiring", async () => {
    const { find } = await render(BASE);

    expect(find("components.json")).toBeUndefined();
    expect(find("src/app.css")).toBeUndefined();
    expect(find("src/nb-theme.css")).toBeUndefined();
    expect(find("src/lib/utils.ts")).toBeUndefined();

    const pkg = JSON.parse(find("package.json"));
    expect(pkg.devDependencies).not.toHaveProperty("tailwindcss");
    expect(pkg.devDependencies).not.toHaveProperty("@tailwindcss/vite");

    expect(find("vite.config.js")).not.toContain("@tailwindcss/vite");
  });
});

describe("ui-shadcn: components.json", () => {
  it("pins the theme version and leaves the token to the CLI", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const components = JSON.parse(find("components.json"));
    const registry = components.registries["@nb"];

    expect(registry.params).toEqual({ version: "1.0.0" });
    // A literal, not a resolved value: `${VAR}` expansion is the CLI's job at
    // `shadcn add` time. Interpolating it here would put a live token in git.
    expect(registry.headers.Authorization).toBe("Bearer ${NB_REGISTRY_TOKEN}");
    // `{name}.json` + `params.version` is the only item shape the registry
    // answers: unversioned requests are a 400 by design.
    expect(registry.url).toContain("{name}.json");
    expect(components.typescript).toBe(true);
    expect(components.tailwind.css).toBe("src/app.css");
  });

  it("honours a configured registry URL and strips a trailing slash", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: "http://ryzen:3012/r/",
      themeVersion: "1.2.3",
    });

    const registry = JSON.parse(find("components.json")).registries["@nb"];
    expect(registry.url).toBe("http://ryzen:3012/r/{name}.json");
    expect(registry.params.version).toBe("1.2.3");
  });

  it("uses an unresolvable placeholder when no registry URL is given", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const registry = JSON.parse(find("components.json")).registries["@nb"];
    // `.invalid` is reserved (RFC 2606): it can never resolve, so an
    // unconfigured project fails loudly rather than fetching from a guess.
    expect(registry.url).toBe("https://registry.invalid/r/{name}.json");
  });

  it("documents that the block is inert when the URL is unset", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).toContain("registry block is inert");
    expect(find("src/nb-theme.css")).toContain("placeholder URL");
  });

  it("does not claim the block is inert once a URL is configured", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: "http://ryzen:3012/r",
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).not.toContain("registry block is inert");
    expect(find("src/nb-theme.css")).not.toContain("placeholder URL");
  });
});

describe("ui-shadcn: the theme is installed, not copied", () => {
  it("imports Tailwind and the theme without carrying any token", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const appCss = find("src/app.css");
    expect(appCss).toContain('@import "tailwindcss";');
    expect(appCss).toContain('@import "./nb-theme.css";');

    // The placeholder must not define the house tokens. A template copy of the
    // token sheet is exactly the drift the capability exists to stop.
    const placeholder = find("src/nb-theme.css");
    expect(placeholder).toContain("NOT the design system");
    expect(placeholder).not.toContain("--bg");
    expect(placeholder).not.toContain("#0f172a");
  });

  it("ships the cn() helper the primitives import", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const utils = find("src/lib/utils.ts");
    expect(utils).toContain('from "clsx"');
    expect(utils).toContain('from "tailwind-merge"');
    expect(utils).toContain("export function cn(");
  });
});

describe("ui-shadcn: dependencies and build wiring", () => {
  it("adds Tailwind v4 and the utilities to the manifest", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const pkg = JSON.parse(find("package.json"));
    expect(pkg.devDependencies).toHaveProperty("tailwindcss");
    expect(pkg.devDependencies).toHaveProperty("@tailwindcss/vite");
    expect(pkg.devDependencies).toHaveProperty("clsx");
    expect(pkg.devDependencies).toHaveProperty("tailwind-merge");
    expect(pkg.devDependencies).toHaveProperty("tailwind-variants");
  });

  it("registers the Tailwind Vite plugin", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const vite = find("vite.config.js");
    expect(vite).toContain('import tailwindcss from "@tailwindcss/vite";');
    expect(vite).toContain("tailwindcss()");
  });

  it("resolves sveltekit and doppler as dependencies", () => {
    const { resolvedCapabilities } = resolveDependencies(["ui-shadcn"]);

    expect(resolvedCapabilities).toContain("sveltekit");
    expect(resolvedCapabilities).toContain("doppler");
  });

  it("relocates with a non-node frontend rather than landing at the root", async () => {
    const { files, find } = await render(
      ["devcontainer-rust", "sveltekit", "ui-shadcn"],
      {},
      "rust-demo",
    );

    // The frontend is a sub-build under web/, so its stylesheet, components
    // manifest and helper must move with it - a root-level src/app.css would be
    // read by nothing.
    expect(find("web/components.json")).toBeDefined();
    expect(find("web/src/app.css")).toBeDefined();
    expect(find("web/src/nb-theme.css")).toBeDefined();
    expect(find("web/src/lib/utils.ts")).toBeDefined();
    expect(find("components.json")).toBeUndefined();
    // Agent rules are repo-level, not frontend-level.
    expect(
      files.find((f) => f.filePath === ".agents/.rules/styling_guidelines.md"),
    ).toBeDefined();
  });
});
