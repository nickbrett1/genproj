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

/**
 * The NEGATIVE of the same contract: a project with no frontend capability must
 * not gain the UI gate at all — no `scripts/ui-check.mjs`, and no manifest
 * anywhere carrying a `check:ui` entry.
 *
 * This is asserted by scanning the emitted file set rather than matching one
 * hardcoded path, because the value being guarded is "no manifest anywhere
 * references a UI check". A future relocation (the `web/` move already proves
 * manifests move without being renamed) must not be able to satisfy a
 * path-shaped assertion while still shipping a dangling `check:ui`.
 *
 * Shapes covered, chosen because each could plausibly acquire a frontend later:
 *   - shell primary, shell-shaped capabilities, no devcontainer-* at all;
 *   - shell primary + docker-container (a deployment capability, and the one
 *     most likely to drag in a manifest);
 *   - a non-node primary language with no frontend (devcontainer-python), which
 *     separates "non-node" from "non-node WITH a frontend" — the latter is the
 *     relocated-manifest case above, and gets `../scripts/ui-check.mjs`.
 */
function manifestsWithCheckUi({ files, paths }) {
  return paths
    .filter((p) => p.endsWith("package.json"))
    .map((p) => ({
      path: p,
      content: files.find((f) => f.filePath === p)?.content,
    }))
    .filter(({ content }) => {
      const pkg = JSON.parse(content);
      return pkg.scripts?.["check:ui"] !== undefined;
    })
    .map(({ path: manifestPath }) => manifestPath);
}

function expectNoUiCheck(rendered, label) {
  const uiCheckScripts = rendered.paths.filter((p) =>
    p.endsWith("scripts/ui-check.mjs"),
  );
  expect(
    uiCheckScripts,
    `${label}: a project with no frontend emitted a ui-check script`,
  ).toEqual([]);
  // Named explicitly as well, so the failure output says which path appeared
  // even if the suffix scan is ever narrowed.
  expect(rendered.paths).not.toContain("scripts/ui-check.mjs");
  expect(rendered.paths).not.toContain("web/scripts/ui-check.mjs");

  expect(
    manifestsWithCheckUi(rendered),
    `${label}: a manifest carries check:ui but there is no frontend`,
  ).toEqual([]);

  // The current truth for these shapes: there is no package.json at all, at
  // any depth. If a manifest is ever legitimately introduced (a JS tool, say)
  // this assertion is what should start the conversation, not the scan above —
  // the scan is the contract, this is the present fact.
  const manifests = rendered.paths.filter((p) => p.endsWith("package.json"));
  expect(
    manifests,
    `${label}: unexpected manifest(s) in a no-frontend project`,
  ).toEqual([]);
}

describe("a project with no frontend gets neither ui-check nor check:ui", () => {
  it("shell primary, shell-shaped capabilities, no devcontainer-*", async () => {
    const rendered = await renderFiles(
      [
        "docker",
        "coding-agents",
        "container-agent",
        "code-quality-shell",
        "buildkite",
      ],
      { language: "shell" },
    );
    expect(rendered.paths).toContain(".devcontainer/devcontainer.json");
    expectNoUiCheck(rendered, "shell, no devcontainer");
  });

  it("shell primary + docker-container still gets neither", async () => {
    // validateShellLanguage requires an entrypoint or command for a shell
    // image: there is no language default to derive. The point of this shape
    // is that a *deployment* capability does not imply a frontend.
    const rendered = await renderFiles(
      [
        "docker",
        "coding-agents",
        "container-agent",
        "code-quality-shell",
        "buildkite",
        "docker-container",
      ],
      {
        language: "shell",
        "docker-container": { command: ["/usr/local/bin/entrypoint.sh"] },
      },
    );
    expectNoUiCheck(rendered, "shell + docker-container");
  });

  it("non-node primary (python) with no frontend gets neither", async () => {
    const rendered = await renderFiles(["devcontainer-python"], {
      language: "python",
    });
    expect(rendered.paths).toContain("pyproject.toml");
    expectNoUiCheck(rendered, "python, no frontend");

    // Contrast with the relocated-manifest case above: adding the frontend is
    // what brings the script and the entry, not the primary language.
    const withFrontend = await renderFiles(
      ["devcontainer-python", "devcontainer-node", "sveltekit"],
      { language: "python" },
    );
    expect(withFrontend.paths).toContain("web/package.json");
    expect(withFrontend.paths).toContain("scripts/ui-check.mjs");
    expect(
      manifestsWithCheckUi(withFrontend),
      "the control shape should carry check:ui",
    ).toEqual(["web/package.json"]);
  });
});
