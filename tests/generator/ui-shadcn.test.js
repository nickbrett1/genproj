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
      'COMPONENTS_REGISTRY_URL="http://ryzen:3012/r/v1.2.3" npx shadcn-svelte@1.8.1 add theme --yes --overwrite',
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
    expect(rules).toContain(`/v${catalogDefault}" npx shadcn-svelte@`);

    // 1.2.0 is the first version published as `cssVars` + `css` with no
    // `files[]`: what `shadcn-svelte@1.8.1` merges into src/app.css. 1.10.1 is
    // where all eleven blocks live, at the same version as the theme, so a
    // project that installs blocks must not pin 1.2.0 - that base 404s on
    // `add app-shell`. 1.1.0 carried `target: src/nb-theme.css`, which the CLI
    // resolved against the basename of app.css used as a directory and wrote
    // into a folder named `app.css`; 1.0.0 targeted src/app.css.
    //
    // The patch matters as much as the minor: a version index is a *snapshot*
    // of the whole catalogue (ui-registry's lesson), so 1.10.0 and 1.10.1 were
    // only usable once every item was published into them - 1.11.0 included,
    // which shipped as an app-shell-only index and would have answered
    // "Registry item 'theme' does not exist" until the release filled it.
    // 1.10.1 carries app-shell's sticky-inset fix, so it is the floor; 1.11.0
    // adds `embedded`, which is what makes the blocks safe to use in a card.
    expect(catalogDefault).toBe("1.11.0");
  });

  it("resolves the base from Doppler when no registry URL is given", async () => {
    const { find } = await render([...BASE, "ui-shadcn"]);

    const rules = find(".agents/.rules/styling_guidelines.md");
    // Not a guessed host and not an `.invalid` placeholder written into a config
    // file: the same variable a human reads, resolved at run time -- with the
    // pin appended here rather than stored there.
    expect(rules).toContain(
      'COMPONENTS_REGISTRY_URL="$(doppler secrets get COMPONENTS_REGISTRY_URL --project common --config dev --plain)/v1.11.0" npx shadcn-svelte@1.8.1 add theme --yes --overwrite',
    );
    expect(rules).toContain(
      "`ui-shadcn.registryUrl` was empty at generation time",
    );
    expect(rules).not.toContain("registry.invalid");
    expect(rules).not.toContain("NB_REGISTRY_TOKEN");
  });

  it("treats the Doppler secret as a host, so the version is named once", async () => {
    // The regression this guards is a *shape*, not a string: a version inside
    // the secret would be a second copy of the pin, and the first one was moved
    // by hand twice in a day. The pin is appended outside the substitution, so
    // replacing the secret with a versioned URL cannot silently double it --
    // it produces `/v1.11.0/v1.11.0`, which 404s on the first install rather
    // than drifting out of step.
    const { find } = await render([...BASE, "ui-shadcn"], {
      blocks: ["app-shell"],
    });
    const rules = find(".agents/.rules/styling_guidelines.md");

    const substitutions = rules.match(/\$\(doppler secrets get[^)]*\)/g) || [];
    expect(substitutions.length).toBeGreaterThan(0);
    for (const substitution of substitutions) {
      expect(substitution).not.toMatch(/\/v\d+\.\d+\.\d+/);
    }
    // …and every command that uses one appends the pin immediately after it.
    for (const substitution of substitutions) {
      expect(rules).toContain(`${substitution}/v1.11.0`);
    }
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

describe("ui-shadcn: blocks are opt-in and pinned like the theme", () => {
  const BASE_URL = "http://ryzen:3012/r";

  it("emits one pinned add command per requested block", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: BASE_URL,
      blocks: ["app-shell", "result-list"],
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    // The same base as the theme: the version segment is the pin, and blocks
    // are published at that version rather than floating on latest.
    expect(rules).toContain(
      `COMPONENTS_REGISTRY_URL="${BASE_URL}/v1.11.0" npx shadcn-svelte@1.8.1 add app-shell --yes --overwrite`,
    );
    expect(rules).toContain(
      `COMPONENTS_REGISTRY_URL="${BASE_URL}/v1.11.0" npx shadcn-svelte@1.8.1 add result-list --yes --overwrite`,
    );
    // --yes is not a substitute for --overwrite: without it the CLI exits 0
    // having written nothing.
    expect(rules).toContain("add app-shell --yes --overwrite");
    // And the install target is alias-relative, which is the one thing the
    // registry's contract test had to teach us by running the CLI.
    expect(rules).toContain("$lib/components/nb/<Name>.svelte");
    // The wrong form appears only as the documented counter-example, never as
    // a command.
    expect(rules).not.toContain("add src/lib/components/nb/");
  });

  it("says nothing about blocks when none were requested", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: BASE_URL,
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).not.toContain("## Blocks");
    expect(rules).not.toContain("add app-shell");
  });

  it("drops an unknown block name and says which", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: BASE_URL,
      blocks: ["app-shell", "hero-banner"],
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).toContain("add app-shell --yes --overwrite");
    // An instruction to install a block that does not exist fails at the end
    // of a scaffold instead of at the start, so nothing is emitted for it.
    expect(rules).not.toContain("add hero-banner");
    expect(rules).toContain("`hero-banner`");
    expect(rules).toContain("dropped");
  });

  it("resolves the block base from Doppler when no registry URL is given", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      blocks: ["app-shell"],
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    expect(rules).toContain(
      'COMPONENTS_REGISTRY_URL="$(doppler secrets get COMPONENTS_REGISTRY_URL --project common --config dev --plain)/v1.11.0" npx shadcn-svelte@1.8.1 add app-shell --yes --overwrite',
    );
    expect(rules).not.toContain("registry.invalid");
  });
});

