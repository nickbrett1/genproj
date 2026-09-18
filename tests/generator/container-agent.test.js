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
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("derives the card's address at runtime when the capability does not pin one", async () => {
    // The card's publicUrl must not be loopback, so an unset address falls
    // through to tailscale rather than to a guess.
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    expect(script.content).toContain(
      'CARD_ADDRESS="${A2A_GOOSE_CARD_ADDRESS:-${A2A_GOOSE_TAILNET_NAME:-}}"',
    );
    expect(script.content).toContain("tailscale ip -4");
    expect(script.content).toContain(".Self.TailscaleIPs[0]");
    expect(script.content).toContain(".Self.DNSName");
    expect(script.content).toContain(
      'publicUrl: "http://${CARD_ADDRESS}:${CARD_PORT}"',
    );
  });

  it("lets a configured address win over the runtime lookup", async () => {
    const script = byPath(
      await withAgent({ "container-agent": { tailnetName: "nas-box" } }),
      "scripts/agent-dev.sh",
    );
    expect(script.content).toContain(
      'CARD_ADDRESS="${A2A_GOOSE_CARD_ADDRESS:-${A2A_GOOSE_TAILNET_NAME:-nas-box}}"',
    );
  });

  // What the address resolver actually returns, run against a stub tailscale.
  // Textual assertions are not enough here: the bug this replaces was a
  // `jq`/`sed` expression that read a *name* where the caller needed an address,
  // and only running it shows which address comes out.
  describe("the address it advertises", () => {
    // Addresses here are what a stubbed `tailscale` answers with; nothing is
    // dialled, and the tailnet's own 100.x range is how the real output looks.
    /* eslint-disable sonarjs/no-hardcoded-ip */
    const IP = "100.72.205.65";
    const JSON_WITH_NAME = JSON.stringify({
      Self: {
        DNSName: "genproj.tail86fd19.ts.net.",
        TailscaleIPs: [IP, "fd7a:115c::1"],
      },
      Peer: {
        n1: {
          DNSName: "peer.tail86fd19.ts.net.",
          TailscaleIPs: ["100.99.99.99"],
        },
      },
    });

    const stub = (body) => `#!/bin/sh\n${body}\n`;

    const runResolver = async (tailscale) => {
      const dir = mkdtempSync(join(tmpdir(), "agent-dev-address-"));
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      if (tailscale) {
        const path = join(bin, "tailscale");
        writeFileSync(path, tailscale, { mode: 0o755 });
      }
      const script = byPath(await withAgent(), "scripts/agent-dev.sh");
      const [resolver] = script.content.match(
        /^resolve_card_address\(\) \{[\s\S]*?\n\}/m,
      );
      const runner = join(dir, "run.sh");
      writeFileSync(
        runner,
        [
          "set -uo pipefail",
          'CARD_ADDRESS=""',
          resolver,
          // A resolver that refuses says so; it must never fall back to loopback.
          `if resolve_card_address; then printf '%s' "$CARD_ADDRESS"; else printf 'UNRESOLVED'; fi`,
        ].join("\n"),
      );
      const result = spawnSync("bash", [runner], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      return result.stdout.trim();
    };

    it("prefers the tailnet IP, even when the name is right there", async () => {
      const address = await runResolver(
        stub(
          `case "$1" in\n  ip) echo "${IP}" ;;\n  status) printf '%s' '${JSON_WITH_NAME}' ;;\nesac`,
        ),
      );
      expect(address).toBe(IP);
    });

    it("reads this node's own address, not a peer's, when ip -4 is unavailable", async () => {
      const address = await runResolver(
        stub(
          `case "$1" in\n  ip) exit 1 ;;\n  status) printf '%s' '${JSON_WITH_NAME}' ;;\nesac`,
        ),
      );
      expect(address).toBe(IP);
      expect(address).not.toBe("100.99.99.99");
    });

    it("falls back to the name only when there is no address at all", async () => {
      const address = await runResolver(
        stub(
          `case "$1" in\n  ip) exit 1 ;;\n  status) printf '%s' '{"Self":{"DNSName":"genproj.tail86fd19.ts.net."},"Peer":{}}' ;;\nesac`,
        ),
      );
      expect(address).toBe("genproj.tail86fd19.ts.net");
    });

    it("reports nothing rather than guessing when tailscale cannot answer", async () => {
      const address = await runResolver(
        stub(`case "$1" in\n  ip) exit 1 ;;\n  status) exit 1 ;;\nesac`),
      );
      expect(address).toBe("UNRESOLVED");
    });
    /* eslint-enable sonarjs/no-hardcoded-ip */
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

  it("falls back to the shared common project for its secrets", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    // The repo's own Doppler config first, so a repo that wants its own token
    // keeps it, then the shared project every container can read.
    expect(script.content).toContain(
      'doppler secrets get "${key}" --project "${COMMON_PROJECT}" --config "${COMMON_CONFIG}" --plain',
    );
    expect(script.content).toContain(
      'COMMON_PROJECT="${A2A_GOOSE_COMMON_PROJECT:-common}"',
    );
    expect(script.content).toContain(
      'COMMON_CONFIG="${A2A_GOOSE_COMMON_CONFIG:-prd}"',
    );
  });

  it("does not launch into a refusal it can already see coming", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    // a2a-goose refuses to start without a bearer token, so a start with none
    // reports that reason and returns instead of logging a refusal later.
    expect(script.content).toContain("^A2A_GOOSE_BEARER_TOKEN=");
    expect(script.content).toContain("write_env_file || return 0");
    expect(script.content).toContain("no A2A_GOOSE_BEARER_TOKEN is available");
  });
});

