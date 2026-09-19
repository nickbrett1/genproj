// src/catalog/index.js

/**
 * The capability catalog.
 *
 * This is the single source of truth for the capabilities the generator can
 * apply to a project, and the metadata the UI renders. It was ported verbatim
 * from `ftn`'s `webapp/src/lib/config/capabilities.js` (metadata only — the
 * server-only `templates[]`/`templateId` entries moved with the generator in
 * the next phase), plus three derived fields that replace hardcodes which used
 * to live in the UI:
 *
 *   - `selectedByDefault` — previously the UI's `category === 'core'` check.
 *   - `authServices`      — previously a bespoke auth-service lookup map.
 *   - `provides`          — previously a hardcoded devcontainer→SonarCloud
 *                           language mapping (`getSonarCloudLanguageForDevcontainer`).
 *
 * The top-level `categories` array is the fourth: it replaces the UI's
 * hardcoded section order and headings (`categoryOrder` / `categoryNames`), so
 * adding a category is a catalog change alone.
 */

import catalog from "./catalog.json" with { type: "json" };

/** @typedef {typeof catalog.capabilities[number]} Capability */
/** @typedef {typeof catalog.categories[number]} Category */

export const capabilities = catalog.capabilities;

/** The UI sections capabilities are grouped into, in render order. */
export const categories = catalog.categories;

/** The catalog as served over HTTP. */
export function buildCatalog() {
  return { ...catalog, count: capabilities.length };
}

/**
 * Gets a category by its ID.
 * @param {string} id The category ID.
 * @returns {Category | undefined} The category, or undefined if unknown.
 */
export function getCategoryById(id) {
  return categories.find((category) => category.id === id);
}

/**
 * The categories a client should render as sections — the declared ones, in
 * `order`, minus the dependency-only ones (`visible: false`).
 * @returns {Category[]} The visible categories, ordered.
 */
export function getVisibleCategories() {
  return categories
    .filter((category) => category.visible !== false)
    .sort((a, b) => a.order - b.order);
}

/**
 * Gets a capability by its ID.
 * @param {string} id The ID of the capability.
 * @returns {Capability | undefined} The capability, or undefined if unknown.
 */
export function getCapabilityById(id) {
  return capabilities.find((capability) => capability.id === id);
}

/**
 * Gets all capabilities in a given category.
 * @param {string} category The category to filter by.
 * @returns {Capability[]} The matching capabilities.
 */
export function getCapabilitiesByCategory(category) {
  return capabilities.filter((capability) => capability.category === category);
}

/**
 * Gets the unique list of external services that require authentication for a
 * selection of capabilities.
 * @param {string[]} selectedIds An array of capability IDs.
 * @returns {string[]} A unique array of auth service names.
 */
export function getRequiredAuthServices(selectedIds) {
  const services = new Set();
  for (const id of selectedIds) {
    const capability = getCapabilityById(id);
    for (const service of capability?.authServices ?? []) {
      services.add(service);
    }
  }
  return [...services];
}

function checkDependencies(capability, selectedSet, missing) {
  for (const depId of capability.dependencies ?? []) {
    if (!selectedSet.has(depId)) {
      missing.push({ capability: capability.id, dependency: depId });
    }
  }
}

function checkConflicts(capability, selectedSet, conflicts) {
  for (const conflictId of capability.conflicts ?? []) {
    if (!selectedSet.has(conflictId)) {
      continue;
    }
    const alreadyExists = conflicts.some(
      (c) =>
        (c.capability1 === capability.id && c.capability2 === conflictId) ||
        (c.capability1 === conflictId && c.capability2 === capability.id),
    );
    if (!alreadyExists) {
      conflicts.push({ capability1: capability.id, capability2: conflictId });
    }
  }
}

/**
 * Validates the dependencies and conflicts of a selection of capabilities.
 * @param {string[]} selectedIds An array of capability IDs.
 * @returns {{valid: boolean, missing: {capability: string, dependency: string}[], conflicts: {capability1: string, capability2: string}[]}}
 */
export function validateCapabilityDependencies(selectedIds) {
  const missing = [];
  const conflicts = [];
  const selectedSet = new Set(selectedIds);

  for (const id of selectedIds) {
    const capability = getCapabilityById(id);
    if (capability) {
      checkDependencies(capability, selectedSet, missing);
      checkConflicts(capability, selectedSet, conflicts);
    }
  }

  return {
    valid: missing.length === 0 && conflicts.length === 0,
    missing,
    conflicts,
  };
}
