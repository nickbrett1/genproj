// tests/generator/docker-runtime-files.test.js

/**
 * `docker-container.runtimeFiles` and `docker-container.smokePaths`.
 *
 * The gap these close (memo: genproj-capability-gap-runtime-image-contents):
 * the node/java/rust runtime stage copies only the BUILD output, so a committed
 * file the app reads at request time never reaches the image. It works in
 * `npm run dev` and in `npm test` - both run against the repo - and answers 404
 * in production. Nothing noticed, because the CI smoke step polls the declared
 * healthcheck and a generated `/health` is a static `ok` that touches nothing.
 *
 * What these tests pin:
 *
 * 1. Both keys are ABSENT by default: no extra COPY, no port publish, no
 *    assertion - an existing project's Dockerfile and pipeline are unchanged.
 * 2. `runtimeFiles` emits `COPY --from=build /app/<path> ./<path>` in the
 *    RUNTIME stage for node, and is a no-op for python (which already does
 *    `COPY . .`) and for a shell image (single stage).
 * 3. `smokePaths` makes the smoke step publish a loopback port and assert each
 *    path answers, with `expect` pinning an exact status.
 * 4. Unemittable values fail the GENERATION rather than producing an image with
 *    a missing directory - the silent failure this feature exists to end.
 */

import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import {
  isSafeRuntimeFilePath,
  resolveRuntimeFiles,
  resolveSmokePaths,
} from "../../src/generator/capability-template-utils.js";

async function render(capabilities, dc = {}, projectName = "demo") {
  const files = await generateAllFiles({
    projectName,
    description: "runtime-files fixture",
    capabilities: [...capabilities, "docker-container", "buildkite"],
    configuration: { "docker-container": dc },
    registryNamespace: "OWNER",
  });
  return {
    files,
    find: (path) => files.find((f) => f.filePath === path)?.content,
  };
}

/** The final (runtime) stage of a rendered Dockerfile. */
function runtimeStage(dockerfile) {
  return dockerfile.split(/\nFROM /).pop();
}

const NODE = ["devcontainer-node", "sveltekit"];
const PYTHON = ["devcontainer-python"];

describe("runtimeFiles: default is unchanged output", () => {
  it("emits no extra COPY and leaves the runtime stage alone", async () => {
    const { find } = await render(NODE);
    const dockerfile = find("Dockerfile");
    expect(dockerfile).toContain("COPY --from=build /app/build ./build");
    // The ONLY COPY --from=build lines are the build output and the frontend.
    expect(dockerfile.match(/COPY --from=build/g)).toHaveLength(1);
  });

  it("resolves to an empty list for absent, null or non-array values", () => {
    expect(resolveRuntimeFiles({ configuration: {} })).toEqual([]);
    expect(
      resolveRuntimeFiles({ configuration: { "docker-container": {} } }),
    ).toEqual([]);
    expect(
      resolveRuntimeFiles({
        configuration: { "docker-container": { runtimeFiles: "registry/" } },
      }),
    ).toEqual([]);
  });
});

describe("runtimeFiles: node carries committed data", () => {
  it("copies each entry into the runtime stage, at the same path", async () => {
    const { find } = await render(NODE, {
      runtimeFiles: ["registry/", "registry.json"],
    });
    const runtime = runtimeStage(find("Dockerfile"));
    expect(runtime).toContain("COPY --from=build /app/registry ./registry");
    expect(runtime).toContain(
      "COPY --from=build /app/registry.json ./registry.json",
    );
    // The existing contract is untouched: build output still copied, the npm
    // rationale still intact.
    expect(runtime).toContain("COPY --from=build /app/build ./build");
    expect(runtime).toContain("ENV NODE_ENV=production");
    // Files are copies, not mounts: nothing appears in compose volumes (a
    // mount would make the service undeployable off the one host that has the
    // directory).
    expect(find("docker-compose.yml")).not.toContain("volumes:");
  });

  it("ignores the key for python, which already copies the tree", async () => {
    const { find } = await render(PYTHON, {
      runtimeFiles: ["vocab.yaml"],
      healthcheck: "http:/healthz",
    });
    const runtime = runtimeStage(find("Dockerfile"));
    expect(runtime).toContain("COPY . .");
    expect(runtime).not.toContain("COPY --from=build /app/vocab.yaml");
  });

  it("normalizes ./ prefixes and trailing slashes, and de-duplicates", () => {
    const resolved = resolveRuntimeFiles({
      configuration: {
        "docker-container": {
          runtimeFiles: ["./registry/", "registry", "registry.json"],
        },
      },
    });
    expect(resolved).toEqual(["registry", "registry.json"]);
  });
});

