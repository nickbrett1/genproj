// tests/routes.test.js

import { beforeEach, describe, expect, it, vi } from "vitest";

// The generate/conflicts handlers touch the network (GitHub et al.). The 401
// tests exercise the real router path down to the handler's guard, including
// the real service-secret comparison; the happy paths stub the generator
// service so no request leaves the process.
vi.mock("../src/generator/project-generator.js", () => ({
  ProjectGeneratorService: vi.fn(),
}));

// `agents/mcp` pulls in `cloudflare:` modules that only resolve inside workerd.
// The router test never gets past authentication on `/mcp`, so the handler is
// never built — it just has to be importable.
vi.mock("agents/mcp", () => ({ createMcpHandler: vi.fn() }));

import worker, { handleRequest } from "../src/index.js";
import { capabilities } from "../src/catalog/index.js";
import { ProjectGeneratorService } from "../src/generator/project-generator.js";

const get = (path, init) =>
  handleRequest(new Request(`https://genproj.example${path}`, init));

describe("GET /healthz", () => {
  it("reports liveness", async () => {
    const response = get("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "genproj",
      version: "1.0.0",
      capabilities: capabilities.length,
    });
  });
});

describe("GET /v1/version", () => {
  it("reports the service version", async () => {
    const response = get("/v1/version");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "genproj",
      version: "1.0.0",
      capabilities: capabilities.length,
    });
  });
});

describe("GET /v1/catalog", () => {
  it("serves the public catalog with a shared cache", async () => {
    const response = get("/v1/catalog");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("etag")).toBeNull();

    const body = await response.json();
    expect(body.count).toBe(capabilities.length);
    expect(body.capabilities.map((capability) => capability.id)).toEqual(
      capabilities.map((capability) => capability.id),
    );
  });

  it("needs no authentication", async () => {
    expect(get("/v1/catalog").status).toBe(200);
  });

  it("serves the JSON Schema", async () => {
    const response = get("/v1/catalog/schema.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");

    const schema = await response.json();
    expect(schema.title).toBe("genproj capability catalog");
    expect(schema.$defs.capability.required).toContain("authServices");
  });
});

describe("GET /", () => {
  it("lists the endpoints", async () => {
    const response = get("/");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "genproj",
      version: "1.0.0",
      endpoints: [
        "/healthz",
        "/v1/version",
        "/v1/catalog",
        "/v1/catalog/schema.json",
        "POST /v1/preview",
        "POST /v1/generate",
        "POST /v1/conflicts",
        "POST /mcp",
      ],
    });
  });
});

