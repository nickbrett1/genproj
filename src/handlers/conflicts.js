// src/handlers/conflicts.js

/**
 * POST /v1/conflicts
 *
 * Reports the files an existing repository has that differ from what generation
 * would produce. Ported from ftn's
 * `routes/projects/genproj/api/conflicts/+server.js`.
 *
 * As with generate, authentication moves from ftn's session cookie to a PAT and
 * the external services use the deployment's tokens. The JSON response shape
 * (`{ conflicts }`) is unchanged.
 */

import { authenticatePat } from "../auth/pat.js";
import { json } from "../http.js";
import { ProjectGeneratorService } from "../generator/project-generator.js";
import {
  buildAuthTokens,
  resolveCapabilityDependencies,
} from "../generator/project-context.js";

/**
 * Handles a conflict-check request.
 * @param {Request} request Incoming request.
 * @param {Record<string, unknown>} [env] Worker environment bindings.
 * @returns {Promise<Response>} The conflicts, or an error response.
 */
export async function handleConflicts(request, env = {}) {
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

    // Instantiate the robust service.
    const service = new ProjectGeneratorService(authTokens);

    // Prepare context for conflict check (dependencies resolved so the
    // generated file set matches what generation will actually produce).
    const projectContext = {
      projectName: name,
      capabilities: resolveCapabilityDependencies(selectedCapabilities),
      configuration: {},
      authTokens,
      userId: identity.userEmail,
    };

    const conflicts = await service.checkConflicts(projectContext);

    return json({ conflicts });
  } catch (caught) {
    if (caught.message?.includes("GitHub authentication required")) {
      return json({ message: caught.message }, { status: 401 });
    }
    return json(
      { message: caught.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
