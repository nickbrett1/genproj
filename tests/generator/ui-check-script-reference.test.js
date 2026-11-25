import { describe, it, expect } from "vitest";
import path from "node:path";
import { generateAllFiles } from "../../src/generator/file-generator.js";

/**
 * Regression: `scripts/ui-check.mjs` is a root-level project tool and does not
 * move with the frontend, but `package.json` does. In a non-node-primary
 * project the whole Svelte app — manifest included — is relocated into `web/`,
 * so a `check:ui` written as `node scripts/ui-check.mjs` resolved to
 * `web/scripts/ui-check.mjs`, which is never generated.
 *
 * The manifest's reference is therefore derived from the same predicate the
 * relocation uses (`sveltePrefix(context)`), not copied from the root case.
 * These tests assert the reference RESOLVES to a generated file, because a
 * string match on `../` would pass even if the script lived somewhere else.
 */

async function renderFiles(capabilities, configuration, projectName = "demo") {
  const files = await generateAllFiles({
    projectName,
    capabilities,
    configuration,
    registryNamespace: "OWNER",
  });
  return {
    files,
    paths: files.map((f) => f.filePath),
    find: (p) => files.find((f) => f.filePath === p)?.content,
  };
}

/** The script path a manifest's `check:ui` entry invokes (after `node `). */
function checkUiScript(pkgContent) {
  const pkg = JSON.parse(pkgContent);
  const command = pkg.scripts?.["check:ui"];
  expect(command, "check:ui script is missing from the manifest").toBeTruthy();
  const match = /^node\s+(.+)$/.exec(command);
  expect(match, `unexpected check:ui command: ${command}`).not.toBeNull();
  return match[1];
}

function expectResolvesToGeneratedFile({ find, paths }, manifestPath) {
  const target = checkUiScript(find(manifestPath));
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(manifestPath), target),
  );
  expect(
    paths,
    `check:ui in ${manifestPath} resolves to ${resolved}`,
  ).toContain(resolved);
  return { target, resolved };
}

describe("check:ui points at the root ui-check script from wherever the manifest is", () => {
  it("node-primary SvelteKit keeps the manifest at root and the plain path", async () => {
    const rendered = await renderFiles(["devcontainer-node", "sveltekit"], {
      language: "node",
    });
    const { target, resolved } = expectResolvesToGeneratedFile(
      rendered,
      "package.json",
    );
    expect(target).toBe("scripts/ui-check.mjs");
    expect(resolved).toBe("scripts/ui-check.mjs");
    expect(rendered.paths).not.toContain("web/scripts/ui-check.mjs");
  });

  it("non-node + relocated manifest references ../scripts/ui-check.mjs, which exists", async () => {
    const rendered = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "sveltekit"],
      { language: "rust" },
      "roost",
    );

    // (a) the script is at the repository root and NOT under web/.
    expect(rendered.paths).toContain("scripts/ui-check.mjs");
    expect(rendered.paths).not.toContain("web/scripts/ui-check.mjs");
    expect(rendered.paths).toContain("web/package.json");
    expect(rendered.paths).not.toContain("package.json");

    // (b) the emitted string resolves to that real file from web/.
    const { target, resolved } = expectResolvesToGeneratedFile(
      rendered,
      "web/package.json",
    );
    expect(target).toBe("../scripts/ui-check.mjs");
    expect(resolved).toBe("scripts/ui-check.mjs");
  });

  it("plain svelte (non-SvelteKit) in a non-node project gets the same relative path", async () => {
    const rendered = await renderFiles(
      ["devcontainer-rust", "devcontainer-node", "svelte"],
      { language: "rust" },
      "roost",
    );
    const { target, resolved } = expectResolvesToGeneratedFile(
      rendered,
      "web/package.json",
    );
    expect(target).toBe("../scripts/ui-check.mjs");
    expect(resolved).toBe("scripts/ui-check.mjs");
    expect(rendered.paths).not.toContain("web/scripts/ui-check.mjs");
  });
});
