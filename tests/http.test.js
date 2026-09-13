// tests/http.test.js

import { describe, expect, it } from "vitest";

import {
  CORS_HEADERS,
  buildInfo,
  error,
  json,
  jsonWithEtag,
  matchesEtag,
} from "../src/http.js";

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

describe("matchesEtag", () => {
  it("is false without a header", () => {
    expect(matchesEtag(null, '"abc"')).toBe(false);
    expect(matchesEtag("", '"abc"')).toBe(false);
  });

  it("matches the quoted tag", () => {
    expect(matchesEtag('"abc"', '"abc"')).toBe(true);
  });

  it("matches a weak validator", () => {
    expect(matchesEtag('W/"abc"', '"abc"')).toBe(true);
  });

  it("matches a wildcard", () => {
    expect(matchesEtag("*", '"abc"')).toBe(true);
  });

  it("matches any candidate in a list, tolerating whitespace", () => {
    expect(matchesEtag('"x", W/"abc" , "y"', '"abc"')).toBe(true);
  });

  it("is false for a stale validator", () => {
    expect(matchesEtag('"stale"', '"abc"')).toBe(false);
  });
});

describe("jsonWithEtag", () => {
  const body = { hello: "world" };

  it("serves a cacheable body with a strong ETag", async () => {
    const response = jsonWithEtag(
      new Request("https://example.com/v1/catalog"),
      body,
      {
        etag: "abc",
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual(body);
  });

  it("honours a custom max age", () => {
    const response = jsonWithEtag(new Request("https://example.com/"), body, {
      etag: "abc",
      maxAge: 0,
    });
    expect(response.headers.get("cache-control")).toBe("public, max-age=0");
  });

  it("answers 304 to a matching conditional request", async () => {
    const request = new Request("https://example.com/v1/catalog", {
      headers: { "if-none-match": '"abc"' },
    });
    const response = jsonWithEtag(request, body, { etag: "abc" });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.text()).toBe("");
  });

  it("serves the body again for a stale conditional request", async () => {
    const request = new Request("https://example.com/v1/catalog", {
      headers: { "if-none-match": '"stale"' },
    });
    const response = jsonWithEtag(request, body, { etag: "abc" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
  });
});

describe("buildInfo", () => {
  it("identifies the service", () => {
    expect(buildInfo()).toEqual({ service: "genproj", version: "1.0.0" });
  });

  it("uses permissive CORS headers for the public surface", () => {
    expect(CORS_HEADERS["access-control-allow-origin"]).toBe("*");
    expect(CORS_HEADERS["access-control-allow-methods"]).toBe("GET, OPTIONS");
  });
});
