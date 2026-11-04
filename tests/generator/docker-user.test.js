// tests/generator/docker-user.test.js

/**
 * Spec 024: `docker-container.user` (`uid:gid`).
 *
 * The key exists so a container can run as the uid that owns a mounted host
 * directory: a `0700` appdata directory owned by another uid gives EACCES on
 * the *directory* even when the files inside it are world-readable, and the
 * error names the mount rather than the cause.
 *
 * What these tests pin, in order of what would hurt most if it broke:
 *
 * 1. `USER` is the LAST instruction of the runtime stage. `dockerRunCommand`
 *    carries `RUN chmod +x /usr/local/bin/<script>`; with `USER` emitted any
 *    earlier that chmod runs as the new uid against a root-owned file and the
 *    build dies with "Operation not permitted". Every batch job declares an
 *    entrypoint, so the cut corner would hit the motivating shape first. This
 *    is asserted on the RENDERED text, not on intermediate data, because the
 *    fold into `dockerRunCommand` is the mechanism under test.
 * 2. Unset renders byte-identically to the pre-024 generator (spec 022's rule),
 *    against the checked-in golden fixture.
 * 3. compose emits a QUOTED `user: "1000:1000"` - the same reason
 *    `restart: "no"` is quoted.
 * 4. Invalid values are a generation error naming the key.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { generateAllFiles } from "../../src/generator/file-generator.js";
import { resolveDockerUser } from "../../src/generator/capability-template-utils.js";
import { ValidationError } from "../../src/generator/genproj-errors.js";

const here = dirname(fileURLToPath(import.meta.url));

// The same rich config the golden fixture was rendered from (spec 022): a
// published loopback port, an http healthcheck, env vars, an apt package, a
// data mount and an external network, so every template branch is exercised.
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

// The motivating shape: a batch job that declares an entrypoint (which is what
// puts `RUN chmod +x` into `dockerRunCommand`) and mounts another service's
// data directory.
const BATCH_CONFIG = {
  workload: "batch",
  user: "1000:1000",
  command: ["/usr/local/bin/msgvault-export.sh"],
  dataMounts: [
    {
      hostPath: "/srv/appdata/msgvault",
      containerPath: "/srv/msgvault",
      readOnly: true,
    },
    {
      hostPath: "/srv/appdata/export",
      containerPath: "/export",
      readOnly: false,
    },
  ],
  envVars: ["MSGVault_DB=/srv/msgvault/msgvault.db"],
};

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

describe("docker-container user resolution", () => {
  it("is empty when unset", () => {
    expect(resolveDockerUser({ configuration: {} })).toBe("");
    expect(
      resolveDockerUser({ configuration: { "docker-container": {} } }),
    ).toBe("");
  });

  it("passes a numeric uid:gid through", () => {
    expect(
      resolveDockerUser({
        configuration: { "docker-container": { user: "1000:1000" } },
      }),
    ).toBe("1000:1000");
  });

  it("normalizes whitespace and leading zeros", () => {
    expect(
      resolveDockerUser({
        configuration: { "docker-container": { user: " 01000:01000 " } },
      }),
    ).toBe("1000:1000");
  });

  it("returns empty - never a bad value - for anything it cannot emit", () => {
    for (const user of [
      "0",
      "0:0",
      "0:1000",
      "1000",
      "foo",
      "nick:nick",
      "1:2:3",
      "-1:1",
      1000,
    ]) {
      expect(
        resolveDockerUser({ configuration: { "docker-container": { user } } }),
      ).toBe("");
    }
  });
});

describe("docker-container user: unset is byte-identical", () => {
  const golden = JSON.parse(
    readFileSync(
      resolve(here, "../fixtures/docker-service-golden.json"),
      "utf8",
    ),
  );

  it.each(GOLDEN_FILES)(
    "renders %s byte-identically to the pre-user generator",
    async (path) => {
      const { get } = await generate(SERVICE_CONFIG);
      expect(get(path).content).toBe(golden[path]);
    },
  );

  it("renders identically with an explicit empty user", async () => {
    const { get } = await generate({ ...SERVICE_CONFIG, user: "" });
    expect(get("Dockerfile").content).toBe(golden.Dockerfile);
    expect(get("docker-compose.yml").content).toBe(
      golden["docker-compose.yml"],
    );
  });
});

describe("docker-container user: emitted", () => {
  it("emits USER in the runtime stage", async () => {
    const dockerfile = (await generate({ user: "1000:1000" })).get(
      "Dockerfile",
    ).content;
    expect(dockerfile).toContain("USER 1000:1000");
    // Runtime stage only: the build stage must stay root so pip/apt work.
    const runtimeStage = dockerfile.split(/^FROM .*$/m).at(-1);
    expect(runtimeStage).toContain("USER 1000:1000");
    expect(dockerfile.split(/^FROM .*$/m)[1]).not.toContain("USER 1000:1000");
  });

  it("emits USER as the LAST instruction, after every COPY and chmod", async () => {
    const Dockerfile = (await generate({ user: "1000:1000" })).get(
      "Dockerfile",
    ).content;
    const instructions = Dockerfile.split("\n").filter(
      (line) =>
        line.trim() !== "" &&
        !line.trim().startsWith("#") &&
        // continuation lines of a multi-line RUN are not instructions
        !/^\s/.test(line),
    );
    expect(instructions.at(-1)).toBe("USER 1000:1000");

    // The ordering that actually breaks a build: `RUN chmod +x` must not run
    // as the new uid.
    expect(Dockerfile.indexOf("USER 1000:1000")).toBeGreaterThan(
      Dockerfile.indexOf("RUN chmod +x"),
    );
    expect(Dockerfile.indexOf("USER 1000:1000")).toBeGreaterThan(
      Dockerfile.indexOf("COPY --from=build"),
    );
  });

  it("emits USER last in the single-stage shell image too", async () => {
    const shellConfig = {
      language: "shell",
      user: "1000:1000",
      entrypoint: ["/usr/local/bin/run.sh"],
    };
    const { get } = await generate(shellConfig, []);
    const Dockerfile = get("Dockerfile").content;
    expect(Dockerfile).toContain("USER 1000:1000");
    const instructions = Dockerfile.split("\n").filter(
      (line) =>
        line.trim() !== "" && !line.trim().startsWith("#") && !/^\s/.test(line),
    );
    expect(instructions.at(-1)).toBe("USER 1000:1000");
    expect(Dockerfile.indexOf("USER 1000:1000")).toBeGreaterThan(
      Dockerfile.indexOf("RUN chmod +x"),
    );
  });

  it("emits a QUOTED compose user line next to restart", async () => {
    const compose = (await generate({ user: "1000:1000" })).get(
      "docker-compose.yml",
    ).content;
    expect(compose).toContain('    user: "1000:1000"');
    // Unquoted would parse as a bare scalar; "simplifying" the quotes away is
    // the same mistake `restart: "no"` documents.
    expect(compose).not.toMatch(/^\s+user: 1000:1000\s*$/m);
    expect(compose).toMatch(/restart: unless-stopped\n\s+user: "1000:1000"/);
  });

  it("emits both network_mode and user under host networking", async () => {
    const compose = (
      await generate({ networkMode: "host", user: "1000:1000" })
    ).get("docker-compose.yml").content;
    expect(compose).toContain("    network_mode: host");
    expect(compose).toContain('    user: "1000:1000"');
    expect(compose.indexOf("network_mode: host")).toBeLessThan(
      compose.indexOf('user: "1000:1000"'),
    );
  });

  it("keeps a batch job's shape: user, restore policy, no port", async () => {
    const { get } = await generate(BATCH_CONFIG);
    const compose = get("docker-compose.yml").content;
    const Dockerfile = get("Dockerfile").content;
    expect(compose).toContain('    user: "1000:1000"');
    expect(compose).toContain('    restart: "no"');
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(Dockerfile).toContain("USER 1000:1000");
    expect(Dockerfile).not.toContain("EXPOSE");
  });

  it("documents the uid and the mount limitation in the service runbook", async () => {
    const readme = (await generate({ user: "1000:1000" })).get(
      "deploy/README.md",
    ).content;
    expect(readme).toContain("**Runtime user.**");
    expect(readme).toContain("uid 1000, gid 1000");
    expect(readme).toContain("install -d -o 1000 -g 1000");
    expect(readme).toContain("readable");
    expect(readme).toContain("writable");
    expect(readme).toContain("creates it **as root**");
    expect(readme).toContain("no passwd entry for");
    // Appended inside section 7, not a new section.
    expect(readme.indexOf("**Runtime user.**")).toBeGreaterThan(
      readme.indexOf("## 7. Data mounts"),
    );
    expect(readme.indexOf("**Runtime user.**")).toBeLessThan(
      readme.indexOf("## 8."),
    );
  });

  it("documents the uid in the batch runbook", async () => {
    const readme = (await generate(BATCH_CONFIG)).get(
      "deploy/README.md",
    ).content;
    expect(readme).toContain("**Runtime user.**");
    expect(readme).toContain("uid 1000, gid 1000");
    expect(readme.indexOf("**Runtime user.**")).toBeGreaterThan(
      readme.indexOf("## 6. Data mounts"),
    );
  });
});

describe("docker-container user: validation", () => {
  it.each([
    ["0", /bare uid/],
    ["0:0", /runs the container as root/],
    ["0:1000", /runs the container as root/],
    ["1000", /bare uid/],
    ["foo", /not a numeric uid:gid/],
    ["nick:nick", /not a numeric uid:gid/],
  ])("rejects user %s", async (user, message) => {
    await expect(generate({ user })).rejects.toThrow(message);
  });

  it("names the key on the error", async () => {
    await expect(generate({ user: "0:0" })).rejects.toThrow(ValidationError);
    await expect(generate({ user: "0:0" })).rejects.toMatchObject({
      field: "user",
    });
  });

  it("rejects a JSON number rather than treating it as a uid", async () => {
    await expect(generate({ user: 1000 })).rejects.toThrow(/must be a string/);
  });

  it("accepts the value that motivated the feature", async () => {
    const { get } = await generate({ user: "1000:1000" });
    expect(get("Dockerfile").content).toContain("USER 1000:1000");
  });
});