describe("POST /v1/preview", () => {
  const post = (path, body) =>
    handleRequest(
      new Request(`https://genproj.example${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("generates a preview for a valid selection", async () => {
    const response = await post("/v1/preview", {
      name: "preview-demo",
      selectedCapabilities: ["shell-tools", "devcontainer-node"],
      configuration: {},
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.summary.projectName).toBe("preview-demo");
  });

  it("rejects a body without selectedCapabilities", async () => {
    const response = await post("/v1/preview", { projectName: "nope" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/selectedCapabilities/);
  });

  it("rejects a malformed JSON body", async () => {
    const response = await post("/v1/preview", "{not json");
    expect(response.status).toBe(400);
  });
});

describe("POST /v1/generate", () => {
  const SECRET = { "x-service-secret": "test-secret" };
  const post = (body, headers = SECRET) =>
    handleRequest(
      new Request("https://genproj.example/v1/generate", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { SERVICE_SECRET: "test-secret" },
    );

  let generateProject;

  beforeEach(() => {
    generateProject = vi.fn();
    ProjectGeneratorService.mockImplementation(function () {
      return { generateProject };
    });
  });

  it("rejects a request with no service secret", async () => {
    const response = await post(
      { name: "demo", selectedCapabilities: ["coding-agents"] },
      {},
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Unauthorized" });
    expect(generateProject).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong service secret", async () => {
    const response = await post(
      { name: "demo", selectedCapabilities: ["coding-agents"] },
      { "x-service-secret": "not-the-secret" },
    );
    expect(response.status).toBe(401);
    expect(generateProject).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body", async () => {
    const response = await post("{not json");
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/valid JSON/);
  });

  it("rejects a body without the required fields", async () => {
    const response = await post({ name: "demo" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Missing required fields",
    });
  });

  it("generates a project for a trusted caller", async () => {
    generateProject.mockResolvedValue({
      success: true,
      repository: { htmlUrl: "https://github.com/dev/demo" },
    });

    const response = await post(
      { name: "demo", selectedCapabilities: ["coding-agents"] },
      { "x-service-secret": "test-secret", "x-user-email": "dev@example.com" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Project generated successfully",
      repositoryUrl: "https://github.com/dev/demo",
    });
    expect(generateProject).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "demo",
        userId: "dev@example.com",
      }),
    );
  });

  it("leaves userId empty when the caller names no user", async () => {
    // The email is a log label, not an identity, so its absence is not an error.
    generateProject.mockResolvedValue({
      success: true,
      repository: { htmlUrl: "" },
    });

    const response = await post({
      name: "demo",
      selectedCapabilities: ["coding-agents"],
    });

    expect(response.status).toBe(200);
    expect(generateProject).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "" }),
    );
  });

  it("maps a repository-exists failure to 409", async () => {
    generateProject.mockResolvedValue({
      success: false,
      errorCode: "REPOSITORY_EXISTS",
    });

    const response = await post({
      name: "demo",
      selectedCapabilities: ["coding-agents"],
    });

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("REPOSITORY_EXISTS");
  });

  it("maps a token failure in the result to 401", async () => {
    generateProject.mockResolvedValue({
      success: false,
      error: "GitHub token not found for user",
    });

    const response = await post({
      name: "demo",
      selectedCapabilities: ["coding-agents"],
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      message: "GitHub token not found for user",
    });
  });

  it("returns 500 when generation throws", async () => {
    generateProject.mockRejectedValue(new Error("boom"));

    const response = await post({
      name: "demo",
      selectedCapabilities: ["coding-agents"],
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "boom" });
  });
});

describe("POST /v1/conflicts", () => {
  const SECRET = { "x-service-secret": "test-secret" };
  const post = (body, headers = SECRET) =>
    handleRequest(
      new Request("https://genproj.example/v1/conflicts", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { SERVICE_SECRET: "test-secret" },
    );

  let checkConflicts;

  beforeEach(() => {
    checkConflicts = vi.fn();
    ProjectGeneratorService.mockImplementation(function () {
      return { checkConflicts };
    });
  });

  it("rejects a request with no service secret", async () => {
    const response = await post(
      { name: "demo", selectedCapabilities: ["coding-agents"] },
      {},
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Unauthorized" });
    expect(checkConflicts).not.toHaveBeenCalled();
  });

  it("rejects a body without the required fields", async () => {
    const response = await post({ name: "demo" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Missing required fields",
    });
  });

  it("returns the conflicts for a trusted caller", async () => {
    checkConflicts.mockResolvedValue([
      { path: "src/app.html", generatedContent: "new", existingContent: "old" },
    ]);

    const response = await post(
      { name: "demo", selectedCapabilities: ["coding-agents"] },
      { "x-service-secret": "test-secret", "x-user-email": "dev@example.com" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      conflicts: [
        {
          path: "src/app.html",
          generatedContent: "new",
          existingContent: "old",
        },
      ],
    });
    expect(checkConflicts).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: "demo",
        userId: "dev@example.com",
      }),
    );
  });

  it("maps a missing GitHub token to 401", async () => {
    checkConflicts.mockRejectedValue(
      new Error("GitHub authentication required for conflict checking"),
    );

    const response = await post({
      name: "demo",
      selectedCapabilities: ["coding-agents"],
    });

    expect(response.status).toBe(401);
    expect((await response.json()).message).toMatch(
      /GitHub authentication required/,
    );
  });

  it("returns 500 when the check throws", async () => {
    checkConflicts.mockRejectedValue(new Error("boom"));

    const response = await post({
      name: "demo",
      selectedCapabilities: ["coding-agents"],
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "boom" });
  });
});

describe("method handling", () => {
  it("answers the CORS preflight without a body", () => {
    const response = get("/v1/catalog", { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects writes", async () => {
    const response = get("/v1/catalog", { method: "POST" });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({
      error: "Method POST not allowed.",
      status: 405,
      service: "genproj",
    });
  });
});

describe("unknown routes", () => {
  it("404s", async () => {
    const response = get("/v1/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "No route for /v1/nope.",
      status: 404,
      service: "genproj",
    });
  });
});

describe("POST /mcp", () => {
  it("is routed, and refuses an anonymous caller", async () => {
    const response = await handleRequest(
      new Request("https://genproj.example/mcp", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatch(/personal access token/);
  });
});

describe("worker entrypoint", () => {
  it("delegates to the router", async () => {
    const response = await worker.fetch(
      new Request("https://genproj.example/healthz"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });
});