describe("ui-shadcn: browsing the catalogue is part of selecting from it", () => {
  const BASE_URL = "http://ryzen:3012/r";

  it("accepts every published block, including the chart and the table", async () => {
    const blocks = [
      "app-shell",
      "stat-strip",
      "result-list",
      "filter-panel",
      "empty-state",
      "status-view",
      "detail-panel",
      "burst-timeline",
      "bar-series",
      "data-table",
      "request-form",
    ];
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: BASE_URL,
      blocks,
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    for (const name of blocks) {
      expect(rules).toContain(`add ${name} --yes --overwrite`);
    }
    // Nothing was dropped, so the "does not exist" paragraph is absent - a
    // requested block the whitelist forgot used to fail silently here.
    expect(rules).not.toContain("does not exist");
  });

  it("points an agent at the version index before it writes markup", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: BASE_URL,
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    // The browse surface is the registry's own index, on the same pinned base
    // as the install commands: the CLI fetches it anyway, and each entry
    // carries the `title`/`description` that make it a catalogue rather than a
    // list of file names.
    expect(rules).toContain("## Finding a block");
    expect(rules).toContain(`curl -s "${BASE_URL}/v1.11.0/index.json"`);
    expect(rules).toContain('item["name"]');
    // Select: the same command as a requested block, with the name to be
    // chosen from the index.
    expect(rules).toContain(
      `COMPONENTS_REGISTRY_URL="${BASE_URL}/v1.11.0" npx shadcn-svelte@1.8.1 add <name> --yes --overwrite`,
    );
    // And the honest instruction for a genuine gap, because "install the
    // nearest block" is how a design system becomes a tax.
    expect(rules).toContain("If the block is not there");
  });

  it("does not claim a registry MCP server the CLI does not ship", async () => {
    const { find } = await render([...BASE, "ui-shadcn"], {
      registryUrl: BASE_URL,
      blocks: ["app-shell"],
    });

    const rules = find(".agents/.rules/styling_guidelines.md");
    // `shadcn-svelte@1.8.1 registry` has exactly one subcommand, `build`, and
    // the bundle has no MCP entry point (verified against the published CLI).
    // Pointing at one would be config that reads as working and does nothing -
    // the same defect class as a `registries` block in components.json.
    expect(rules).not.toContain("shadcn-svelte mcp");
    expect(rules).not.toMatch(/mcpServers/);
  });
});
