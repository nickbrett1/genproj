// src/generator/project-validation.js

/**
 * Generation guards: conditions that must fail loudly at generation time
 * because the alternative is a project that looks fine and is silently wrong.
 *
 * Each guard is a pure function over the generation context, so it is
 * unit-testable without generating a project. The callers (the file generator
 * and the preview generator) run them before emitting anything.
 */

import { findUnsatisfiedRequiresAny } from "../catalog/index.js";
import { ValidationError } from "./genproj-errors.js";
import { resolveProjectLanguage } from "./capability-template-utils.js";
import { TARGET_LABELS } from "./target-labels.js";

/**
 * Enforces the catalog's *disjunctive* requirements (`requiresAny`).
 *
 * A capability such as `gitguardian` needs *some* CI provider but not one in
 * particular - the secret scan is contributed by whichever CI capability is
 * selected. The catalog says so with `requiresAny: ["circleci", "buildkite"]`
 * rather than a hard dependency, and this guard turns that back into a
 * generation-time failure when neither is selected: without it a project would
 * generate "successfully" with a secret-scan capability that contributes
 * nothing and runs nowhere - the exact silent-omission the dependency model
 * exists to prevent, just with a disjunction.
 *
 * @param {Object} context - Generation context (capabilities)
 * @throws {ValidationError} When a `requiresAny` requirement is unmet
 */
export function validateRequiredAny(context) {
  const capabilities = context?.capabilities || [];
  const unsatisfied = findUnsatisfiedRequiresAny(capabilities);
  if (unsatisfied.length === 0) return;

  const { capability, anyOf } = unsatisfied[0];
  const alternatives = anyOf.join(" or ");
  throw new ValidationError(
    `This project selects ${capability}, which requires a CI capability: ` +
      `select ${alternatives}. ${capability} contributes a step to whichever ` +
      `CI provider is selected; with none selected it would generate but run ` +
      `nowhere.`,
    capability,
  );
}

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
 * A release label says which host may run an artifact, and there are two ways
 * to come by one - a *matrix* and a *single* artifact:
 *
 * 1. `github-release.targets` (plural) is a **native build matrix**: one build
 *    step per triple, each producing an architecture-specific binary. Only a
 *    rust project compiles per target, so `targets` on any other language would
 *    emit N identical steps that all produce the same architecture-independent
 *    output, keyed by triples none of them honours - a matrix that looks like it
 *    does something and does not.
 * 2. `github-release.target` (singular) is **one artifact that is genuinely
 *    platform-specific**: a Python app that bundles its own interpreter, a
 *    vendored Node or JRE. There is no matrix (one build), but the label is not
 *    `any` either, because the payload cannot run everywhere. Rust does not need
 *    it - a single rust target is a one-entry matrix and belongs in `targets`.
 *
 * Declaring both is ambiguous (is the one artifact also the Nth build?), so it
 * is refused rather than guessed at. The keys are the same `TARGET_LABELS` the
 * catalog publishes and a launcher resolves against - one vocabulary.
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @throws {ValidationError} When a declared label cannot mean what it says
 */
export function validateReleaseTargets(context) {
  const config = context?.configuration?.["github-release"] || {};
  const targets = Array.isArray(config.targets) ? config.targets : [];
  const target = typeof config.target === "string" ? config.target.trim() : "";

  if (targets.length > 0 && target !== "") {
    throw new ValidationError(
      `This project declares both github-release.targets ` +
        `(${targets.join(", ")}) and a singular github-release.target ` +
        `("${target}"). Targets is a build matrix - one build step per label - ` +
        `and Target is one artifact with one label; they are two different ` +
        `projects and cannot both be true. Keep targets for a per-platform ` +
        `build, or target for a single platform-specific artifact.`,
      "target",
    );
  }

  if (target !== "" && !TARGET_LABELS.includes(target)) {
    throw new ValidationError(
      `This project declares github-release.target "${target}", which is not ` +
        `a release label. Use one of ${TARGET_LABELS.join(", ")}.`,
      "target",
    );
  }

  const language = resolveProjectLanguage(context);

  if (targets.length > 0 && language !== "rust") {
    throw new ValidationError(
      `This project declares ${targets.length} release ` +
        `target${targets.length === 1 ? "" : "s"} (${targets.join(", ")}) but its ` +
        `primary language is "${language}". Targets are a native build matrix: ` +
        `one build step per platform, each producing an architecture-specific ` +
        `binary, and only rust compiles per target. A "${language}" project ` +
        `publishes one artifact, so declare its single label as ` +
        `github-release.target instead (or clear it - one that runs anywhere ` +
        `ships under the universal key). Declare "language": "rust" to build a ` +
        `matrix.`,
      "targets",
    );
  }

  if (target !== "" && language === "rust") {
    throw new ValidationError(
      `This project declares a singular github-release.target ("${target}") ` +
        `but its primary language is rust. A rust release compiles per target ` +
        `and publishes one asset per label, so a single target is a one-entry ` +
        `matrix: declare github-release.targets ["${target}"] instead.`,
      "target",
    );
  }
}

/**
 * The launcher has to be able to resolve *something* for the host it runs on,
 * and the payload it installs has to be runnable.
 *
 * Two conditions break that, and both fail silently if left to generation time:
 *
 * 1. **Java.** genproj generates a Java devcontainer and no build system, so a
 *    java release carries notes and no assets. A launcher for it would boot,
 *    find nothing, and never be able to update.
 * 2. **Rust with no targets.** A rust release publishes per-target assets: with
 *    no targets the build uploads `target/release/**`, nothing packs it into
 *    `release/`, and the manifest is never written. The launcher would resolve
 *    no label, forever - the worst outcome, because it looks installed and
 *    healthy.
 *
 * A node or python project is allowed: its release publishes one asset, and
 * the launcher's candidate list always ends in the universal key, so it can
 * resolve it. Such a project is *permitted* to be architecture-independent, not
 * guaranteed to be: one that bundles its own interpreter is platform-specific
 * and should declare github-release.target so the label tells the truth (see
 * validateReleaseTargets). Whether the asset is a *runnable payload* is the
 * project's business - see LAUNCHING.md - but the launcher can at least find
 * and install it.
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @throws {ValidationError} When the launcher could never resolve a payload
 */
export function validateFetchLaunch(context) {
  const capabilities = context?.capabilities || [];
  if (!capabilities.includes("fetch-launch")) return;

  const language = resolveProjectLanguage(context);

  if (language === "java") {
    throw new ValidationError(
      "This project selects fetch-launch, which installs and runs a release " +
        "artifact, but its primary language is java: genproj generates a java " +
        "devcontainer and no build system, so the release carries notes and no " +
        "assets and the launcher would have nothing to run. Give the project a " +
        "build that publishes an artifact, or drop fetch-launch.",
      "fetch-launch",
    );
  }

  const targets = context?.configuration?.["github-release"]?.targets;
  const hasTargets = Array.isArray(targets) && targets.length > 0;
  if (language === "rust" && !hasTargets) {
    throw new ValidationError(
      "This project selects fetch-launch but declares no " +
        "github-release.targets, so the release would publish no asset for a " +
        "launcher to resolve and it could never update. Set " +
        "github-release.targets to the platforms this project ships, for " +
        'example ["aarch64-apple-darwin", "x86_64-unknown-linux-musl"].',
      "targets",
    );
  }
}