describe("container-agent: the goose the script starts", () => {
  // The devcontainer's shell reaches goose through a Doppler wrapper; the agent
  // starts goose itself, so it has to carry goose's own provider settings into
  // the env file. Without them the agent registers and every turn fails with
  // "Failed to resolve provider: Configuration value not found: GOOSE_PROVIDER"
  // - found live on genproj-dev, 2026-09-18.
  const SECRETS = {
    A2A_GOOSE_BEARER_TOKEN: "bearer-xyz",
    LITELLM_MASTER_KEY: "master-xyz",
    LITELLM_BASE_URL: "http://nas:4000",
    GOOSE_SERVER__SECRET_KEY: "server-xyz",
    GOOSE_PROVIDER: "litellm",
    GOOSE_MODEL: "deepseek-v4-flash",
    GOOSE_PROVIDER__API_KEY: "sk-provider",
    LITELLM_HOST: "http://nas:4000",
    LITELLM_API_KEY: "sk-litellm",
  };

  const dopplerStub = (keys) =>
    [
      "#!/bin/sh",
      'key="$3"',
      'case "$key" in',
      ...Object.entries(keys).map(([k, v]) => `  ${k}) echo "${v}" ;;`),
      "  *) exit 1 ;;",
      "esac",
    ].join("\n");

  const writeEnvFile = async (keys) => {
    const dir = mkdtempSync(join(tmpdir(), "agent-dev-env-"));
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "doppler"), dopplerStub(keys), { mode: 0o755 });
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    const scriptPath = join(dir, "agent-dev.sh");
    writeFileSync(scriptPath, script.content);
    const driver = join(dir, "run.sh");
    writeFileSync(
      driver,
      [
        "set -uo pipefail",
        "unset GOOSE_DISABLE_KEYRING",
        `source ${scriptPath} 2>/dev/null`,
        "write_env_file",
        `printf 'rc=%s\\n' "$?"`,
      ].join("\n"),
    );
    const home = join(dir, "home");
    mkdirSync(home, { recursive: true });
    const result = spawnSync("bash", [driver], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    const envFile = join(home, ".config", "a2a-goose", "env");
    const contents = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
    return {
      contents,
      stderr: result.stderr,
      mode: existsSync(envFile) ? statSync(envFile).mode & 0o777 : null,
    };
  };

  it("writes goose's provider settings beside the agent's own secrets", async () => {
    const { contents, mode } = await writeEnvFile(SECRETS);
    expect(contents).toContain("A2A_GOOSE_BEARER_TOKEN=bearer-xyz");
    expect(contents).toContain("GOOSE_PROVIDER=litellm");
    expect(contents).toContain("GOOSE_MODEL=deepseek-v4-flash");
    expect(contents).toContain("GOOSE_PROVIDER__API_KEY=sk-provider");
    // goose would look for the key in a keyring that a container does not have.
    expect(contents).toContain("GOOSE_DISABLE_KEYRING=1");
    expect(mode).toBe(0o600);
  });

  it("stays fail-open, but says the turns will fail, when no provider is available", async () => {
    const agentKeysOnly = { ...SECRETS };
    for (const key of [
      "GOOSE_PROVIDER",
      "GOOSE_MODEL",
      "GOOSE_PROVIDER__API_KEY",
      "LITELLM_HOST",
      "LITELLM_API_KEY",
    ]) {
      delete agentKeysOnly[key];
    }
    const { contents, stderr } = await writeEnvFile(agentKeysOnly);
    expect(contents).toContain("A2A_GOOSE_BEARER_TOKEN=bearer-xyz");
    expect(contents).not.toContain("GOOSE_PROVIDER=");
    // Not a refusal - goose may find a provider in its own config file - but the
    // start says what will happen.
    expect(stderr).toContain("no goose provider configured");
  });

  it("reads the provider from goose/prd by default, overridable", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    expect(script.content).toContain(
      'PROVIDER_PROJECT="${A2A_GOOSE_PROVIDER_PROJECT:-goose}"',
    );
    expect(script.content).toContain(
      'PROVIDER_CONFIG="${A2A_GOOSE_PROVIDER_CONFIG:-prd}"',
    );
    expect(script.content).toContain("read_provider_secret");
  });

  it("reports the provider in status, so a silent agent is visible", async () => {
    const script = byPath(await withAgent(), "scripts/agent-dev.sh");
    expect(script.content).toContain("goose provider: %s");
    expect(script.content).toContain("turns will fail to resolve one");
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