describe("runtimeFiles: bad paths fail generation, not the image", () => {
  it.each([
    ["absolute", "/etc/passwd"],
    ["parent traversal", "../secrets"],
    ["whole tree", "."],
    ["whole tree (explicit)", "./"],
    ["glob", "registry/*.json"],
    ["quote", 'reg"istry'],
    ["space", "my registry"],
    ["not a string", 42],
  ])("rejects a %s entry", async (_label, entry) => {
    await expect(render(NODE, { runtimeFiles: [entry] })).rejects.toThrow(
      /runtimeFiles/,
    );
  });

  it("accepts ordinary nested paths", () => {
    for (const path of ["registry", "a/b/c.json", "data/seed@v1.json"])
      expect(isSafeRuntimeFilePath(path)).toBe(true);
  });
});

describe("smokePaths: the pipeline asserts what is in the image", () => {
  it("is absent by default: no publish flag, no assertion", async () => {
    const { find } = await render(NODE);
    const pipeline = find(".buildkite/pipeline.yml");
    expect(pipeline).toContain("key: docker_smoke");
    expect(pipeline).not.toContain("smokePath ");
    expect(pipeline).not.toContain('-p "127.0.0.1::');
  });

  it("publishes a loopback port and asserts each path", async () => {
    const { find } = await render(NODE, {
      exposePort: 3000,
      smokePaths: ["/health", { path: "/r/registry.json", expect: 200 }],
    });
    const pipeline = find(".buildkite/pipeline.yml");
    // Probed from the AGENT, so the image needs neither curl nor node.
    expect(pipeline).toContain('-p "127.0.0.1::3000"');
    expect(pipeline).toContain(
      'HOST_PORT="$$(docker port "$$CONTAINER" 3000/tcp',
    );
    expect(pipeline).toContain('assert_smoke_path "/health" ""');
    expect(pipeline).toContain('assert_smoke_path "/r/registry.json" "200"');
    // The assertion runs only once the healthcheck has passed, and before the
    // step declares success.
    const healthy = pipeline.indexOf('if [ "$$HEALTH" = "healthy" ]');
    const assertion = pipeline.indexOf('assert_smoke_path "/health"');
    const exitOk = pipeline.indexOf(
      "image starts and serves HTTP (healthcheck passed)",
    );
    expect(healthy).toBeGreaterThan(-1);
    expect(assertion).toBeGreaterThan(healthy);
    expect(exitOk).toBeGreaterThan(assertion);

    // The step is a YAML block scalar, so an indentation slip would only show
    // up as a broken pipeline after a push. Parse it.
    const step = parseYaml(pipeline).steps.find(
      (s) => s.key === "docker_smoke",
    );
    expect(step.commands[1]).toContain('assert_smoke_path "/health" ""');
    expect(step.commands[1]).toContain(
      'assert_smoke_path "/r/registry.json" "200"',
    );
  });

  it("addresses the container port directly under host networking", async () => {
    const { find } = await render(NODE, {
      networkMode: "host",
      exposePort: 3000,
      smokePaths: ["/health"],
    });
    const pipeline = find(".buildkite/pipeline.yml");
    expect(pipeline).not.toContain('-p "127.0.0.1::');
    expect(pipeline).toContain('HOST_ADDRESS="127.0.0.1:3000"');
  });

  it("rejects a relative path or a non-status expectation", async () => {
    await expect(render(NODE, { smokePaths: ["health"] })).rejects.toThrow(
      /smokePaths/,
    );
    await expect(
      render(NODE, { smokePaths: [{ path: "/health", expect: 42 }] }),
    ).rejects.toThrow(/smokePaths/);
  });

  it("treats a bare string as 'answers at all'", () => {
    expect(
      resolveSmokePaths({
        configuration: {
          "docker-container": {
            smokePaths: ["/health"],
          },
        },
      }),
    ).toEqual([{ path: "/health", expect: null }]);
  });
});
