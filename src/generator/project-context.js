// src/generator/project-context.js

/**
 * Helpers the HTTP handlers use to turn a request body and the Worker
 * environment into a generation context.
 *
 * These are the Worker-native replacements for the parts of ftn's
 * `$lib/server/genproj-api-utils.js` that the generator endpoints need:
 *
 *   - `findCapabilityConflicts` / `resolveCapabilityDependencies` resolve the
 *     selection against the catalog (`src/catalog`), which is the single source
 *     of truth for dependencies and conflicts.
 *   - `buildAuthTokens` reads the deployment's service tokens from the Worker
 *     environment. ftn also looked up per-user OAuth tokens in D1 and fell back
 *     to a session cookie; genproj has neither, so a caller only gets the
 *     services the deployment itself is configured for.
 *   - `buildProjectContext` assembles the context both the generator and the
 *     conflict checker consume.
 *   - `handleGenprojErrorResult` maps a failed `GenerationResult` onto the same
 *     JSON shape (and status codes) ftn's route returned.
 */

import {
  findUnsatisfiedRequiresAny,
  getCapabilityById,
} from "../catalog/index.js";
import { json } from "../http.js";
import { resolveBuildkiteDeployment } from "./external-services.js";

/**
 * Detects mutually exclusive capability selections (symmetric conflicts).
 * @param {string[]} selectedCapabilities Selected capability IDs.
 * @returns {string[]} Human-readable conflict descriptions.
 */
export function findCapabilityConflicts(selectedCapabilities) {
  const selected = new Set(selectedCapabilities);
  const conflicting = [];
  for (const id of selectedCapabilities) {
    const capability = getCapabilityById(id);
    if (!capability) continue;
    for (const conflictId of capability.conflicts ?? []) {
      if (selected.has(conflictId)) {
        conflicting.push(`${id} conflicts with ${conflictId}`);
      }
    }
  }
  return conflicting;
}

/**
 * Expands a capability selection with its declared dependencies (recursively,
 * depth-first, dependencies before dependents). Unknown IDs pass through
 * unchanged. This mirrors ftn's `resolveCapabilityDependencies` so generation
 * and the conflict check see the same file set as the old route.
 * @param {string[]} selectedCapabilities Selected capability IDs.
 * @returns {string[]} Selection including all required dependencies.
 */
export function resolveCapabilityDependencies(selectedCapabilities) {
  const resolved = [];
  const seen = new Set();

  const visit = (id) => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const capability = getCapabilityById(id);
    if (capability?.dependencies?.length) {
      for (const dependency of capability.dependencies) {
        visit(dependency);
      }
    }
    resolved.push(id);
  };

  for (const id of selectedCapabilities) {
    visit(id);
  }
  return resolved;
}

/**
 * Reads the deployment's external-service tokens from the Worker environment.
 *
 * Unlike ftn, there is no per-user token store and no session cookie here: the
 * PAT authenticates the caller, but each external service is provisioned with
 * the *deployment's* token (synced from Doppler by the deploy job). A service
 * the deployment has no token for is simply absent from the result, and the
 * generator will ask for it in the usual way.
 * @param {Record<string, unknown>} [env] Worker environment bindings.
 * @returns {Record<string, string | undefined>} Tokens keyed by service.
 */
export function buildAuthTokens(env = {}) {
  return {
    github: env.GITHUB_TOKEN || env.GITHUB_ACCESS_TOKEN,
    circleci: env.CIRCLECI_TOKEN,
    buildkite: env.BUILDKITE_TOKEN,
    doppler: env.DOPPLER_TOKEN,
    sonarcloud: env.SONARQUBE_TOKEN,
  };
}

/**
 * Assembles the context consumed by {@link ProjectGeneratorService}.
 * @param {object} payload Parsed request body.
 * @param {string} userId Authenticated identity (the PAT owner's email).
 * @param {Record<string, string | undefined>} authTokens Service tokens.
 * @param {Record<string, unknown>} [env] Worker environment bindings, used to
 *   resolve deployment-level identity (currently the Buildkite organisation
 *   and cluster).
 * @returns {object} The project generation context.
 * @throws {Error} When the selection contains conflicting capabilities.
 */
export function buildProjectContext(payload, userId, authTokens, env = {}) {
  const {
    name,
    repositoryUrl,
    selectedCapabilities,
    overwrite,
    resolutions,
    configuration,
  } = payload;

  // Mutual exclusion guard: deployment systems (and any other declared
  // conflicts) may not be selected together.
  const conflicts = findCapabilityConflicts(selectedCapabilities);
  if (conflicts.length > 0) {
    throw new Error(
      `Conflicting capabilities selected: ${conflicts.join("; ")}`,
    );
  }

  // Disjunctive requirements (`requiresAny`): a capability that needs *some*
  // provider (e.g. gitguardian needs a CI) fails here rather than generating a
  // project whose contributed step runs nowhere. The dependency expansion below
  // cannot cover this - it is an OR, not an AND.
  const capabilities = resolveCapabilityDependencies(selectedCapabilities);
  const unsatisfied = findUnsatisfiedRequiresAny(capabilities);
  if (unsatisfied.length > 0) {
    const { capability, anyOf } = unsatisfied[0];
    throw new Error(
      `${capability} requires a CI capability: select ${anyOf.join(" or ")}.`,
    );
  }

  return {
    projectName: name,
    repositoryUrl: repositoryUrl || "",
    // Expand the selection with declared dependencies (e.g. circleci
    // requires doppler so the goose CircleCI MCP extension gets its tokens).
    capabilities,
    // Capability-specific configuration (e.g. docker-container publishPort,
    // dataMounts, hostname). Defaults are applied by the generators.
    configuration: configuration || {},
    authTokens, // Passed down for specific needs
    // Deployment-level Buildkite identity, resolved from the Worker
    // environment so genproj is not pinned to one organisation.
    buildkiteDeployment: resolveBuildkiteDeployment(env),
    userId,
    overwrite: overwrite || false,
    resolutions: resolutions || null,
  };
}

/**
 * Maps a failed {@link GenerationResult} onto the JSON ftn's generate route
 * returned, preserving its status codes.
 * @param {{ error?: string, errorCode?: string }} result The failed result.
 * @returns {Response} The error response.
 */
export function handleGenprojErrorResult(result) {
  if (
    result.error &&
    (result.error.includes("Unauthorized") ||
      result.error.includes("GitHub token not found"))
  ) {
    return json({ message: result.error }, { status: 401 });
  }
  if (result.errorCode === "REPOSITORY_EXISTS") {
    return json(
      {
        message:
          "Repository already exists. Pass `overwrite: true` to regenerate into the existing repository (existing app code is preserved; generated infra files are updated).",
        code: "REPOSITORY_EXISTS",
      },
      { status: 409 },
    );
  }
  return json(
    { message: result.error || "Project generation failed" },
    { status: 500 },
  );
}
