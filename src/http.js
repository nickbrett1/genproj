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
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, if-none-match",
  "expose-headers": "etag",
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
 * Strips a weak-validator prefix so `W/"x"` and `"x"` compare equal.
 * @param {string | null} value An If-None-Match header value.
 * @returns {string | null} The tag without its weak prefix.
 */
function normaliseTag(value) {
  return value?.trim().replace(/^W\//, "") ?? null;
}

/**
 * Evaluates an If-None-Match header against an ETag.
 * @param {string | null} header The If-None-Match header value.
 * @param {string} etag The current ETag, quoted.
 * @returns {boolean} True when the client's copy is still current.
 */
export function matchesEtag(header, etag) {
  if (!header) {
    return false;
  }
  return header
    .split(",")
    .map((candidate) => normaliseTag(candidate))
    .some((candidate) => candidate === "*" || candidate === etag);
}

/**
 * Serves a payload with a strong ETag and a short shared cache, answering 304
 * to matching conditional requests.
 * @param {Request} request Incoming request.
 * @param {unknown} body The payload.
 * @param {{ etag: string, maxAge?: number }} options ETag and cache lifetime.
 * @returns {Response} 200 with the body, or 304 without it.
 */
export function jsonWithEtag(request, body, { etag, maxAge = 300 }) {
  const quoted = `"${etag}"`;
  const headers = {
    etag: quoted,
    "cache-control": `public, max-age=${maxAge}`,
  };
  if (matchesEtag(request.headers.get("if-none-match"), quoted)) {
    return new Response(null, {
      status: 304,
      headers: { ...headers, ...CORS_HEADERS },
    });
  }
  return json(body, { headers });
}

/**
 * Identifies the running build.
 * @returns {{service: string, version: string}} Service name and version.
 */
export function buildInfo() {
  return { service: SERVICE, version: VERSION };
}
