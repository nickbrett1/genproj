// src/mcp/server.js

/**
 * The genproj MCP server.
 *
 * Ported from ftn's `$lib/server/mcp.js`, which used to expose the genproj
 * tools alongside its own. Those tools now live here, next to the code that
 * implements them, and are reached over the internet at `POST /mcp` — see
 * {@link ./handler.js}.
 *
 * The two tools mirror what ftn exposed, so existing MCP clients keep working:
 *   `list_genproj_capabilities` — the catalog of injectable capabilities
 *   `generate_project`          — create or update a repository
 *
 * Callers are PAT-authenticated by the handler before this server is built, so
 * every tool call here is already known to belong to `userEmail`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildCatalog } from "../catalog/index.js";
import { generateProjectResult } from "../handlers/generate.js";

/**
 * The tools this server advertises, in the shape `tools/list` expects.
 * Exported separately so tests and the handler can assert on it without
 * standing up the MCP protocol.
 * @returns {Array<{ name: string, description: string, inputSchema: object }>}
 */
export function toolDefinitions() {
  return [
    {
      name: "list_genproj_capabilities",
      description:
        "Returns the genproj capability catalog, the same document served by GET /v1/catalog: the injectable capabilities, the UI sections they are grouped into (`categories`), and the project-level `configurationSchema` (notably `language`, which becomes required when two or more devcontainer-* capabilities are selected).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "generate_project",
      description:
        "Triggers the generation of a new repository with selected capabilities.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the project" },
          selectedCapabilities: {
            type: "array",
            items: { type: "string" },
            description: "List of capability IDs to include",
          },
          repositoryUrl: {
            type: "string",
            description: "Target GitHub repository URL (optional)",
          },
          overwrite: {
            type: "boolean",
            description:
              "Set true to generate into an existing repository (repo must exist / be pre-created for private repos). Without it, generation fails with REPOSITORY_EXISTS.",
          },
          resolutions: {
            type: "object",
            description: "Conflict resolutions (optional)",
          },
          configuration: {
            type: "object",
            description:
              'Capability-specific configuration, e.g. { "docker-container": { "publishPort": "127.0.0.1:3000:3000", "dataMounts": [{ "hostPath": "/volume1/data", "containerPath": "/data", "readOnly": true }], "hostname": "nas.local", "aptPackages": ["iproute2", "curl"], "envVars": ["MCP_PORT=3001"], "command": ["/usr/local/bin/entrypoint.sh"], "healthcheck": "http:/healthz" }, "language": "python" } — language is normally derived from the devcontainer-* capability (optional). `language` is project-level, not capability-specific: it is optional when 0 or 1 devcontainer-* capability is selected and required when 2 or more are selected, where selection order would otherwise decide.',
          },
        },
        required: ["name", "selectedCapabilities"],
      },
    },
  ];
}

/**
 * Runs `list_genproj_capabilities`.
 *
 * Returns the whole catalog through {@link buildCatalog}, the single assembler
 * of the served shape, so the MCP plane and `GET /v1/catalog` cannot drift.
 * @returns {{ content: Array<{ type: string, text: string }> }} MCP tool result.
 */
export function listCapabilitiesResult() {
  return {
    content: [{ type: "text", text: JSON.stringify(buildCatalog()) }],
  };
}

/**
 * Runs `generate_project`.
 * @param {object} toolArguments Tool arguments as sent by the MCP client.
 * @param {{ userEmail?: string, env?: Record<string, unknown> }} context The
 *   authenticated caller and the Worker environment bindings.
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>} MCP
 *   tool result.
 * @throws {Error} When required arguments are missing, or generation fails.
 *   MCP reports a thrown error to the client as a failed tool call, which is
 *   the behaviour the ftn-hosted version had.
 */
export async function generateProjectToolResult(toolArguments, context = {}) {
  const { name, selectedCapabilities } = toolArguments ?? {};
  if (!name || !selectedCapabilities) {
    throw new Error("Missing required fields: name and selectedCapabilities.");
  }

  const response = await generateProjectResult(
    toolArguments,
    context.userEmail || "",
    context.env || {},
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.message || "Project generation failed");
  }

  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

/**
 * Creates the MCP server for one authenticated caller.
 * @param {{ userEmail?: string, env?: Record<string, unknown> }} context The
 *   authenticated caller and the Worker environment bindings.
 * @returns {Server} A configured MCP server.
 */
export function createGenprojMcpServer(context = {}) {
  const mcpServer = new Server(
    { name: "genproj-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions(),
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArguments } = request.params;

    switch (name) {
      case "list_genproj_capabilities":
        return listCapabilitiesResult();

      case "generate_project":
        return generateProjectToolResult(toolArguments, context);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return mcpServer;
}
