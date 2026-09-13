// src/auth/service-secret.js

/**
 * Authentication for calls that arrive from `ftn` over the `GENPROJ` service
 * binding.
 *
 * A service binding is an internal handle rather than a network address, but
 * genproj also has a public `workers.dev` host, so a request that arrives in
 * `fetch()` cannot be told apart from an internet request on the strength of
 * having come over the binding. A shared secret is what makes the distinction.
 *
 * This is deliberately *not* a per-user credential. genproj does not need to
 * know which user is asking, only that it was ftn that asked; see
 * `ftn/webapp/docs/api-key-security-model.md`. Requests from the internet use a
 * PAT instead — see {@link ./pat.js} — and that is what `POST /mcp` uses.
 */

import { json } from "../http.js";

/** Header carrying the shared secret. */
export const SERVICE_SECRET_HEADER = "x-service-secret";

/** Header carrying the signed-in user's email, if there is one. */
export const USER_EMAIL_HEADER = "x-user-email";

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so the comparison runs over fixed-length inputs,
 * which also avoids short-circuiting on a length mismatch.
 * @param {string} presented The secret from the request.
 * @param {string} expected The secret from the environment.
 * @returns {Promise<boolean>} True when they are equal.
 */
async function secretsMatch(presented, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.at(index) ^ b.at(index);
  }
  return difference === 0;
}

/**
 * Authenticates a request as coming from ftn.
 *
 * @param {Request} request Incoming request.
 * @param {{ SERVICE_SECRET?: string }} [env] Worker environment.
 * @returns {Promise<{ userEmail: string } | null>} The caller's context, or null
 *   when the secret is missing or wrong. `userEmail` is whichever address the
 *   caller claimed, and is for logging only — it is never a basis for a decision.
 * @throws {Error} When `SERVICE_SECRET` is not configured on this deployment.
 *   That is a deployment fault, and failing loudly is better than silently
 *   rejecting every internal call.
 */
export async function authenticateService(request, env = {}) {
  const expected = env.SERVICE_SECRET;
  if (!expected) {
    throw new Error("SERVICE_SECRET is not configured");
  }

  const presented = request.headers.get(SERVICE_SECRET_HEADER);
  if (!presented) {
    return null;
  }

  if (!(await secretsMatch(presented, expected))) {
    return null;
  }

  return { userEmail: request.headers.get(USER_EMAIL_HEADER) || "" };
}

/**
 * Runs {@link authenticateService} and turns a failure into a response, so the
 * handlers share one shape of guard.
 *
 * @param {Request} request Incoming request.
 * @param {Record<string, unknown>} env Worker environment bindings.
 * @returns {Promise<{ identity: { userEmail: string } } | { response: Response }>}
 *   Either the authenticated identity or the response to return instead.
 */
export async function requireService(request, env) {
  let identity;
  try {
    identity = await authenticateService(request, env);
  } catch (caught) {
    return { response: json({ message: caught.message }, { status: 500 }) };
  }

  if (!identity) {
    return { response: json({ message: "Unauthorized" }, { status: 401 }) };
  }

  return { identity };
}
