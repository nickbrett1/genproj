// src/handlers/generate.js

/**
 * POST /v1/generate
 *
 * Generates a project (repo, files and external-service wiring) from a project
 * configuration. Ported from ftn's
 * `routes/projects/genproj/api/generate/+server.js`.
 *
 * Authentication differs from the route it replaces: ftn resolved a session
 * cookie to a user and read per-user OAuth tokens for the external services.
 * Here the caller is authenticated as *ftn* by a shared secret, and the
 * external services use the deployment's own tokens. The JSON response shape is
 * unchanged, so ftn's old route can proxy straight through.
 */

import { requireService } from "../auth/service-secret.js";
import { json } from "../http.js";
import { ProjectGeneratorService } from "../generator/project-generator.js";
import {
  buildAuthTokens,
  buildProjectContext,
  handleGenprojErrorResult,
} from "../generator/project-context.js";

/**
 * Handles a project generation request.
 * @param {Request} request Incoming request.
 * @param {Record<string, unknown>} [env] Worker environment bindings.
 * @returns {Promise<Response>} The generation result, or an error response.
 */
export async function handleGenerate(request, env = {}) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(
      { message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const { name, selectedCapabilities } = body ?? {};

  if (!name || !selectedCapabilities) {
    return json({ message: "Missing required fields" }, { status: 400 });
  }

  const { identity, response } = await requireService(request, env);
  if (response) {
    return response;
  }

  return generateProjectResult(body, identity.userEmail, env);
}

/**
 * Generates a project and returns the HTTP result, without authenticating.
 *
 * Split out from {@link handleGenerate} so the MCP server — which has already
 * established who is asking, by a different mechanism — can run a generation
 * without inventing a service-secret request to hand to the HTTP guard.
 *
 * @param {object} body Validated request body (`name` and
 *   `selectedCapabilities` at minimum).
 * @param {string} userEmail Owning user, for the generated project's metadata.
 * @param {Record<string, unknown>} [env] Worker environment bindings.
 * @returns {Promise<Response>} The generation result, or an error response.
 */
export async function generateProjectResult(body, userEmail, env = {}) {
  try {
    const authTokens = buildAuthTokens(env);
    const service = new ProjectGeneratorService(authTokens);
    const projectContext = buildProjectContext(body, userEmail, authTokens);

    const result = await service.generateProject(projectContext);

    if (!result.success) {
      return handleGenprojErrorResult(result);
    }

    return json({
      message: "Project generated successfully",
      repositoryUrl: result.repository?.htmlUrl || "",
    });
  } catch (caught) {
    return json(
      { message: caught.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
