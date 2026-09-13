// src/mcp/handler.js

/**
 * `POST /mcp` — the internet-facing MCP endpoint.
 *
 * This is the one genproj surface that is *not* reached through ftn: an MCP
 * client speaks to it directly, so there is no shared service secret to lean
 * on and the caller has to identify itself with a PAT. See
 * {@link ../auth/pat.js}; the tokens are the same `pat_…` values the
 * `/api-keys` UI issues, validated against the shared `API_KEYS_DB`.
 *
 * Requests that arrive from ftn over the `GENPROJ` service binding use
 * `x-service-secret` instead and never touch this module.
 */

import { createMcpHandler } from "agents/mcp";
import { authenticatePat } from "../auth/pat.js";
import { json } from "../http.js";
import { createGenprojMcpServer } from "./server.js";

/**
 * Origins allowed to call `/mcp` from a browser. Server-side MCP clients send
 * no `Origin` at all, which is the normal case for this endpoint.
 */
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://www.fintechnick.com",
  "https://genproj.nick-brett1.workers.dev",
];

/**
 * Authenticates a request and, if it passes, serves the MCP endpoint.
 * @param {Request} request Incoming request.
 * @param {Record<string, unknown>} [env] Worker environment bindings.
 * @returns {Promise<Response>} The MCP response, or an authentication error.
 */
export async function handleMcpRequest(request, env = {}) {
  let identity;
  try {
    identity = await authenticatePat(request, env);
  } catch (caught) {
    console.error("Failed to validate API key:", caught);
    if (caught.message === "Rate limit exceeded") {
      return json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429 },
      );
    }
    return json({ error: "Internal Server Error" }, { status: 500 });
  }

  if (!identity) {
    return json(
      { error: "Unauthorized: a valid personal access token is required" },
      { status: 401 },
    );
  }

  const { token } = identity;

  if (request.method === "POST") {
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (sessionId && !sessionId.endsWith(`--${token}`)) {
      return json(
        { error: "Forbidden: session does not match authentication token" },
        { status: 403 },
      );
    }
  }

  const server = createGenprojMcpServer({ userEmail: identity.userEmail, env });

  const requestOrigin = request.headers.get("Origin");
  const corsOrigin = ALLOWED_ORIGINS.includes(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0];

  const handler = createMcpHandler(server, {
    route: "/mcp",
    allowedOrigins: ALLOWED_ORIGINS,
    enableDnsRebindingProtection: true,
    corsOptions: {
      origin: corsOrigin,
      methods: "GET, POST, OPTIONS",
      headers: "Content-Type, Authorization",
      maxAge: 86_400,
    },
  });

  return handler(request, env, {});
}
