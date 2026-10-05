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
  ruffCheckCommand,
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
      "agent/history.py",
      "agent/roost.py",
      "agent/.env.example",
      "agent/README.md",
      "prompts/instructions.md",
      "tests/test_a2a_wire.py",
      "tests/test_history.py",
      "tests/test_roost.py",
      "tests/conftest.py",
    ]) {
      expect(paths).toContain(path);
    }

    for (const file of files) {
      if (
        file.filePath.startsWith("agent/") ||
        file.filePath === "prompts/instructions.md" ||
        file.filePath.startsWith("tests/")
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
    // Pinned to the exact SDK version the LiteLLM gateway's A2A client uses:
    // matching the client is what removes the client/server wire skew. The
    // `sqlite` extra pulls SQLAlchemy + aiosqlite for the durable task store.
    expect(pyproject).toContain('"a2a-sdk[http-server,sqlite]==1.1.0"');
    expect(pyproject).toContain('"uvicorn');
    // The roost fleet client speaks roost protocol v1 over a WebSocket.
    expect(pyproject).toContain('"websockets>=14"');
    // `agent/` ships in the image AND is importable in tests, so the suite needs
    // no sys.path shim.
    expect(pyproject).toContain('"agent"');
    expect(pyproject).toContain("[tool.setuptools.package-dir]");
    // FastA2A is the library whose card lied about its dialect; it must be gone.
    expect(pyproject).not.toContain("fasta2a");
  });

  it("carries the skill list into the card as Python dicts", () => {
    const data = getCapabilityTemplateData("pydantic-agent", context());
    expect(data.agentSkillsLiteral).toContain('"id": "answer"');
    expect(data.agentSkillsLiteral).toContain(
      '"input_modes": ["application/json"]',
    );
  });
});

