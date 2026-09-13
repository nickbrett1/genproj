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
 * genproj authenticates the request with a PAT (validated against ftn's shared
 * `API_KEYS_DB` store) and takes the identity from the token owner; the external
 * services use the deployment's own tokens. The JSON response shape is
 * unchanged, so ftn's old route can proxy straight through.
 */

import { authenticatePat } from "../auth/pat.js";
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

  let identity;
  try {
    identity = await authenticatePat(request, env);
  } catch (caught) {
    if (caught.message === "Rate limit exceeded") {
      return json({ message: caught.message }, { status: 429 });
    }
    return json(
      { message: caught.message || "Internal Server Error" },
      { status: 500 },
    );
  }
  if (!identity) {
    return json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const authTokens = buildAuthTokens(env);
    const service = new ProjectGeneratorService(authTokens);
    const projectContext = buildProjectContext(
      body,
      identity.userEmail,
      authTokens,
    );

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
