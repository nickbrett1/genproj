// tests/generator/docker-watchtower-scope.test.js

/**
 * Spec 025: `docker-container.watchtowerScope`.
 *
 * Watchtower can be split across several instances on one host by `scope`: an
 * instance only manages containers whose `com.centurylinklabs.watchtower.scope`
 * label matches its own `WATCHTOWER_SCOPE`. This host runs `watchtower-nick`
 * (`WATCHTOWER_SCOPE=nick`, 60s poll) next to an unscoped `watchtower` on the
 * nightly `SCHEDULE`; the labels are disjoint, so a scoped container is managed
 * by exactly one instance and a scope no instance serves means the container is
 * never updated at all.
 *
 * What these tests pin, in order of what would hurt most if it broke:
 *
 * 1. The default render carries BOTH labels (`enable=true` and `scope=nick`),
 *    because the default is what routes a new project to the fast instance.
 * 2. `""` is the documented opt-out: enable stays, scope disappears.
 * 3. The label is emitted only where the enable label is - `watchtower: false`
 *    emits neither, `workload: batch` emits neither, and an explicit
 *    `watchtower: true` on a batch job emits both.
 * 4. A value that would corrupt the label or its YAML is a generation error
 *    whose `field` is `watchtowerScope`.
 */

import { describe, it, expect } from "vitest";

import { generateAllFiles } from "../../src/generator/file-generator.js";
import { resolveWatchtowerScope } from "../../src/generator/capability-template-utils.js";
import { ValidationError } from "../../src/generator/genproj-errors.js";

const DC = {
  healthcheck: "http:/healthz",
  exposePort: 3001,
  publishPort: "127.0.0.1:3001:3001",
};

const ENABLE_LABEL = '      - "com.centurylinklabs.watchtower.enable=true"';
const scopeLabel = (scope) =>
  `      - "com.centurylinklabs.watchtower.scope=${scope}"`;

async function generate(dc) {
  const files = await generateAllFiles({
    projectName: "scope-probe",
    description: "probe",
    capabilities: ["devcontainer-python", "docker-container"],
    configuration: { "docker-container": dc },
    registryNamespace: "nickbrett1",
  });
  const get = (p) => files.find((f) => f.filePath === p);
  return { files, get };
}

describe("docker-container watchtowerScope: resolution", () => {
  it("defaults to nick when the key is absent", () => {
    expect(resolveWatchtowerScope({})).toBe("nick");
    expect(resolveWatchtowerScope(undefined)).toBe("nick");
  });

  it("keeps an explicit token", () => {
    expect(resolveWatchtowerScope({ watchtowerScope: "prod" })).toBe("prod");
    expect(resolveWatchtowerScope({ watchtowerScope: "a.b_c-1" })).toBe(
      "a.b_c-1",
    );
  });

  it("treats empty, whitespace and unsafe values as 'no scope label'", () => {
    // The emit path must never let a bad value reach a file: a preview does
    // not run the project validators.
    expect(resolveWatchtowerScope({ watchtowerScope: "" })).toBe("");
    expect(resolveWatchtowerScope({ watchtowerScope: "   " })).toBe("");
    expect(resolveWatchtowerScope({ watchtowerScope: "nick:prod" })).toBe("");
    expect(resolveWatchtowerScope({ watchtowerScope: 'nick"x' })).toBe("");
    expect(resolveWatchtowerScope({ watchtowerScope: "nick#x" })).toBe("");
    expect(resolveWatchtowerScope({ watchtowerScope: "nick prod" })).toBe("");
    expect(resolveWatchtowerScope({ watchtowerScope: "-nick" })).toBe("");
  });
});

describe("docker-container watchtowerScope: emission", () => {
  it("emits both labels by default", async () => {
    const compose = (await generate(DC)).get("docker-compose.yml").content;
    expect(compose).toContain(ENABLE_LABEL);
    expect(compose).toContain(scopeLabel("nick"));
  });

  it("emits an explicit custom scope", async () => {
    const compose = (await generate({ ...DC, watchtowerScope: "prod" })).get(
      "docker-compose.yml",
    ).content;
    expect(compose).toContain(ENABLE_LABEL);
    expect(compose).toContain(scopeLabel("prod"));
    expect(compose).not.toContain(scopeLabel("nick"));
  });

  it("emits the enable label but no scope label for an empty scope", async () => {
    const compose = (await generate({ ...DC, watchtowerScope: "" })).get(
      "docker-compose.yml",
    ).content;
    expect(compose).toContain(ENABLE_LABEL);
    expect(compose).not.toContain("watchtower.scope");
  });

  it("emits neither label when watchtower is off, with no orphan block", async () => {
    const compose = (
      await generate({ ...DC, watchtower: false, homepage: false })
    ).get("docker-compose.yml").content;
    expect(compose).not.toContain("watchtower");
    expect(compose).not.toContain("labels:");
  });

  it("emits no scope label for workload: batch", async () => {
    const compose = (await generate({ ...DC, workload: "batch" })).get(
      "docker-compose.yml",
    ).content;
    // docker-workload.test.js pins `not.toContain("watchtower")`; this is the
    // same gate, stated where the scope feature is under test.
    expect(compose).not.toContain("watchtower");
    expect(compose).not.toContain("labels:");
  });

  it("emits both labels for an explicit watchtower: true on a batch job", async () => {
    const compose = (
      await generate({ ...DC, workload: "batch", watchtower: true })
    ).get("docker-compose.yml").content;
    expect(compose).toContain(ENABLE_LABEL);
    expect(compose).toContain(scopeLabel("nick"));
  });

  it("documents the scope and the trap in the service runbook", async () => {
    const readme = (await generate(DC)).get("deploy/README.md").content;
    expect(readme).toContain("watchtower.scope=nick");
    expect(readme).toContain("WATCHTOWER_SCOPE=nick");
    expect(readme).toContain("never");
  });

  it("keeps the runbook scope-free when the scope is empty", async () => {
    const readme = (await generate({ ...DC, watchtowerScope: "" })).get(
      "deploy/README.md",
    ).content;
    expect(readme).not.toContain("watchtower.scope");
    expect(readme).not.toContain("WATCHTOWER_SCOPE");
  });
});

describe("docker-container watchtowerScope: validation", () => {
  it.each([
    ["nick prod", /whitespace/],
    ["nick\nprod", /whitespace/],
    ["nick:prod", /contains ':'/],
    ['nick"prod', /not a valid Watchtower scope/],
    ["nick#prod", /not a valid Watchtower scope/],
    ["nick=prod", /not a valid Watchtower scope/],
    ["-nick", /not a valid Watchtower scope/],
  ])("rejects %j with field watchtowerScope", async (watchtowerScope, msg) => {
    await expect(generate({ ...DC, watchtowerScope })).rejects.toThrow(
      ValidationError,
    );
    await expect(generate({ ...DC, watchtowerScope })).rejects.toMatchObject({
      field: "watchtowerScope",
      message: expect.stringMatching(msg),
    });
  });

  it("rejects a JSON number", async () => {
    await expect(generate({ ...DC, watchtowerScope: 42 })).rejects.toThrow(
      /must be a string/,
    );
  });

  it("accepts the empty string as the documented opt-out", async () => {
    await expect(
      generate({ ...DC, watchtowerScope: "" }),
    ).resolves.toBeTruthy();
  });
});