describe("pydantic-agent wire honesty (a2a-sdk server, honest card)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("serves A2A from the official a2a-sdk, not FastA2A", async () => {
    const files = await generateAllFiles(context());
    const main = files.find((f) => f.filePath === "agent/main.py").content;
    expect(main).toContain(
      "from a2a.server.request_handlers import DefaultRequestHandler",
    );
    expect(main).toContain("create_jsonrpc_routes");
    expect(main).toContain("create_agent_card_routes");
    expect(main).toContain("AgentExecutor");
    // No FastA2A import: the explanatory docstring may name it, the code must not.
    expect(main).not.toMatch(/^\s*(from|import)\s+fasta2a/m);
  });

  it("derives the advertised dialect from the dialect the endpoint accepts", async () => {
    const files = await generateAllFiles(context());
    const main = files.find((f) => f.filePath === "agent/main.py").content;
    // The card's interface version and the accepted-dialect set share ONE value,
    // so no change can make the card claim a dialect the endpoint rejects.
    expect(main).toContain('PROTOCOL_VERSION = "1.0"');
    expect(main).toContain(
      "SUPPORTED_DIALECTS: frozenset[str] = frozenset({PROTOCOL_VERSION})",
    );
    expect(main).toContain("SEND_METHOD_BY_DIALECT");
    expect(main).toContain("protocol_version=PROTOCOL_VERSION");
    expect(main).toContain('enable_v0_3_compat="0.3" in SUPPORTED_DIALECTS');
  });

  it("preserves the output mode, validator loop and token cap", async () => {
    const files = await generateAllFiles(context());
    const main = files.find((f) => f.filePath === "agent/main.py").content;
    // PromptedOutput, not the default ToolOutput and not NativeOutput: a
    // thinking model rejects both (tool_choice / response_format unavailable).
    expect(main).toContain("output_type=PromptedOutput(AgentResult)");
    expect(main).not.toMatch(/output_type=ToolOutput/);
    expect(main).not.toMatch(/output_type=NativeOutput/);
    expect(main).toContain("model_settings=ModelSettings(max_tokens=4096)");
    expect(main).toContain("agent.output_validator(validate_agent_result)");
    expect(main).toContain('retries={"output": 3}');
  });

  it("emits the wire-honesty regression test into the scaffold's own suite", async () => {
    const files = await generateAllFiles(context());
    const test = files.find((f) => f.filePath === "tests/test_a2a_wire.py");
    expect(test).toBeTruthy();
    // It checks the SERVED card (serialised by the SDK), not the raw object.
    expect(test.content).toContain("agent_card_to_dict");
    expect(test.content).toContain("supportedInterfaces");
    expect(test.content).toContain("SUPPORTED_DIALECTS");
    expect(test.content).toContain("SEND_METHOD_BY_DIALECT");
    // And it dials the endpoint to prove the advertised method is routed.
    expect(test.content).toContain("TestClient");
    expect(test.content).toContain("-32601");
  });

  it("emits skills as JSON-serialisable dicts so served and registered cards agree", async () => {
    const files = await generateAllFiles(context());
    const card = files.find((f) => f.filePath === "agent/card.py").content;
    expect(card).toContain("AGENT_SKILLS: list[dict]");
    expect(card).toContain('"id": "answer"');
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

describe("pydantic-agent registration robustness (registry.rs parity)", () => {
  // The generated `agent/register.py` used to trust `GET /v1/agents` as if it
  // were authoritative. It is not: the listing is filtered by the calling key's
  // owner, so a row this agent owns can be invisible to it. The failure is a
  // permanent duplicate-name refusal at every restart, logged as if the gateway
  // were at fault. These tests pin the four behaviours ported from a2a-goose's
  // `src/registry.rs`, plus the tolerant listing shape, so the regression
  // cannot return silently.
  let register;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const files = await generateAllFiles(context());
    register = files.find((f) => f.filePath === "agent/register.py").content;
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps the proxy_admin user-key credential and the fail-open posture", () => {
    // Constraints: the credential choice (and its rationale) and "a gateway
    // outage must never stop the agent serving" are deliberate and stay.
    expect(register).toContain("proxy_admin` USER");
    expect(register).toContain("NOT the");
    expect(register).toContain("master key");
    expect(register).toContain("fail open; will retry on restart");
    // The card is unchanged: the protocolVersion pin travels in the payload.
    expect(register).toContain('"protocolVersion": protocol_version');
  });

  it("falls back to the by-id read, which is not filtered by owner", () => {
    expect(register).toContain("_agent_id_by_remembered_id");
    expect(register).toContain('f"{LITELLM_BASE_URL}/v1/agents/{remembered}"');
    expect(register).toContain("if response.status_code == 404:");
    // A row that now names a different agent is never adopted.
    expect(register).toContain("not adopting it");
    expect(register).toContain("_find_by_name(response, agent_name)");
  });

  it("remembers the assigned id between runs, tolerantly", () => {
    expect(register).toContain("AGENT_STATE_DIR");
    expect(register).toContain("REMEMBERED_ID_FILENAME");
    expect(register).toContain("_remembered_id_path");
    // Write (atomic) and read are both present.
    expect(register).toContain("_remember_agent_id");
    expect(register).toContain("temporary.write_text");
    expect(register).toContain("temporary.replace(path)");
    expect(register).toContain("_remembered_agent_id");
    expect(register).toContain("read_text");
    // An unwritable or unconfigured path must not fail a registration.
    expect(register).toMatch(
      /except Exception as exc:[\s\S]*registration still succeeded/,
    );
  });

  it("reclaims a taken name instead of failing, keyed on the body not the status", () => {
    expect(register).toContain("_is_duplicate_name");
    // The live proxy answers 500 with Prisma's message; the documented shape is
    // 400 "already exists". The body string is the honest key.
    expect(register).toContain('"Unique constraint failed"');
    expect(register).toContain('"already exists"');
    // On refusal: re-look-up, then rewrite in place.
    expect(register).toMatch(
      /if _is_duplicate_name\(response\):[\s\S]*_find_agent_id\(client, headers, agent_name\)[\s\S]*await _update\(client, headers, agent_id, payload\)/,
    );
  });

  it("reports a name it cannot resolve honestly, not as a proxy fault", () => {
    expect(register).toContain("_name_taken_message");
    expect(register).toContain("IS registered and addressable by");
    expect(register).toContain("listing-filter problem");
    expect(register).toContain("not a proxy fault");
    // It must not collapse into the generic fail-open line.
    expect(register).toMatch(
      /print\(_name_taken_message\(agent_name, response\.text\), flush=True\)/,
    );
  });

  it("treats a listing that is not an array as 'not listed'", () => {
    // `{}` or an HTML error page must not raise and stop a host registering.
    expect(register).toMatch(
      /if not isinstance\(listed, list\):\s*\n\s*return None/,
    );
    expect(register).toContain("except ValueError:");
  });

  it("documents the state path's durability and the listing filter in the README", async () => {
    const files = await generateAllFiles(context());
    const readme = files.find((f) => f.filePath === "agent/README.md").content;
    const env = files.find((f) => f.filePath === "agent/.env.example").content;

    expect(readme).toContain("filtered by the");
    expect(readme).toContain("AGENT_STATE_DIR");
    expect(readme).toContain("not** filtered");
    expect(env).toContain("AGENT_STATE_DIR=");
    // The "do not reimplement the gateway's controls" instruction is untouched.
    expect(readme).toContain("Do not reimplement these in the agent");
  });
});

