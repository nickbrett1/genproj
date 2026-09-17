/**
 * container-agent — the container's own a2a-goose agent.
 *
 * The capability is unconditional for containers (it is a dependency of every
 * `devcontainer-*`), so these tests pin two things that are easy to regress:
 *
 *   1. the wiring: the script is emitted with every placeholder resolved, the
 *      post-start hook starts it, and the README names the agent;
 *   2. the backport property: an existing `.devcontainer/devcontainer.json`
 *      gains `--stop-timeout` by regeneration (the merge is a union), which is
 *      the only reason the agents in repos that already exist can be given the
 *      docker-run flag at all.
 */
import { describe, it, expect } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import { getCapabilityTemplateData } from "../../src/generator/capability-template-utils.js";
import { mergeDevcontainerJson } from "../../src/generator/project-generator.js";

const withAgent = (overrides = {}) =>
  generateAllFiles({
    capabilities: ["devcontainer-rust", "container-agent"],
    configuration: { language: "rust", ...overrides },
    projectName: "parquet-peek",
  });

const byPath = (files, filePath) =>
  files.find((file) => file.filePath === filePath);

const DEV_CONTAINER = ".devcontainer/devcontainer.json";
const POST_START = ".devcontainer/post-start-setup.sh";

describe("container-agent: emitted files", () => {
  it("emits scripts/agent-dev.sh from the capability's own template", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    expect(script).toBeDefined();
    expect(script.content).toContain("#!/usr/bin/env bash");
  });

  it("resolves every placeholder in the emitted script", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    expect(script.content.match(/{{[^}]+}}/g)).toBeNull();
  });

  it("names the agent <repo><nameSuffix> and defaults the suffix to -dev", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    expect(script.content).toContain('AGENT_NAME="parquet-peek-dev"');
  });

  it("honours a configured nameSuffix", async () => {
    const script = byPath(
      await withAgent({ "container-agent": { nameSuffix: "-agent" } }),
      "scripts/agent-dev.sh",
    );
    expect(script.content).toContain('AGENT_NAME="parquet-peek-agent"');
  });

  it("derives the tailnet name at runtime when the capability does not pin one", async () => {
    // The card's publicUrl must not be loopback, so an unset name falls through
    // to `tailscale status --json` rather than to a guess.
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    expect(script.content).toContain(
      'TAILNET_NAME="${A2A_GOOSE_TAILNET_NAME:-}"',
    );
    expect(script.content).toContain("tailscale status --json");
  });

  it("lets a configured tailnetName win over the runtime lookup", async () => {
    const script = byPath(
      await withAgent({ "container-agent": { tailnetName: "nas-box" } }),
      "scripts/agent-dev.sh",
    );
    expect(script.content).toContain(
      'TAILNET_NAME="${A2A_GOOSE_TAILNET_NAME:-nas-box}"',
    );
  });

  it("fails open: start exits 0 with a loud message and never needs the network", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    // No `set -e`, and the no-network paths are `return 0`, not `exit 1`.
    expect(script.content).not.toMatch(/^set -e/m);
    expect(script.content).toContain("was NOT started");
  });

  it("keeps secrets out of the image and off the command line", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    expect(script.content).toContain("umask 077");
    expect(script.content).toContain("chmod 600");
    // The env file is written, never passed as an argument.
    expect(script.content).not.toMatch(/SECRET_KEY=.*doppler secrets get/);
  });
});

describe("container-agent: devcontainer.json", () => {
  it("gives the container 30s to stop so the agent can deregister", async () => {
    const json = JSON.parse(byPath(await withAgent(), DEV_CONTAINER).content);
    const join = json.runArgs.join(" ");
    expect(join).toContain("--stop-timeout 30");
    // The tailnet flags the base devcontainer already carries are untouched.
    expect(json.runArgs).toContain("net.ipv6.conf.all.disable_ipv6=1");
  });

  it("leaves runArgs alone when the capability is absent", async () => {
    const files = await generateAllFiles({
      capabilities: ["devcontainer-rust"],
      configuration: { language: "rust" },
      projectName: "no-agent",
    });
    const json = JSON.parse(byPath(files, DEV_CONTAINER).content);
    expect(json.runArgs).not.toContain("--stop-timeout");
  });
});

