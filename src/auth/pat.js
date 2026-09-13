// src/auth/pat.js

/**
 * Worker-native personal access token (PAT) authentication.
 *
 * This replaces ftn's SvelteKit auth plumbing (`getCurrentUser` + the
 * cookie-backed session) for the generator endpoints. The token format and the
 * stored SHA-256 hashes are unchanged: genproj shares ftn's `API_KEYS_DB` D1
 * database and validates the same `pat_…` tokens against the `ApiKeys` table
 * via {@link ApiKeyService}.
 *
 * Tokens are read from either `Authorization: Bearer <token>` (the MCP and PAT
 * convention) or `X-API-Key: <token>`.
 */

import { ApiKeyService } from "./api-key-service.js";

/**
 * Extracts the raw PAT from a request.
 * @param {Request} request Incoming request.
 * @returns {string | null} The token, or null when none is present.
 */
export function readPat(request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token && token !== "undefined" ? token : null;
  }

  const apiKey = request.headers.get("x-api-key")?.trim();
  return apiKey && apiKey !== "undefined" ? apiKey : null;
}

/**
 * Authenticates a request against the PAT store.
 * @param {Request} request Incoming request.
 * @param {{ API_KEYS_DB?: unknown }} [env] Worker environment with the D1 binding.
 * @returns {Promise<{ userEmail: string, token: string } | null>} The
 *   authenticated identity, or null when the token is missing or invalid.
 * @throws {Error} When the database is unreachable or the rate limit is hit.
 */
export async function authenticatePat(request, env) {
  const token = readPat(request);
  if (!token) {
    return null;
  }

  const apiKeyService = new ApiKeyService(env);
  const userEmail = await apiKeyService.validateKey(token);
  if (!userEmail) {
    return null;
  }

  return { userEmail, token };
}
