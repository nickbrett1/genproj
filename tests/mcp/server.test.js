// tests/mcp/server.test.js

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/handlers/generate.js", () => ({
  generateProjectResult: vi.fn(),
}));

import { capabilities } from "../../src/catalog/index.js";
import { generateProjectResult } from "../../src/handlers/generate.js";
import {
  generateProjectToolResult,
  listCapabilitiesResult,
  toolDefinitions,
} from "../../src/mcp/server.js";

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("MCP tool definitions", () => {
  it("advertises the two genproj tools ftn used to host", () => {
    expect(toolDefinitions().map((tool) => tool.name)).toEqual([
      "list_genproj_capabilities",
      "generate_project",
    ]);
  });

  it("requires a name and capabilities to generate", () => {
    const generate = toolDefinitions().find(
      (tool) => tool.name === "generate_project",
    );

    expect(generate.inputSchema.required).toEqual([
      "name",
      "selectedCapabilities",
    ]);
    expect(generate.inputSchema.properties.repositoryUrl).toBeTruthy();
    expect(generate.inputSchema.properties.configuration).toBeTruthy();
  });
});

describe("list_genproj_capabilities", () => {
  it("returns the catalog capability list as JSON", () => {
    const result = listCapabilitiesResult();
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.map((capability) => capability.id)).toEqual(
      capabilities.map((capability) => capability.id),
    );
  });
});

describe("generate_project", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a call with no name or capabilities", async () => {
    await expect(generateProjectToolResult({ name: "x" })).rejects.toThrow(
      "Missing required fields",
    );
    expect(generateProjectResult).not.toHaveBeenCalled();
  });

  it("passes the authenticated user through and returns the result", async () => {
    generateProjectResult.mockResolvedValue(
      jsonResponse(200, {
        message: "Project generated successfully",
        repositoryUrl: "https://github.com/example/thing",
      }),
    );

    const result = await generateProjectToolResult(
      { name: "thing", selectedCapabilities: ["docker-container"] },
      { userEmail: "dev@example.com", env: { GITHUB_TOKEN: "t" } },
    );

    expect(generateProjectResult).toHaveBeenCalledWith(
      { name: "thing", selectedCapabilities: ["docker-container"] },
      "dev@example.com",
      { GITHUB_TOKEN: "t" },
    );
    expect(JSON.parse(result.content[0].text).repositoryUrl).toBe(
      "https://github.com/example/thing",
    );
  });

  it("reports a failed generation as a tool error", async () => {
    generateProjectResult.mockResolvedValue(
      jsonResponse(409, { message: "REPOSITORY_EXISTS" }),
    );

    await expect(
      generateProjectToolResult({
        name: "thing",
        selectedCapabilities: ["docker-container"],
      }),
    ).rejects.toThrow("REPOSITORY_EXISTS");
  });
});