describe("pydantic-agent roost session history", () => {
  // The capability previously generated NO roost client at all, so an agent
  // appeared in the fleet (or not) with no way to answer a History panel. This
  // block pins the whole surface: the client, the durable store it reads, the
  // wiring, and the two regression tests that keep "advertised" == "answered".
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const read = (files, path) => files.find((f) => f.filePath === path).content;

  it("emits a roost client that advertises activity, status and sessions", async () => {
    const files = await generateAllFiles(context());
    const roost = read(files, "agent/roost.py");

    expect(roost).toContain(
      'CAPABILITIES = ["activity", "status", "sessions"]',
    );
    // The capability -> method table is what the "advertised == answered"
    // regression test checks against the dispatch table.
    expect(roost).toContain("CAPABILITY_METHODS");
    expect(roost).toContain("_REQUEST_HANDLERS");
    // The whole history family, plus the lighter sessions.list.
    for (const method of [
      '"sessions.list"',
      '"history.sessions"',
      '"history.session"',
      '"history.messages"',
      '"history.search"',
      '"status.get"',
    ]) {
      expect(roost).toContain(method);
    }
    // No hub address is invented; the client is fail-open and reconnecting.
    expect(roost).toContain("ROOST_HUB_URL");
    expect(roost).toContain("backoff");
  });

  it("reads transcript history from the A2A task store, persisted in SQLite", async () => {
    const files = await generateAllFiles(context());
    const history = read(files, "agent/history.py");

    expect(history).toContain("class TaskHistory");
    expect(history).toContain("build_task_store");
    expect(history).toContain("DatabaseTaskStore");
    expect(history).toContain("a2a_tasks.db");
    expect(history).toContain("AGENT_STATE_DIR");
    // Retention is bounded and swept on startup: 200 sessions / 30 days.
    expect(history).toContain("DEFAULT_MAX_SESSIONS = 200");
    expect(history).toContain("DEFAULT_MAX_AGE_DAYS = 30");
    expect(history).toContain("retention_sweep");
    // The response shapes the roost UI reads, field by field.
    expect(history).toContain('"sessionId"');
    expect(history).toContain('"messageCount"');
    expect(history).toContain('"nextCursor"');
  });

  it("wires the durable store and TaskHistory into the A2A app", async () => {
    const files = await generateAllFiles(context());
    const main = read(files, "agent/main.py");

    expect(main).toContain(
      "from agent.history import TaskHistory, build_task_store",
    );
    expect(main).toContain("TaskHistory(store)");
    expect(main).toContain("InMemoryTaskStore");
    // Fail-open: a store that cannot be built still serves, in memory.
    expect(main).toContain("if store is None:");
    // Retention is swept on startup, fail-open.
    expect(main).toMatch(/retention_sweep\(\)/);
    // End-to-end turns must land in the store: the Task is enqueued before any
    // status update, the fix that makes a turn readable as history.
    expect(main).toContain("new_task_from_user_message");
    expect(main).toContain("await event_queue.enqueue_event(initial_task)");
    // The primary response envelope is unchanged.
    expect(main).toContain("output_type=PromptedOutput(AgentResult)");
  });

  it("emits the capability-honesty and history regression tests plus a conftest", async () => {
    const files = await generateAllFiles(context());
    const roostTest = read(files, "tests/test_roost.py");
    const historyTest = read(files, "tests/test_history.py");
    const conftest = read(files, "tests/conftest.py");

    // The regression the task asked for: advertised == answered, over the real
    // dispatch table.
    expect(roostTest).toContain(
      "test_every_advertised_capability_is_actually_answered",
    );
    expect(roostTest).toContain("CAPABILITY_METHODS");
    expect(roostTest).toContain("_REQUEST_HANDLERS");

    // History is driven over a real SQLite store and a real loopback WebSocket.
    expect(historyTest).toContain("DatabaseTaskStore");
    expect(historyTest).toContain("websockets");
    expect(historyTest).toContain(
      "test_a_turn_through_the_app_is_readable_as_history",
    );

    expect(conftest).toContain("LITELLM_BASE_URL");
  });

  it("documents roost and the session-history store in the env example and README", async () => {
    const files = await generateAllFiles(context());
    const env = read(files, "agent/.env.example");
    const readme = read(files, "agent/README.md");

    expect(env).toContain("ROOST_HUB_URL=");
    expect(env).toContain("AGENT_STATE_DIR=");
    expect(readme).toContain("agent/roost.py");
    expect(readme).toContain("agent/history.py");
    expect(readme).toContain("a2a_tasks.db");
  });

  it("lints the top-level agent/ package, not just src/ and tests/", () => {
    // The agent's runnable code lives in `agent/`; `ruff check src tests` would
    // never see agent/roost.py or agent/history.py. The lint scope is widened
    // whenever the capability is present, and left alone otherwise.
    expect(ruffCheckCommand(context())).toBe("ruff check agent src tests");
    expect(ruffCheckCommand({ capabilities: ["devcontainer-python"] })).toBe(
      "ruff check src tests",
    );
  });
});

