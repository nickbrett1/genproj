/**
 * @fileoverview The `pydantic-agent` capability: a generated Pydantic AI agent
 * served over A2A and self-registered with the LiteLLM gateway.
 *
 * These tests pin the three things the capability must get right and cannot be
 * allowed to silently regress:
 *   1. it generates a complete, placeholder-free agent (the templates and the
 *      data generator agree);
 *   2. it wires the A2A listen port into the container's exposed/published port
 *      and REFUSES a disagreement (the resolver + guard from the memo's §7.2);
 *   3. it refuses the facts it cannot invent - a missing model or description -
 *      and derives the registered agent name from the repository name rather
 *      than accepting one that could collide with container-agent's `<repo>-dev`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import {
  resolveAgentListenPort,
  getCapabilityTemplateData,
} from "../../src/generator/capability-template-utils.js";
import { isAppOwnedPath } from "../../src/generator/genproj-overwrite.js";
import { ValidationError } from "../../src/generator/genproj-errors.js";
import { getCapabilityById } from "../../src/catalog/index.js";

const BASE_CAPABILITIES = [
  "devcontainer-python",
  "doppler",
  "pydantic-agent",
  "docker-container",
];

function context(overrides = {}) {
  return {
    projectName: "price-gate",
    capabilities: BASE_CAPABILITIES,
    configuration: {
      "pydantic-agent": {
        model: "gpt-4o-mini",
        description: "Prices data requests.",
        litellmBaseUrl: "http://litellm.nas:4000",
      },
      ...overrides.configuration,
    },
    ...overrides,
  };
}

describe("pydantic-agent generation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits the full agent shell with no unresolved placeholders", async () => {
    const files = await generateAllFiles(context());
    const paths = files.map((f) => f.filePath);

    for (const path of [
      "agent/main.py",
      "agent/model.py",
      "agent/contract.py",
      "agent/card.py",
      "agent/register.py",
      "agent/headers.py",
      "agent/.env.example",
      "agent/README.md",
      "prompts/instructions.md",
    ]) {
      expect(paths).toContain(path);
    }

    for (const file of files) {
      if (
        file.filePath.startsWith("agent/") ||
        file.filePath === "prompts/instructions.md"
      ) {
        expect(file.content).not.toMatch(/\{\{[^}]+\}\}/);
      }
    }
  });

  it("renders the agent name, port and model from the configuration", async () => {
    const files = await generateAllFiles(
      context({
        configuration: {
          "pydantic-agent": {
            model: "claude-sonnet",
            listenPort: 8123,
            description: "Prices data requests.",
          },
        },
      }),
    );
    const main = files.find((f) => f.filePath === "agent/main.py").content;
    const model = files.find((f) => f.filePath === "agent/model.py").content;

    expect(main).toContain('AGENT_NAME = "price-gate"');
    expect(main).toContain("--port 8123");
    expect(main).toContain('AGENT_DESCRIPTION = "Prices data requests."');
    expect(main).toContain('retries={"output": 3}');
    expect(model).toContain(
      'LITELLM_MODEL = os.environ.get("LITELLM_MODEL", "claude-sonnet")',
    );
  });

  it("adds each MCP tool URL as an MCPToolset, and omits the import when there are none", async () => {
    const withTools = await generateAllFiles(
      context({
        configuration: {
          "pydantic-agent": {
            model: "m",
            description: "Prices data requests.",
            toolUrls: ["http://nas:8781/mcp/data"],
          },
        },
      }),
    );
    const mainWithTools = withTools.find(
      (f) => f.filePath === "agent/main.py",
    ).content;
    expect(mainWithTools).toContain("from pydantic_ai.mcp import MCPToolset");
    expect(mainWithTools).toContain('MCPToolset("http://nas:8781/mcp/data")');
    expect(mainWithTools).toContain("toolsets=AGENT_TOOLSETS,");

    const withoutTools = await generateAllFiles(context());
    const mainWithout = withoutTools.find(
      (f) => f.filePath === "agent/main.py",
    ).content;
    expect(mainWithout).not.toContain("MCPToolset");
    expect(mainWithout).not.toContain("toolsets=");
  });

  it("emits no registration when registerAgent is false, even with a gateway", async () => {
    const files = await generateAllFiles(
      context({
        configuration: {
          "pydantic-agent": {
            model: "m",
            description: "d",
            litellmBaseUrl: "http://litellm.nas:4000",
            registerAgent: false,
          },
        },
      }),
    );
    expect(files.map((f) => f.filePath)).not.toContain("agent/register.py");
    const main = files.find((f) => f.filePath === "agent/main.py").content;
    expect(main).not.toContain("register_with_litellm(");
    expect(main).toMatch(/registerAgent is false/);
  });

  it("emits no registration when no gateway is specified", async () => {
    const files = await generateAllFiles(
      context({
        configuration: {
          "pydantic-agent": { model: "m", description: "d" },
        },
      }),
    );
    const paths = files.map((f) => f.filePath);
    expect(paths).not.toContain("agent/register.py");

    const main = files.find((f) => f.filePath === "agent/main.py").content;
    expect(main).not.toContain("from agent.register import");
    expect(main).not.toContain("register_with_litellm(");

    // The gateway address is not invented: the code reads it from the
    // environment and says so.
    const model = files.find((f) => f.filePath === "agent/model.py").content;
    expect(model).toContain('os.environ.get("LITELLM_BASE_URL")');
    expect(model).toContain("LITELLM_BASE_URL is not set");

    // The README drops the runbook and the register.py row, and says why.
    const readme = files.find((f) => f.filePath === "agent/README.md").content;
    expect(readme).not.toContain("| `agent/register.py`");
    expect(readme).not.toContain("Mint the registration credential");
    expect(readme).toContain("does **not** self-register");
  });

  it("bakes the gateway address as a fallback (overridable by env) when specified", async () => {
    const files = await generateAllFiles(context());
    const model = files.find((f) => f.filePath === "agent/model.py").content;
    expect(model).toContain(
      'os.environ.get("LITELLM_BASE_URL", "http://litellm.nas:4000")',
    );
  });

  it("declares the A2A runtime dependencies in pyproject.toml", async () => {
    const files = await generateAllFiles(context());
    const pyproject = files.find(
      (f) => f.filePath === "pyproject.toml",
    ).content;
    expect(pyproject).toContain('"pydantic-ai');
    expect(pyproject).toContain('"fasta2a[pydantic-ai]');
    expect(pyproject).toContain('"uvicorn');
  });

  it("carries the skill list into the card as a Python literal", () => {
    const data = getCapabilityTemplateData("pydantic-agent", context());
    expect(data.agentSkillsLiteral).toContain('id="answer"');
    expect(data.agentSkillsLiteral).toContain(
      'input_modes=["application/json"]',
    );
  });
});

describe("resolveAgentListenPort", () => {
  it("returns the configured listen port when pydantic-agent is selected", () => {
    expect(
      resolveAgentListenPort(
        context({ configuration: { "pydantic-agent": { listenPort: 7000 } } }),
      ),
    ).toBe(7000);
  });

  it("returns null when pydantic-agent is not selected", () => {
    expect(
      resolveAgentListenPort({ capabilities: ["devcontainer-python"] }),
    ).toBeNull();
  });
});

describe("pydantic-agent port guard (§7.2)", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("defaults the container's exposed port to the agent's listen port", async () => {
    const files = await generateAllFiles(context());
    const compose = files.find((f) => f.filePath === "docker-compose.yml");
    expect(compose.content).toContain("9999");
  });

  it("refuses an explicit container port that disagrees with listenPort", async () => {
    await expect(
      generateAllFiles(
        context({
          configuration: {
            "pydantic-agent": {
              model: "m",
              description: "d",
              listenPort: 9999,
            },
            "docker-container": { exposePort: 3000 },
          },
        }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a publishPort whose container side disagrees with listenPort", async () => {
    await expect(
      generateAllFiles(
        context({
          configuration: {
            "pydantic-agent": {
              model: "m",
              description: "d",
              listenPort: 9999,
            },
            "docker-container": { publishPort: "127.0.0.1:9999:3000" },
          },
        }),
      ),
    ).rejects.toThrow(/maps the container port 3000/);
  });

  it("accepts a matching publishPort", async () => {
    const files = await generateAllFiles(
      context({
        configuration: {
          "pydantic-agent": { model: "m", description: "d", listenPort: 9999 },
          "docker-container": { publishPort: "127.0.0.1:9999:9999" },
        },
      }),
    );
    expect(
      files.find((f) => f.filePath === "docker-compose.yml").content,
    ).toContain("127.0.0.1:9999:9999");
  });
});

describe("pydantic-agent guards (missing model or description)", () => {
  it("refuses a project with no model", async () => {
    await expect(
      generateAllFiles(context({ configuration: { "pydantic-agent": {} } })),
    ).rejects.toThrow(/declares no model/);
  });

  it("refuses a project with no description (the registry has nothing to match)", async () => {
    await expect(
      generateAllFiles(
        context({ configuration: { "pydantic-agent": { model: "m" } } }),
      ),
    ).rejects.toThrow(/declares no description/);
  });

  it("derives the registered agent name from the repository name", async () => {
    const files = await generateAllFiles(context());
    const main = files.find((f) => f.filePath === "agent/main.py").content;

    expect(main).toContain('AGENT_NAME = "price-gate"');
  });

  it("ignores an agentName in the configuration (the name is derived)", async () => {
    // The property is gone from the schema, but a client may still send it; a
    // value that is not honoured must not silently become the registered name,
    // or the one collision worth preventing (`<repo>-dev`) would come back
    // through the side door.
    const files = await generateAllFiles(
      context({
        configuration: {
          "pydantic-agent": {
            model: "m",
            description: "d",
            agentName: "price-gate-dev",
          },
        },
      }),
    );
    const main = files.find((f) => f.filePath === "agent/main.py").content;

    expect(main).toContain('AGENT_NAME = "price-gate"');
    expect(main).not.toContain("price-gate-dev");
  });

  it("refuses the project when no deployment capability is selected", async () => {
    await expect(
      generateAllFiles({
        projectName: "price-gate",
        capabilities: ["devcontainer-python", "doppler", "pydantic-agent"],
        configuration: { "pydantic-agent": { model: "m" } },
      }),
    ).rejects.toThrow(/requires a deployment capability/);
  });
});

describe("pydantic-agent overwrite policy", () => {
  it("treats the agent shell and instructions as app-owned", () => {
    expect(isAppOwnedPath("agent/contract.py")).toBe(true);
    expect(isAppOwnedPath("agent/card.py")).toBe(true);
    expect(isAppOwnedPath("prompts/instructions.md")).toBe(true);
  });
});

describe("pydantic-agent form hints (visibleWhen)", () => {
  // The form is schema-driven and has no conditional vocabulary of its own, so
  // the registration controls' relevance lives here. Without it the form offers
  // `registerAgent` (on by default) with no gateway to register with, and the
  // key that only registration reads, in every project.
  const properties =
    getCapabilityById("pydantic-agent").configurationSchema.properties;

  it("shows registerAgent only once a gateway address is given", () => {
    expect(properties.registerAgent.visibleWhen).toEqual({
      litellmBaseUrl: { not: [""] },
    });
  });

  it("shows the registration key only while self-registration is on", () => {
    expect(properties.registrationKeyEnv.visibleWhen).toEqual({
      registerAgent: [true],
    });
  });
});