describe("container-agent: post-start hook", () => {
  it("starts the agent from post-start, not post-create", async () => {
    // An agent that only exists after a rebuild is missing for the session it
    // was meant to serve.
    const postStart = byPath(await withAgent(), POST_START);
    expect(postStart.content).toContain('/scripts/agent-dev.sh" start');
    expect(postStart.content.match(/{{[^}]+}}/g)).toBeNull();
  });

  it("emits nothing for a project without the capability", async () => {
    const files = await generateAllFiles({
      capabilities: ["devcontainer-rust"],
      configuration: { language: "rust" },
      projectName: "no-agent",
    });
    const postStart = byPath(files, POST_START);
    expect(postStart.content).not.toContain("agent-dev.sh");
    expect(postStart.content.match(/{{[^}]+}}/g)).toBeNull();
  });
});

describe("container-agent: README", () => {
  it("documents the agent and its name, because that name is its address", async () => {
    const readme = byPath(await withAgent(), "README.md").content;
    expect(readme).toContain("## The container's agent");
    expect(readme).toContain("parquet-peek-dev");
    expect(readme).toContain("scripts/agent-dev.sh start");
  });

  it("says nothing about an agent the project does not have", async () => {
    const files = await generateAllFiles({
      capabilities: ["devcontainer-rust"],
      configuration: { language: "rust" },
      projectName: "no-agent",
    });
    expect(byPath(files, "README.md").content).not.toContain(
      "The container's agent",
    );
  });
});

describe("backport: merging into an existing devcontainer", () => {
  const existing = JSON.stringify({
    name: "Existing",
    runArgs: ["--sysctl", "net.ipv6.conf.all.disable_ipv6=1"],
    mounts: [],
  });

  it("unions runArgs so regeneration adds --stop-timeout to an existing devcontainer", async () => {
    const generated = byPath(await withAgent(), DEV_CONTAINER).content;
    const merged = JSON.parse(mergeDevcontainerJson(existing, generated));
    const join = merged.runArgs.join(" ");
    expect(join).toContain("--stop-timeout 30");
    // Existing-first: nothing the project had is dropped or reordered.
    expect(merged.runArgs.slice(0, 2)).toEqual([
      "--sysctl",
      "net.ipv6.conf.all.disable_ipv6=1",
    ]);
  });

  it("is idempotent: re-merging the same inputs is a no-op", async () => {
    const generated = byPath(await withAgent(), DEV_CONTAINER).content;
    const once = mergeDevcontainerJson(existing, generated);
    expect(mergeDevcontainerJson(once, generated)).toBe(once);
  });
});

describe("container-agent: template data", () => {
  it("exposes the values the shell template cannot derive", () => {
    const data = getCapabilityTemplateData("container-agent", {
      capabilities: ["devcontainer-rust", "container-agent"],
      configuration: {},
      projectName: "vikunja-mcp",
    });
    expect(data).toMatchObject({
      containerAgentProjectName: "vikunja-mcp",
      containerAgentName: "vikunja-mcp-dev",
      containerAgentNameSuffix: "-dev",
      containerAgentTailnetName: "",
      containerAgentWorkspacePath: "/workspaces/vikunja-mcp",
      containerAgentLitellmBaseUrl: "http://nas:4000",
      containerAgentRepoSlug: "nickbrett1/a2a-goose",
    });
  });

  it("reads litellmBaseUrl and nameSuffix from the capability configuration", () => {
    const data = getCapabilityTemplateData("container-agent", {
      capabilities: ["devcontainer-rust", "container-agent"],
      configuration: {
        "container-agent": {
          litellmBaseUrl: "http://litellm.internal:4000",
          nameSuffix: "-ci",
        },
      },
      projectName: "huddle",
    });
    expect(data.containerAgentLitellmBaseUrl).toBe(
      "http://litellm.internal:4000",
    );
    expect(data.containerAgentName).toBe("huddle-ci");
    expect(data.containerAgentPostStartHook).toContain("agent-dev.sh");
  });
});
