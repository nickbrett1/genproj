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
 * 3. The theme's CONTENT is absent on purpose, and there is no placeholder
 *    file either. `@nb/theme` is a `registry:theme` item whose `cssVars` and
 *    `css` the CLI merges into the project's own `src/app.css`, so the
 *    scaffold emits no `nb-theme.css` and no import of one - the drift this
 *    capability exists to end.
 * 4. An empty `registryUrl` produces an honest, unresolvable placeholder plus a
 *    documented "the block is inert" statement, not a guessed host.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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

    expect(registry.params).toEqual({ version: "1.2.0" });
    // A literal, not a resolved value: `${VAR}` expansion is the CLI's job at
    // `shadcn add` time. Interpolating it here would put a live token in git.
    expect(registry.headers.Authorization).toBe("Bearer ${NB_REGISTRY_TOKEN}");
    // `{name}.json` + `params.version` is the only item shape the registry
    // answers: unversioned requests are a 400 by design.
    expect(registry.url).toContain("{name}.json");
    expect(components.typescript).toBe(true);
    expect(components.tailwind.css).toBe("src/app.css");
  });

  it("pins the catalog's default version and says so in the rules", async () => {
    const catalog = JSON.parse(
      readFileSync(
        new URL("../../src/catalog/catalog.json", import.meta.url),
        "utf8",
      ),
    );
    const entry = catalog.capabilities.find((c) => c.id === "ui-shadcn");
    const catalogDefault =
      entry.configurationSchema.properties.themeVersion.default;

    // The emitted pin and the catalog default are one decision. When they drift
    // a project silently pins a version whose item shape this scaffold does not
    // target - it installs, and nothing says why the theme landed elsewhere.
    const { find } = await render([...BASE, "ui-shadcn"]);
    const registry = JSON.parse(find("components.json")).registries["@nb"];
    expect(registry.params.version).toBe(catalogDefault);

    // 1.2.0 is the first version published as `cssVars` + `css` with no
    // `files[]`: what `shadcn-svelte@1.8.1` merges into src/app.css. 1.1.0
    // carried `target: src/nb-theme.css`, which the CLI resolved against the
    // basename of app.css used as a directory and wrote into a folder named
    // `app.css`; 1.0.0 targeted src/app.css.
    expect(catalogDefault).toBe("1.2.0");
    expect(find(".agents/.rules/styling_guidelines.md")).toContain(
      "`@nb/theme` at `1.2.0`",
    );
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
    const { files, find } = await render([...BASE, "ui-shadcn"]);

    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).toContain("registry block is inert");
    // Inverted from the file-and-import model: there is no placeholder to
    // carry the warning, because a theme item has no install path at all.
    expect(files.some((f) => f.filePath.includes("nb-theme"))).toBe(false);
  });

  it("does not claim the block is inert once a URL is configured", async () => {
    const { files, find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: "http://ryzen:3012/r",
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).not.toContain("registry block is inert");
    expect(files.some((f) => f.filePath.includes("nb-theme"))).toBe(false);
  });
});

describe("ui-shadcn: the theme is merged, not copied", () => {
  it("emits the bare Tailwind entry and no theme stylesheet at all", async () => {
    const { files, find } = await render([...BASE, "ui-shadcn"]);

    const appCss = find("src/app.css");
    // Exactly the state `shadcn add @nb/theme` merges into: one import, no
    // second stylesheet, no import line naming one.
    expect(appCss).toBe('@import "tailwindcss";\n');
    expect(appCss).not.toContain("nb-theme");

    // The placeholder is gone: v1.2.0's item carries `cssVars` + `css`, so
    // emitting a file at all would be a path the CLI never writes.
    expect(find("src/nb-theme.css")).toBeUndefined();
    expect(files.some((f) => f.filePath.includes("nb-theme"))).toBe(false);
    // And no emitted file may smuggle a token literal into the project.
    expect(files.map((f) => f.content).join("\n")).not.toContain("#0f172a");
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
    // No theme stylesheet relocates, because none is emitted at all.
    expect(find("web/src/nb-theme.css")).toBeUndefined();
    expect(find("web/src/lib/utils.ts")).toBeDefined();
    expect(find("components.json")).toBeUndefined();
    // Agent rules are repo-level, not frontend-level.
    expect(
      files.find((f) => f.filePath === ".agents/.rules/styling_guidelines.md"),
    ).toBeDefined();
  });
});
