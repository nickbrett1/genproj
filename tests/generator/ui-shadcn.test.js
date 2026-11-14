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
 *    primitives' `cn()` helper, and a `components.json` the Svelte CLI actually
 *    reads. It carries NO `registries` block: that is React-CLI syntax, and
 *    `shadcn-svelte` takes its base from `COMPONENTS_REGISTRY_URL` used
 *    verbatim, so the version lives in that URL. Asserted by absence, because
 *    dead config reads as a working pin.
 * 3. The theme's CONTENT is absent on purpose, and there is no placeholder
 *    file either. `@nb/theme` is a `registry:theme` item whose `cssVars` and
 *    `css` the CLI merges into the project's own `src/app.css`, so the
 *    scaffold emits no `nb-theme.css` and no import of one - the drift this
 *    capability exists to end.
 * 4. The styling rules carry the one command that works, as proven by the
 *    registry's own CLI contract test: `COMPONENTS_REGISTRY_URL=<base>/v<version>
 *    npx shadcn-svelte@1.8.1 add theme --yes --overwrite`. `--overwrite` is not
 *    cosmetic - without it the CLI exits 0 having written nothing. An empty
 *    `registryUrl` falls back to resolving the same variable from Doppler, never
 *    to a guessed host.
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
    expect(find("tsconfig.json")).toBeUndefined();
    expect(find("src/routes/+layout.svelte")).toBeUndefined();
    expect(find("src/nb-theme.css")).toBeUndefined();
    expect(find("src/lib/utils.ts")).toBeUndefined();

    const pkg = JSON.parse(find("package.json"));
    expect(pkg.devDependencies).not.toHaveProperty("tailwindcss");
    expect(pkg.devDependencies).not.toHaveProperty("@tailwindcss/vite");

    expect(find("vite.config.js")).not.toContain("@tailwindcss/vite");
  });
});

describe("ui-shadcn: components.json", () => {
  it("emits a components.json the Svelte CLI reads, and no registries block", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const components = JSON.parse(find("components.json"));

    // Absence, asserted. `registries` / `headers` / `params.version` is
    // shadcn/ui (React) syntax: shadcn-svelte@1.8.1 implements none of it, so
    // emitting it produced a file that read as a working, pinned registry and
    // did nothing at all. Found by generating a project and running the CLI.
    expect(components).not.toHaveProperty("registries");
    expect(find("components.json")).not.toContain("NB_REGISTRY_TOKEN");

    expect(components.typescript).toBe(true);
    expect(components.tailwind.css).toBe("src/app.css");
    expect(components.aliases.components).toBe("$lib/components");
    // `new-york` is React-CLI vocabulary: the Svelte CLI prints "Unsupported
    // style ... Using nova instead" and substitutes, so the file claimed one
    // style and the install used another.
    expect(components.style).toBe("vega");
  });

  it("spells out the contract-tested install command when a URL is configured", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: "http://ryzen:3012/r/",
      themeVersion: "1.2.3",
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    // The version is a path segment of the base, because COMPONENTS_REGISTRY_URL
    // is used verbatim: the CLI appends nothing to it and cannot carry
    // `?version=`. The pinned CLI and `--overwrite` are part of the command,
    // not advice around it: `--yes` alone exits 0 having written nothing.
    expect(rules).toContain(
      "COMPONENTS_REGISTRY_URL=http://ryzen:3012/r/v1.2.3 npx shadcn-svelte@1.8.1 add theme --yes --overwrite",
    );
    expect(rules).toContain("registry items are immutable");
    expect(rules).not.toContain("@latest");
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

    // The version the rules name and the catalog default are one decision.
    // When they drift a project silently pins a version whose item shape this
    // scaffold does not target - it installs, and nothing says why the theme
    // landed somewhere else.
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: "http://ryzen:3012/r",
    });
    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).toContain(`/v${catalogDefault} npx shadcn-svelte@`);

    // 1.2.0 is the first version published as `cssVars` + `css` with no
    // `files[]`: what `shadcn-svelte@1.8.1` merges into src/app.css. 1.1.0
    // carried `target: src/nb-theme.css`, which the CLI resolved against the
    // basename of app.css used as a directory and wrote into a folder named
    // `app.css`; 1.0.0 targeted src/app.css.
    expect(catalogDefault).toBe("1.2.0");
  });

  it("resolves the base from Doppler when no registry URL is given", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const rules = find(".agents/.rules/styling_guidelines.md");
    // Not a guessed host and not an `.invalid` placeholder written into a config
    // file: the same variable a human reads, resolved at run time.
    expect(rules).toContain(
      'COMPONENTS_REGISTRY_URL="$(doppler secrets get COMPONENTS_REGISTRY_URL --project common --config dev --plain)" npx shadcn-svelte@1.8.1 add theme --yes --overwrite',
    );
    expect(rules).toContain(
      "`ui-shadcn.registryUrl` was empty at generation time",
    );
    expect(rules).not.toContain("registry.invalid");
    expect(rules).not.toContain("NB_REGISTRY_TOKEN");
  });

  it("says the same thing when a URL is configured", async () => {
    const { files, find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: "http://ryzen:3012/r",
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).not.toContain("was empty at generation time");
    expect(files.some((f) => f.filePath.includes("nb-theme"))).toBe(false);
  });
});

describe("ui-shadcn: the theme is merged, not copied", () => {
  it("emits the bare Tailwind entry and no theme stylesheet at all", async () => {
    const { files, find } = await render([...BASE, "ui-shadcn"]);

    const appCss = find("src/app.css");
    // Exactly the state `add theme` merges into: one import, no
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

  it("emits the tsconfig the CLI requires, with the $lib alias it resolves", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const tsconfig = JSON.parse(find("tsconfig.json"));
    // Without this file `add theme` dies with "Failed to find a tsconfig.json
    // file" - `components.json` says typescript: true, and the SvelteKit
    // scaffold genproj emits is JavaScript.
    expect(tsconfig.compilerOptions.paths["$lib"]).toEqual(["./src/lib"]);
    expect(tsconfig.compilerOptions.paths["$lib/*"]).toEqual(["./src/lib/*"]);
    // Self-contained on purpose: `extends ./.svelte-kit/tsconfig.json` does not
    // exist until kit has run, and the CLI reads this before any build.
    expect(find("tsconfig.json")).not.toContain(".svelte-kit/tsconfig.json");
    expect(tsconfig.compilerOptions.allowJs).toBe(true);
  });

  it("imports the stylesheet from a layout, because SvelteKit imports none", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const layout = find("src/routes/+layout.svelte");
    // Emitted and unreferenced `src/app.css` was the bug: the tokens installed
    // correctly and the built page was unstyled, because nothing imported it.
    expect(layout).toContain('import "../app.css";');
    expect(layout).toContain("{@render children()}");
  });

  it("relocates the layout and tsconfig with a non-node frontend", async () => {
    const { find } = await render(
      ["devcontainer-rust", "sveltekit", "ui-shadcn"],
      {},
      "rust-demo",
    );

    expect(find("web/tsconfig.json")).toBeDefined();
    expect(find("web/src/routes/+layout.svelte")).toContain(
      'import "../app.css";',
    );
    expect(find("tsconfig.json")).toBeUndefined();
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
    // Not a tool used once: installing the theme merges in
    // `@import "shadcn-svelte/tailwind.css";`, so the package has to be
    // present for the project's next build. Found by building a generated
    // project that had installed the theme.
    expect(pkg.devDependencies).toHaveProperty("shadcn-svelte");
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
