// src/handlers/preview.js

/**
 * POST /v1/preview
 *
 * Generates a preview of the files and external-service changes a project
 * configuration would produce. Ported from ftn's
 * `routes/projects/genproj/api/preview/+server.js`, which stays in place as a
 * thin proxy for now.
 *
 * Preview is deliberately unauthenticated: it renders the same file set
 * generation would produce, without touching GitHub or any external service.
 * The response shape is kept byte-for-byte compatible with the old ftn route so
 * the proxy can pass it straight through.
 */

import { generatePreview } from "../generator/preview-generator.js";
import { error, json } from "../http.js";

/**
 * Handles a preview request.
 * @param {Request} request Incoming request.
 * @returns {Promise<Response>} The preview payload, or an error response.
 */
export async function handlePreview(request) {
  let projectConfig;
  try {
    projectConfig = await request.json();
  } catch {
    return error(400, "Request body must be valid JSON.");
  }

  const selectedCapabilities = projectConfig?.selectedCapabilities;
  if (
    !projectConfig ||
    !Array.isArray(selectedCapabilities) ||
    selectedCapabilities.length === 0
  ) {
    return error(400, "Missing projectConfig or selectedCapabilities.");
  }

  try {
    const preview = await generatePreview(projectConfig, selectedCapabilities);
    return json(preview);
  } catch (caught) {
    return json(
      { error: "Failed to generate preview", details: caught.message },
      { status: 500 },
    );
  }
}
