// src/http.js

import { SERVICE, VERSION } from "./version.js";

const JSON_TYPE = "application/json; charset=utf-8";

/**
 * CORS headers for the public, read-only endpoints. The catalog has to be
 * reachable from a browser (the UI reads it without authenticating), so these
 * are deliberately permissive — nothing here is user-scoped or secret.
 */
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/**
 * Builds a JSON response.
 * @param {unknown} body Value to serialise.
 * @param {ResponseInit} [init] Response init; `headers` are merged over the defaults.
 * @returns {Response} The response.
 */
export function json(body, init = {}) {
  return new Response(JSON.stringify(body, null, "\t") + "\n", {
    ...init,
    headers: { "content-type": JSON_TYPE, ...CORS_HEADERS, ...init.headers },
  });
}

/**
 * Builds an error response.
 * @param {number} status HTTP status.
 * @param {string} message Human-readable error.
 * @returns {Response} The response.
 */
export function error(status, message) {
  return json({ error: message, status, service: SERVICE }, { status });
}

/**
 * Identifies the running build.
 * @returns {{service: string, version: string}} Service name and version.
 */
export function buildInfo() {
  return { service: SERVICE, version: VERSION };
}
