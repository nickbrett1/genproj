// src/index.js

/**
 * genproj — the capability catalog and project generator, extracted from `ftn`.
 *
 * Phase 0 serves the read-only surface: the capability catalog the `ftn` UI
 * renders from, plus liveness and version endpoints. Generation and the MCP
 * server land in later phases.
 *
 * Routes:
 *   GET /healthz                liveness, for Buildkite and the deploy check
 *   GET /v1/catalog             the capability catalog (public, ETag, cacheable)
 *   GET /v1/catalog/schema.json JSON Schema for the catalog
 *   GET /v1/version             service version and catalog version
 *   POST /v1/preview            generated file set (no auth, no side effects)
 *   POST /v1/generate           create/update a project (PAT-authenticated)
 *   POST /v1/conflicts          report files that would conflict (PAT)
 *   POST /mcp                   MCP server, for MCP clients (PAT)
 *   GET  /                      endpoint index
 */

import { buildCatalog, catalogVersion, capabilities } from "./catalog/index.js";
import catalogSchema from "./catalog/schema.json" with { type: "json" };
import { buildInfo, CORS_HEADERS, error, json, jsonWithEtag } from "./http.js";
import { handlePreview } from "./handlers/preview.js";
import { handleGenerate } from "./handlers/generate.js";
import { handleConflicts } from "./handlers/conflicts.js";
import { handleMcpRequest } from "./mcp/handler.js";

/** Seconds the catalog may be cached by a shared cache. */
const CATALOG_MAX_AGE = 300;

function healthz() {
  return json({
    status: "ok",
    ...buildInfo(),
    catalogVersion,
    capabilities: capabilities.length,
  });
}

function version() {
  return json({
    ...buildInfo(),
    catalogVersion,
    capabilities: capabilities.length,
  });
}

function index() {
  return json({
    ...buildInfo(),
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
}

/**
 * Routes a request.
 * @param {Request} request Incoming request.
 * @param {Record<string, unknown>} [env] Worker environment bindings.
 * @returns {Response | Promise<Response>} The response.
 */
export function handleRequest(request, env = {}) {
  const { pathname } = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (pathname === "/v1/preview" && request.method === "POST") {
    return handlePreview(request);
  }

  if (pathname === "/v1/generate" && request.method === "POST") {
    return handleGenerate(request, env);
  }

  if (pathname === "/v1/conflicts" && request.method === "POST") {
    return handleConflicts(request, env);
  }

  if (
    pathname === "/mcp" &&
    (request.method === "POST" || request.method === "GET")
  ) {
    return handleMcpRequest(request, env);
  }

  if (request.method !== "GET") {
    return error(405, `Method ${request.method} not allowed.`);
  }

  switch (pathname) {
    case "/":
      return index();
    case "/healthz":
      return healthz();
    case "/v1/version":
      return version();
    case "/v1/catalog":
      return jsonWithEtag(request, buildCatalog(), {
        etag: catalogVersion,
        maxAge: CATALOG_MAX_AGE,
      });
    case "/v1/catalog/schema.json":
      return jsonWithEtag(request, catalogSchema, {
        etag: `schema-${catalogVersion}`,
        maxAge: CATALOG_MAX_AGE,
      });
    default:
      return error(404, `No route for ${pathname}.`);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
