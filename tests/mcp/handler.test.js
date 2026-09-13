// tests/mcp/handler.test.js

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("agents/mcp", () => ({
  createMcpHandler: vi.fn(),
}));
vi.mock("../../src/auth/pat.js", () => ({
  authenticatePat: vi.fn(),
}));

import { createMcpHandler } from "agents/mcp";
import { authenticatePat } from "../../src/auth/pat.js";
import { handleMcpRequest } from "../../src/mcp/handler.js";

const post = (url = "https://genproj.example/mcp") =>
  new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer pat_test" },
    body: "{}",
  });

describe("POST /mcp", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createMcpHandler.mockReturnValue(() => new Response("handled"));
  });

  it("rejects a request with no usable token", async () => {
    authenticatePat.mockResolvedValue(null);

    const response = await handleMcpRequest(post());

    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatch(/personal access token/);
    expect(createMcpHandler).not.toHaveBeenCalled();
  });

  it("reports a rate-limited token as 429", async () => {
    authenticatePat.mockRejectedValue(new Error("Rate limit exceeded"));

    const response = await handleMcpRequest(post());

    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatch(/Rate limit/);
  });

  it("reports any other authentication failure as 500", async () => {
    authenticatePat.mockRejectedValue(new Error("D1 down"));

    const response = await handleMcpRequest(post());

    expect(response.status).toBe(500);
  });

  it("serves the MCP endpoint with the caller's identity", async () => {
    authenticatePat.mockResolvedValue({
      userEmail: "dev@example.com",
      token: "pat_test",
    });

    const response = await handleMcpRequest(post(), { ENV: 1 });

    expect(await response.text()).toBe("handled");
    expect(createMcpHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ route: "/mcp" }),
    );
  });

  it("refuses a session id that belongs to another token", async () => {
    authenticatePat.mockResolvedValue({
      userEmail: "dev@example.com",
      token: "pat_test",
    });

    const response = await handleMcpRequest(
      post("https://genproj.example/mcp?sessionId=abc--pat_other"),
    );

    expect(response.status).toBe(403);
    expect(createMcpHandler).not.toHaveBeenCalled();
  });

  it("accepts a session id minted for this token", async () => {
    authenticatePat.mockResolvedValue({
      userEmail: "dev@example.com",
      token: "pat_test",
    });

    const response = await handleMcpRequest(
      post("https://genproj.example/mcp?sessionId=abc--pat_test"),
    );

    expect(response.status).toBe(200);
    expect(createMcpHandler).toHaveBeenCalled();
  });
});
