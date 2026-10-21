// tests/generator/shell-language.test.js

/**
 * Spec 022, slice 2: `language: "shell"`.
 *
 * A shell project is a script repo: the deliverable is `scripts/<name>` plus
 * pinned CLI tools, with no application build. Before this, such a project had
 * to lie about its language, and both lies were hard failures:
 *
 * - `node` (the old fallback) emits `COPY package.json ...` and dies on the
 *   first `docker build` ("no source files were specified");
 * - `python` builds but its CI starts with an unconditional
 *   `pip install -e ".[dev]"`, so the first push is red.
 *
 * These tests pin the three things `shell` must get right: a single-stage
 * Dockerfile, CI that is green on a repo containing only `scripts/*.sh`, and a
 * declared entry point (there is no binary name to guess).
 */

import { describe, it, expect } from "vitest";

import { generateAllFiles } from "../../src/generator/file-generator.js";
import { resolveProjectLanguage } from "../../src/generator/capability-template-utils.js";
import { validateShellLanguage } from "../../src/generator/project-validation.js";
import { ValidationError } from "../../src/generator/genproj-errors.js";

const CONTEXT = {
  projectName: "ryzen-backup",
  description: "backup runner",
  registryNamespace: "nickbrett1",
  configuration: { language: "shell" },
};

async function generate(capabilities, dockerConfig = {}) {
  const files = await generateAllFiles({
    ...CONTEXT,
    capabilities: ["docker-container", ...capabilities],
    configuration: {
      ...CONTEXT.configuration,
      "docker-container": dockerConfig,
    },
  });
  return {
    files,
    get: (path) => files.find((f) => f.filePath === path),
  };
}

describe("resolveProjectLanguage: shell", () => {
  it("accepts shell instead of falling back to node", () => {
    expect(
      resolveProjectLanguage({ configuration: { language: "shell" } }),
    ).toBe("shell");
  });

  it("is case/whitespace insensitive like the other languages", () => {
    expect(
      resolveProjectLanguage({
        configuration: { "docker-container": { language: " Shell " } },
      }),
    ).toBe("shell");
  });
});

describe("shell + docker-container", () => {
  const BATCH = {
    workload: "batch",
    command: ["/usr/local/bin/backup.sh"],
    aptPackages: ["restic"],
  };

  it("emits a SINGLE-STAGE Dockerfile", async () => {
    const dockerfile = (await generate(["buildkite"], BATCH)).get(
      "Dockerfile",
    ).content;
    expect(dockerfile.match(/^FROM /gm)).toHaveLength(1);
    expect(dockerfile).not.toContain("AS build");
    expect(dockerfile).not.toContain("COPY --from=");
  });

  it("uses a glibc Debian base image", async () => {
    const dockerfile = (await generate(["buildkite"], BATCH)).get(
      "Dockerfile",
    ).content;
    expect(dockerfile).toContain("FROM debian:bookworm-slim");
    expect(dockerfile).not.toContain("alpine");
  });

  it("honours baseImage as an override", async () => {
    const dockerfile = (
      await generate(["buildkite"], {
        ...BATCH,
        baseImage: "debian:trixie-slim",
      })
    ).get("Dockerfile").content;
    expect(dockerfile).toContain("FROM debian:trixie-slim");
  });

  it("keeps aptPackages in the image", async () => {
    const dockerfile = (await generate(["buildkite"], BATCH)).get(
      "Dockerfile",
    ).content;
    expect(dockerfile).toContain(
      "apt-get install -y --no-install-recommends restic",
    );
  });

  it("copies and chmods the declared script", async () => {
    const dockerfile = (await generate(["buildkite"], BATCH)).get(
      "Dockerfile",
    ).content;
    expect(dockerfile).toContain(
      "COPY scripts/backup.sh /usr/local/bin/backup.sh",
    );
    expect(dockerfile).toContain("RUN chmod +x /usr/local/bin/backup.sh");
    expect(dockerfile).toContain('CMD ["/usr/local/bin/backup.sh"]');
  });

  it("emits no EXPOSE/HEALTHCHECK for a batch job", async () => {
    const dockerfile = (await generate(["buildkite"], BATCH)).get(
      "Dockerfile",
    ).content;
    expect(dockerfile).not.toContain("EXPOSE");
    expect(dockerfile).not.toContain("HEALTHCHECK");
  });
});

describe("shell CI is green on a scripts-only repo", () => {
  it("buildkite: says there is nothing to build instead of running npm/pytest", async () => {
    const pipeline = (
      await generate(["buildkite"], {
        workload: "batch",
        command: ["/usr/local/bin/backup.sh"],
      })
    ).get(".buildkite/pipeline.yml").content;

    expect(pipeline).toContain(
      "Nothing to build: a shell project ships scripts",
    );
    expect(pipeline).toContain('image: "debian:bookworm-slim"');
    expect(pipeline).not.toContain("npm ci");
    expect(pipeline).not.toContain("pytest");
    expect(pipeline).not.toContain('pip install -e ".[dev]"');
  });

  it("buildkite: emits ShellCheck only with code-quality-shell", async () => {
    const withGate = (
      await generate(["buildkite", "code-quality-shell"], {
        workload: "batch",
        command: ["/usr/local/bin/backup.sh"],
      })
    ).get(".buildkite/pipeline.yml").content;
    expect(withGate).toContain("shellcheck -x scripts/*.sh");

    const withoutGate = (
      await generate(["buildkite"], {
        workload: "batch",
        command: ["/usr/local/bin/backup.sh"],
      })
    ).get(".buildkite/pipeline.yml").content;
    expect(withoutGate).not.toContain("shellcheck -x");
  });

  it("circleci: uses a generic image and emits no empty cache steps", async () => {
    const config = (
      await generate(["circleci"], {
        command: ["/usr/local/bin/entrypoint.sh"],
      })
    ).get(".circleci/config.yml").content;

    expect(config).toContain("image: cimg/base:stable");
    expect(config).not.toContain("npm ci");
    // CircleCI rejects a cache step with no keys/paths under it.
    expect(config).not.toContain("restore_cache:");
    expect(config).not.toContain("save_cache:");
    expect(config).toContain(
      'echo "No dependencies to install (shell project)."',
    );
  });
});

describe("validateShellLanguage", () => {
  const ctx = (language, capabilities, dockerConfig = {}) => ({
    capabilities,
    configuration: { language, "docker-container": dockerConfig },
  });

  it("requires an entrypoint or command for a shell container", () => {
    expect(() =>
      validateShellLanguage(ctx("shell", ["docker-container"])),
    ).toThrow(ValidationError);
  });

  it("accepts a declared command", () => {
    expect(() =>
      validateShellLanguage(
        ctx("shell", ["docker-container"], {
          command: ["/usr/local/bin/backup.sh"],
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a declared entrypoint", () => {
    expect(() =>
      validateShellLanguage(
        ctx("shell", ["docker-container"], {
          entrypoint: ["/usr/local/bin/entrypoint.sh"],
        }),
      ),
    ).not.toThrow();
  });

  it("does not require an entrypoint without docker-container", () => {
    expect(() =>
      validateShellLanguage(ctx("shell", ["buildkite"])),
    ).not.toThrow();
  });

  it("rejects a frontend: a shell project has no server to serve it", () => {
    expect(() =>
      validateShellLanguage(ctx("shell", ["buildkite", "sveltekit"])),
    ).toThrow(/no server to serve the built/);
  });

  it("is a no-op for every other language", () => {
    expect(() =>
      validateShellLanguage(ctx("python", ["docker-container"])),
    ).not.toThrow();
  });
});
