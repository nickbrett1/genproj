// tests/http.test.js

import { describe, expect, it } from "vitest";

import { CORS_HEADERS, buildInfo, error, json } from "../src/http.js";

describe("json", () => {
  it("serialises pretty JSON with the public CORS headers", async () => {
    const response = json({ a: 1 });
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe('{\n\t"a": 1\n}\n');
  });

  it("lets a caller override the status and headers", () => {
    const response = json(
      { a: 1 },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("error", () => {
  it("reports the status and a message", async () => {
    const response = error(404, "No route.");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "No route.",
      status: 404,
      service: "genproj",
    });
  });
});

describe("buildInfo", () => {
  it("identifies the service", () => {
    expect(buildInfo()).toEqual({ service: "genproj", version: "1.0.0" });
  });

  it("uses permissive CORS headers for the public surface", () => {
    expect(CORS_HEADERS["access-control-allow-origin"]).toBe("*");
    expect(CORS_HEADERS["access-control-allow-methods"]).toBe(
      "GET, POST, OPTIONS",
    );
  });
});
