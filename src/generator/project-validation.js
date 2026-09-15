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

/**
 * Per-target release builds are a *native* compile: one build step per target,
 * each producing an architecture-specific binary. Only a project whose primary
 * language is rust has a target to build, so `github-release.targets` on any
 * other language would emit N identical build steps that all produce the same
 * architecture-independent output, and N release assets keyed by a triple none
 * of them honours - a matrix that looks like it does something and does not.
 *
 * The guard is the honest version of that: say the vocabulary belongs to a
 * native build rather than emit steps that pretend.
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @throws {ValidationError} When targets are declared for a non-native language
 */
export function validateReleaseTargets(context) {
  const targets = context?.configuration?.["github-release"]?.targets;
  if (!Array.isArray(targets) || targets.length === 0) return;

  const language = resolveProjectLanguage(context);
  if (language === "rust") return;

  throw new ValidationError(
    `This project declares ${targets.length} release ` +
      `target${targets.length === 1 ? "" : "s"} (${targets.join(", ")}) but its ` +
      `primary language is "${language}". Targets are native build triples: ` +
      `they select one build step per platform and are the keys a launcher ` +
      `resolves the release manifest by. A "${language}" project's output is ` +
      `architecture independent, so it ships as one asset under the universal ` +
      `key instead. Declare "language": "rust", or clear ` +
      `github-release.targets.`,
    "targets",
  );
}
