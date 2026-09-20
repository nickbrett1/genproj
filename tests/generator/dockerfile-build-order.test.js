import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import { getCapabilityTemplateData } from "../../src/generator/capability-template-utils.js";

/**
 * Regression: the docker-container build stage must never run a
 * dependency-fetch step that parses a manifest before the target/source it
 * needs exists.
 *
 * The bug (roost build 3, `docker_publish`): the Rust stage emitted
 *   COPY Cargo.toml Cargo.lock* ./
 *   RUN cargo fetch
 *   COPY src ./src
 * `cargo fetch` resolves Cargo.toml and Cargo refuses a manifest with no
 * targets ("no targets specified in the manifest: either src/lib.rs,
 * src/main.rs, a [lib] section, or [[bin]] section must be present"). At the
 * fetch layer only the manifests exist, so the layer failed for *every*
 * generated Rust project. It stayed hidden behind an earlier CI bug that
 * prevented the image-build job from ever running.
 *
 * These tests render the real Dockerfile (through generateAllFiles, the same
 * path a project generation takes) for each language and assert the ordering.
 * A data-driven shape check also guards the other emitters.
 */

// Per language: which step primes the dependency cache, whether that tool
// requires the source/target to already exist, and the stub it must create.
const LANGUAGES = {
  rust: {
    capabilities: ["devcontainer-rust", "docker-container"],
    baseImage: /^FROM rust:\S+ AS build$/m,
    // cargo fetch parses Cargo.toml and needs a target present.
    fetchNeedsSource: true,
    fetchStep: /cargo fetch/,
    stubMarkers: [/src\/main\.rs/],
    cleanupMarker: /rm -rf src/,
    sourceCopy: /^COPY src \.\/src/,
    buildStep: /^RUN cargo build --release/,
  },
  java: {
    capabilities: ["devcontainer-java", "docker-container"],
    baseImage: /^FROM maven:\S+ AS build$/m,
    // dependency:go-offline resolves from pom.xml only; no src required.
    // This is the canonical Maven Docker cache pattern.
    fetchNeedsSource: false,
    fetchStep: /dependency:go-offline/,
    sourceCopy: /^COPY src \.\/src/,
    buildStep: /^RUN mvn -B package/,
  },
  python: {
    capabilities: ["devcontainer-python", "docker-container"],
    baseImage: /^FROM python:\S+ AS build$/m,
    // pip install . builds metadata from the package; genproj already stubs
    // src/<pkg>/__init__.py before installing.
    fetchNeedsSource: true,
    fetchStep: /pip install --no-cache-dir \.(?:;|\s|$)/m,
    stubMarkers: [/__init__\.py/],
    sourceCopy: /^COPY \. \./,
    buildStep: /^RUN if \[ -f requirements\.txt \]/,
  },
  node: {
    capabilities: ["devcontainer-node", "sveltekit", "docker-container"],
    baseImage: /^FROM node:\S+ AS build$/m,
    // npm ci reads package.json + lockfile only; no source required.
    fetchNeedsSource: false,
    fetchStep: /\bnpm (?:ci|install)\b/,
    sourceCopy: /^COPY \. \./,
    buildStep: /^RUN npm run build/,
  },
};

/**
 * Splits the `AS build` stage into logical instructions, joining
 * backslash-continued lines into a single step.
 * @param {string} dockerfile - Rendered Dockerfile
 * @returns {string[]} Ordered instruction blocks
 */
function buildStageSteps(dockerfile) {
  const afterBuild = dockerfile.split(/\nFROM .* AS build\n/)[1];
  expect(afterBuild, "build stage missing").toBeTruthy();
  const stage = afterBuild.split(/\nFROM /)[0];
  const steps = [];
  let current = null;
  for (const raw of stage.split("\n")) {
    const line = raw.trimEnd();
    if (current === null) {
      if (/^(?:RUN|COPY|ADD|ENV|WORKDIR)\b/.test(line)) {
        current = line;
      } else {
        continue;
      }
    } else {
      current += `\n${line}`;
    }
    if (!line.endsWith("\\")) {
      steps.push(current);
      current = null;
    }
  }
  return steps;
}

async function renderDockerfile(capabilities) {
  const files = await generateAllFiles({
    projectName: "demo-app",
    description: "regression fixture",
    capabilities,
    configuration: {},
    registryNamespace: "OWNER",
  });
  const dockerfile = files.find((f) => f.filePath === "Dockerfile");
  expect(dockerfile).toBeDefined();
  return dockerfile.content;
}

describe("docker-container build stage ordering", () => {
  for (const [language, spec] of Object.entries(LANGUAGES)) {
    describe(language, () => {
      it("copies source before building and never fetches before a stub target exists", async () => {
        const dockerfile = await renderDockerfile(spec.capabilities);
        expect(dockerfile).toMatch(spec.baseImage);

        const steps = buildStageSteps(dockerfile);
        const fetchIndex = steps.findIndex((s) => spec.fetchStep.test(s));
        const copyIndex = steps.findIndex((s) => spec.sourceCopy.test(s));
        const buildIndex = steps.findIndex((s) => spec.buildStep.test(s));

        expect(fetchIndex, "dependency fetch step").toBeGreaterThanOrEqual(0);
        expect(copyIndex, "source copy step").toBeGreaterThanOrEqual(0);
        expect(buildIndex, "compile step").toBeGreaterThanOrEqual(0);

        // The compile step must always run against the real source tree.
        expect(buildIndex).toBeGreaterThan(copyIndex);

        // Cache priming may happen before the source copy ...
        expect(fetchIndex).toBeLessThan(copyIndex);

        if (spec.fetchNeedsSource) {
          // ... but only if the fetch step first materialises a stub
          // target. The stub must be created *in the same step, before the
          // fetch* — a bare fetch is the exact roost regression.
          const fetchStep = steps[fetchIndex];
          const fetchPos = fetchStep.search(spec.fetchStep);
          for (const marker of spec.stubMarkers) {
            const stubPos = fetchStep.search(marker);
            expect(
              stubPos,
              `stub ${marker} in fetch step`,
            ).toBeGreaterThanOrEqual(0);
            expect(stubPos, `stub ${marker} precedes fetch`).toBeLessThan(
              fetchPos,
            );
          }
          if (spec.cleanupMarker) {
            // COPY merges rather than replaces, so the stub must be gone
            // before the real source lands or it becomes a phantom target.
            const cleanupPos = fetchStep.search(spec.cleanupMarker);
            expect(cleanupPos).toBeGreaterThan(fetchPos);
            expect(steps[copyIndex]).not.toMatch(spec.cleanupMarker);
          }
        }
      });
    });
  }

  it("rust: cargo fetch is never emitted bare (roost regression)", () => {
    const data = getCapabilityTemplateData("docker-container", {
      capabilities: ["devcontainer-rust", "docker-container"],
      projectName: "roost",
      configuration: {},
    });
    const commands = data.dockerBuildCommands;

    // No bare `RUN cargo fetch` anywhere.
    expect(commands).not.toMatch(/^RUN cargo fetch\s*$/m);

    const stubPos = commands.indexOf("src/main.rs");
    const fetchPos = commands.indexOf("cargo fetch");
    const rmPos = commands.indexOf("rm -rf src");
    const copyPos = commands.indexOf("COPY src ./src");

    expect(stubPos).toBeGreaterThanOrEqual(0);
    expect(stubPos).toBeLessThan(fetchPos);
    expect(rmPos).toBeGreaterThan(fetchPos);
    expect(rmPos).toBeLessThan(copyPos);
  });
});
