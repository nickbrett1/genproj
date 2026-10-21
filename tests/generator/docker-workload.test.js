// tests/generator/docker-workload.test.js

/**
 * Spec 022: `docker-container.workload` (`service` | `batch`).
 *
 * A batch job is a scheduled image that runs to completion and exits. It has no
 * port, no health endpoint and no long-running process, and it must never be
 * auto-updated between runs. The service defaults are all wrong for it
 * (watchtower/homepage default true, EXPOSE is unconditional, compose hardcodes
 * `restart: unless-stopped`), so `batch` derives the whole set from one enum.
 *
 * What these tests pin:
 *
 * 1. `service` (and `workload` absent) is BYTE-IDENTICAL to the pre-`workload`
 *    generator, against a checked-in golden fixture rendered from the commit
 *    that introduced this feature.
 * 2. `batch` emits no port, no healthcheck, no Homepage/Watchtower labels and
 *    `restart: "no"`.
 * 3. The batch smoke gate runs the image with `--dry-run` and requires exit 0,
 *    on every branch, with `docker_publish` depending on it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { generateAllFiles } from "../../src/generator/file-generator.js";
import {
  resolveBatchSmokeArgv,
  resolveDockerWorkload,
} from "../../src/generator/capability-template-utils.js";

const here = dirname(fileURLToPath(import.meta.url));

// The same rich config the golden fixture was rendered from: a published
// loopback port, an http healthcheck, env vars, an apt package, a data mount
// and an external network, so every template branch is exercised.
const SERVICE_CONFIG = {
  exposePort: 3001,
  publishPort: "127.0.0.1:3001:3001",
  hostname: "nas",
  healthcheck: "http:/healthz",
  envVars: ["MCP_PORT=3001", "DATABENTO_API_KEY"],
  aptPackages: ["iproute2"],
  dataMounts: [
    {
      hostPath: "/volume1/marketdata",
      containerPath: "/data",
      readOnly: true,
    },
  ],
  externalNetworks: ["ai_proxy"],
};

const GOLDEN_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "deploy/README.md",
  ".buildkite/pipeline.yml",
];

async function generate(dc, capabilities = ["devcontainer-python"]) {
  const files = await generateAllFiles({
    projectName: "golden-probe",
    description: "probe",
    capabilities: [...capabilities, "docker-container", "buildkite", "doppler"],
    configuration: { "docker-container": dc },
    registryNamespace: "nickbrett1",
  });
  return {
    files,
    get: (path) => files.find((f) => f.filePath === path),
  };
}

describe("docker-container workload resolution", () => {
  it("defaults to service", () => {
    expect(resolveDockerWorkload({ configuration: {} })).toBe("service");
    expect(
      resolveDockerWorkload({
        configuration: { "docker-container": { workload: "service" } },
      }),
    ).toBe("service");
  });

  it("accepts batch", () => {
    expect(
      resolveDockerWorkload({
        configuration: { "docker-container": { workload: "batch" } },
      }),
    ).toBe("batch");
  });

  it("falls back to service for an unknown value", () => {
    expect(
      resolveDockerWorkload({
        configuration: { "docker-container": { workload: "job" } },
      }),
    ).toBe("service");
  });
});

describe("docker-container workload: service is unchanged", () => {
  const golden = JSON.parse(
    readFileSync(
      resolve(here, "../fixtures/docker-service-golden.json"),
      "utf8",
    ),
  );

  it.each(GOLDEN_FILES)(
    "renders %s byte-identically to the pre-workload generator",
    async (path) => {
      const { get } = await generate(SERVICE_CONFIG);
      expect(get(path).content).toBe(golden[path]);
    },
  );

  it("renders identically with an explicit workload: service", async () => {
    const { get } = await generate({ ...SERVICE_CONFIG, workload: "service" });
    expect(get("Dockerfile").content).toBe(golden.Dockerfile);
    expect(get("docker-compose.yml").content).toBe(
      golden["docker-compose.yml"],
    );
  });
});

describe("docker-container workload: batch", () => {
  const BATCH = {
    workload: "batch",
    command: ["/usr/local/bin/backup.sh"],
    dataMounts: [
      { hostPath: "/volumeUSB1/usbshare/backup", containerPath: "/backup" },
    ],
    envVars: ["RESTIC_REPOSITORY"],
  };

  it("omits EXPOSE from the Dockerfile", async () => {
    const { get } = await generate(BATCH);
    expect(get("Dockerfile").content).not.toContain("EXPOSE");
  });

  it("omits ports, Homepage and Watchtower from compose", async () => {
    const compose = (await generate(BATCH)).get("docker-compose.yml").content;
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).not.toContain("homepage.");
    expect(compose).not.toContain("watchtower");
  });

  it('emits restart: "no"', async () => {
    const compose = (await generate(BATCH)).get("docker-compose.yml").content;
    expect(compose).toContain('    restart: "no"');
    expect(compose).not.toContain("unless-stopped");
  });

  it("emits no HEALTHCHECK and no Homepage snippet", async () => {
    const { get } = await generate(BATCH);
    expect(get("Dockerfile").content).not.toContain("HEALTHCHECK");
    expect(get("deploy/homepage-services.yaml")).toBeUndefined();
  });

  it("still copies and chmods the declared script", async () => {
    const dockerfile = (await generate(BATCH)).get("Dockerfile").content;
    expect(dockerfile).toContain(
      "COPY scripts/backup.sh /usr/local/bin/backup.sh",
    );
    expect(dockerfile).toContain("RUN chmod +x /usr/local/bin/backup.sh");
    expect(dockerfile).toContain('CMD ["/usr/local/bin/backup.sh"]');
  });

  it("replaces the service runbook with the batch one", async () => {
    const readme = (await generate(BATCH)).get("deploy/README.md").content;
    expect(readme).toContain("(batch job)");
    expect(readme).toContain("docker run --rm \\");
    expect(readme).toContain("-v /volumeUSB1/usbshare/backup:/backup:ro");
    expect(readme).not.toContain("Auto-updates with Watchtower");
  });

  it("emits a batch smoke gate that requires exit 0 with --dry-run", async () => {
    const pipeline = (await generate(BATCH)).get(
      ".buildkite/pipeline.yml",
    ).content;
    expect(pipeline).toContain("key: docker_batch_smoke");
    expect(pipeline).toContain("runs and exits 0");
    expect(pipeline).toContain("docker run --rm --name");
    expect(pipeline).toContain("--dry-run");
    expect(pipeline).not.toContain("key: docker_smoke");
    // Runs on every branch: no `if:` on the smoke step.
    const step = pipeline.slice(pipeline.indexOf("key: docker_batch_smoke"));
    expect(step.slice(0, step.indexOf("- label:"))).not.toContain("if:");
  });

  it("makes docker_publish depend on the batch gate", async () => {
    const pipeline = (await generate(BATCH)).get(
      ".buildkite/pipeline.yml",
    ).content;
    const publish = pipeline.slice(pipeline.indexOf("key: docker_publish"));
    expect(publish.slice(0, publish.indexOf("if:"))).toContain(
      "- docker_batch_smoke",
    );
  });

  it("honours an explicit watchtower: true", async () => {
    const compose = (await generate({ ...BATCH, watchtower: true })).get(
      "docker-compose.yml",
    ).content;
    expect(compose).toContain("watchtower.enable=true");
  });

  it("honours an explicit healthcheck", async () => {
    const dockerfile = (await generate({ ...BATCH, healthcheck: "none" })).get(
      "Dockerfile",
    ).content;
    expect(dockerfile).not.toContain("HEALTHCHECK");
  });
});

describe("batch smoke argv", () => {
  const ctx = (dc) => ({ configuration: { "docker-container": dc } });

  it("appends --dry-run to a declared ENTRYPOINT", () => {
    expect(
      resolveBatchSmokeArgv(
        ctx({ entrypoint: ["/usr/local/bin/entrypoint.sh"] }),
      ),
    ).toEqual(["--dry-run"]);
  });

  it("repeats a declared CMD before the flag (args replace CMD)", () => {
    expect(
      resolveBatchSmokeArgv(ctx({ command: ["/usr/local/bin/backup.sh"] })),
    ).toEqual(["/usr/local/bin/backup.sh", "--dry-run"]);
  });

  it("falls back to the bare flag", () => {
    expect(resolveBatchSmokeArgv(ctx({}))).toEqual(["--dry-run"]);
  });
});

describe("imageVisibility", () => {
  it("adds the host pull-credential section only when the package is private", async () => {
    const pub = (await generate(SERVICE_CONFIG)).get(
      "deploy/README.md",
    ).content;
    expect(pub).not.toContain("pull credentials for the host");

    const priv = (
      await generate({ ...SERVICE_CONFIG, imageVisibility: "private" })
    ).get("deploy/README.md").content;
    expect(priv).toContain("pull credentials for the host");
    expect(priv).toContain("read:packages");
    expect(priv).toContain("classic");
  });
});
