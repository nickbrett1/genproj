// tests/routes.test.js

import { describe, expect, it } from "vitest";

import worker, { handleRequest } from "../src/index.js";
import { catalogVersion, capabilities } from "../src/catalog/index.js";

const get = (path, init) =>
  handleRequest(new Request(`https://genproj.example${path}`, init));

describe("GET /healthz", () => {
  it("reports liveness and the catalog version", async () => {
    const response = get("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "genproj",
      version: "1.0.0",
      catalogVersion,
      capabilities: capabilities.length,
    });
  });
});

describe("GET /v1/version", () => {
  it("reports the service and catalog versions", async () => {
    const response = get("/v1/version");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "genproj",
      version: "1.0.0",
      catalogVersion,
      capabilities: capabilities.length,
    });
  });
});

describe("GET /v1/catalog", () => {
  it("serves the public catalog with an ETag and a shared cache", async () => {
    const response = get("/v1/catalog");
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${catalogVersion}"`);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const body = await response.json();
    expect(body.catalogVersion).toBe(catalogVersion);
    expect(body.count).toBe(capabilities.length);
    expect(body.capabilities.map((capability) => capability.id)).toEqual(
      capabilities.map((capability) => capability.id),
    );
  });

  it("needs no authentication", async () => {
    expect(get("/v1/catalog").status).toBe(200);
  });

  it("answers 304 when the client already has this version", async () => {
    const response = get("/v1/catalog", {
      headers: { "if-none-match": `"${catalogVersion}"` },
    });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("serves the body for an out-of-date client", async () => {
    const response = get("/v1/catalog", {
      headers: { "if-none-match": '"stale"' },
    });
    expect(response.status).toBe(200);
  });

  it("serves the JSON Schema at a distinct ETag", async () => {
    const response = get("/v1/catalog/schema.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"schema-${catalogVersion}"`);

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

describe("worker entrypoint", () => {
  it("delegates to the router", async () => {
    const response = await worker.fetch(
      new Request("https://genproj.example/healthz"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ok");
  });
});