describe("pydantic-agent card-URL guard (reachability from the proxy host)", () => {
  const read = (files, path) => files.find((f) => f.filePath === path).content;

  it("refuses the loopback/wildcard card URL at startup, like container-agent", async () => {
    const files = await generateAllFiles(context());
    const main = read(files, "agent/main.py");

    // The guard mirrors container-agent's `resolve_card_address()`: the URL the
    // proxy dials must not be this host.
    expect(main).toContain("def resolve_card_url(");
    expect(main).toContain("_is_loopback_or_wildcard");
    // The generated default IS loopback-wildcard, so it is refused rather than
    // advertised.
    expect(main).toContain('DEFAULT_CARD_URL = "http://0.0.0.0:');
    // Enforced at import: the module cannot load advertising a bad address.
    expect(main).toContain("CARD_URL = resolve_card_url()");
  });

  it("ships a test that the guard fires and that a dialable URL passes", async () => {
    const files = await generateAllFiles(context());
    const wireTest = read(files, "tests/test_a2a_wire.py");

    expect(wireTest).toContain(
      "test_guard_refuses_a_loopback_or_wildcard_card_url",
    );
    expect(wireTest).toContain("test_guard_accepts_a_dialable_card_url");
    expect(wireTest).toContain("pytest.raises(ValueError)");
  });

  it("gives the generated suite a dialable A2A_CARD_URL so the import succeeds", async () => {
    const files = await generateAllFiles(context());
    const conftest = read(files, "tests/conftest.py");

    expect(conftest).toContain('os.environ.setdefault("A2A_CARD_URL"');
    // The default must not itself be loopback, or every test would fail to
    // import the module under test.
    expect(conftest).not.toMatch(/A2A_CARD_URL".*127\.0\.0\.1/);
    expect(conftest).not.toMatch(/A2A_CARD_URL".*localhost/);
  });
});
