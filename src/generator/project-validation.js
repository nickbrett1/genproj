// src/generator/project-validation.js

/**
 * Generation guards: conditions that must fail loudly at generation time
 * because the alternative is a project that looks fine and is silently wrong.
 *
 * Each guard is a pure function over the generation context, so it is
 * unit-testable without generating a project. The callers (the file generator
 * and the preview generator) run them before emitting anything.
 */

import { ValidationError } from "./genproj-errors.js";
import { resolveProjectLanguage } from "./capability-template-utils.js";

/**
 * The primary language can be *derived* when there is at most one
 * `devcontainer-*` selected — the toolchain is unambiguous. With two or more
 * selected there is no fact to derive from, and every picker that guesses
 * (first-selected, fixed precedence) is order-dependent: selecting "rust then
 * python" and "python then rust" produce different projects, and one of the
 * languages is silently never built, tested or released.
 *
 * So 2+ devcontainers require the language to be **declared**. A default may be
 * shown in a UI, but it must be confirmed, because making it explicit is the
 * point: it removes order-dependence as a source of truth rather than
 * relocating it.
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @throws {ValidationError} When the language must be declared and is not
 */
export function validatePrimaryLanguage(context) {
  const devcontainers = (context?.capabilities || []).filter((capabilityId) =>
    capabilityId.startsWith("devcontainer-"),
  );
  if (devcontainers.length < 2) return;

  // `docker-container.language` is the deprecated alias; a project that sets
  // either has declared the language.
  const declared =
    context?.configuration?.language ??
    context?.configuration?.["docker-container"]?.language;
  if (typeof declared === "string" && declared.trim() !== "") return;

  const language = resolveProjectLanguage(context);
  throw new ValidationError(
    `This project selects ${devcontainers.length} devcontainers ` +
      `(${devcontainers.join(", ")}) but does not declare a primary language, ` +
      `so which one is built, tested and released is undefined and depends on ` +
      `selection order. Set "language" to one of python | node | java | rust ` +
      `(this would currently resolve to "${language}").`,
    "language",
  );
}
