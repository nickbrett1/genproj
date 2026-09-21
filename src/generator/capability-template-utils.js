import { UNIVERSAL_TARGET, UNAME_CANDIDATES } from "./target-labels.js";
import { capabilities as catalogCapabilities } from "../catalog/index.js";

const catalogIndexById = new Map(
  catalogCapabilities.map((capability, index) => [capability.id, index]),
);

function getCatalogCapability(id) {
  return catalogCapabilities.find((capability) => capability.id === id);
}

/**
 * Whether a capability contributes the given `provides` type.
 *
 * The frontend build/stage/Dockerfile logic keys off the **contribution type**
 * (`frontend`) rather than a capability id, so a new frontend capability is
 * picked up without editing the template logic. `svelte` and `sveltekit` both
 * provide `frontend`.
 *
 * @param {Object} capability - A catalog capability
 * @param {string} type - The `provides[].type` to test
 * @returns {boolean}
 */
export function capabilityProvides(capability, type) {
  return (capability?.provides ?? []).some((entry) => entry.type === type);
}

/**
 * The selected capability ids that provide a contribution `type`.
 * @param {Object} context - Generation context (capabilities)
 * @param {string} type - The `provides[].type` to match
 * @returns {string[]}
 */
export function capabilityIdsProviding(context, type) {
  return (context?.capabilities || []).filter((id) =>
    capabilityProvides(getCatalogCapability(id), type),
  );
}

/**
 * Whether the selection has a frontend to build (any capability providing
 * `{ type: "frontend" }`). This answers "is there a frontend?" by contribution
 * type, so template logic does not hardcode `sveltekit`.
 * @param {Object} context - Generation context
 * @returns {boolean}
 */
export function hasFrontend(context) {
  return capabilityIdsProviding(context, "frontend").length > 0;
}

/**
 * The order capability templates are collected in, independent of the order
 * the caller happened to list the capabilities.
 *
 * Two capabilities may emit the same `filePath` — `svelte` writes the base
 * `svelte.config.js` and `sveltekit` overwrites it with the kit config — and the
 * catalog deliberately removed selection-order effects (for `language`), so the
 * precedence must not reintroduce one. This is a **dependency-first** order
 * (dependencies before dependents), ties broken by catalog order, so a superset
 * (`sveltekit` depends on `svelte`) is always collected after the thing it
 * supersedes. A last-wins dedupe then makes the superset win.
 *
 * @param {string[]} capabilityIds - Capability ids in any order
 * @returns {string[]} The same ids, in a canonical deterministic order
 */
export function canonicalCapabilityOrder(capabilityIds) {
  const byCatalogOrder = (a, b) =>
    (catalogIndexById.get(a) ?? Infinity) -
    (catalogIndexById.get(b) ?? Infinity);
  const selected = new Set(capabilityIds);
  const emitted = [];
  const visited = new Set();
  const visit = (capabilityId) => {
    if (visited.has(capabilityId)) return;
    visited.add(capabilityId);
    const dependencies = (
      getCatalogCapability(capabilityId)?.dependencies ?? []
    )
      .filter((dependency) => selected.has(dependency))
      .sort(byCatalogOrder);
    for (const dependency of dependencies) {
      visit(dependency);
    }
    emitted.push(capabilityId);
  };
  for (const capabilityId of [...capabilityIds].sort(byCatalogOrder)) {
    visit(capabilityId);
  }
  return emitted;
}

/**
 * The frontend capability whose configuration governs the scaffold, when more
 * than one frontend provider is selected.
 *
 * SvelteKit is a superset of Svelte (`sveltekit` depends on `svelte`), so when
 * both are selected it is SvelteKit's `directory`/`outputDirectory` that apply.
 * Rather than special-casing the id, this returns the provider that no other
 * selected provider depends on - the superset - which is deterministic and
 * independent of selection order.
 *
 * @param {Object} context - Generation context
 * @returns {string} A capability id, or "" when there is no frontend
 */
export function frontendCapabilityId(context) {
  const ids = capabilityIdsProviding(context, "frontend");
  if (ids.length <= 1) {
    return ids[0] || "";
  }
  const selected = new Set(ids);
  const dependsOnAnotherProvider = (id) => {
    const seen = new Set();
    const stack = [...(getCatalogCapability(id)?.dependencies ?? [])];
    while (stack.length > 0) {
      const dependency = stack.pop();
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      if (selected.has(dependency)) return true;
      stack.push(...(getCatalogCapability(dependency)?.dependencies ?? []));
    }
    return false;
  };
  return (
    ids.find((id) => !dependsOnAnotherProvider(id)) ??
    ids
      .slice()
      .sort(
        (a, b) =>
          (catalogIndexById.get(a) ?? Infinity) -
          (catalogIndexById.get(b) ?? Infinity),
      )[0]
  );
}

/**
 * Emits the `.agents/mcp_config.json` block — Cursor / Antigravity target.
 *
 * Target env contract (genproj-goose-env-refs): Cursor and Antigravity DO
 * expand unbraced `$VAR` references in the `env` map of an MCP server entry,
 * so `"CIRCLECI_TOKEN": "$CIRCLECI_TOKEN"` is valid HERE. This is NOT
 * interchangeable with goose's ~/.config/goose/config.yaml extension map,
 * which expands NOTHING (see assertNoGooseEnvVarReferences / getGooseMcpConfig).
 * Doppler is preferred when available; bare `$VAR` env refs are only a
 * fallback for tools that expand them.
 */
function getCodingAgentsTemplateData(context) {
  const hasSonarQube = context.capabilities.includes("sonarcloud");
  const hasCircleCI = context.capabilities.includes("circleci");
  const hasDoppler = context.capabilities.includes("doppler");
  const hasXcode = context.capabilities.includes("xcode-development");

  let sonarQubeMcpConfig = "";
  if (hasSonarQube) {
    if (hasDoppler) {
      sonarQubeMcpConfig = `,
    "sonarqube": {
      "command": "doppler",
      "args": [
        "run",
        "--",
        "npx",
        "-y",
        "sonarqube-mcp-server"
      ]
    }`;
    } else {
      sonarQubeMcpConfig = `,
    "sonarqube": {
      "command": "npx",
      "args": [
        "-y",
        "sonarqube-mcp-server"
      ],
      "env": {
        "SONAR_TOKEN": "$SONAR_TOKEN",
        "SONAR_HOST_URL": "$SONAR_HOST_URL"
      }
    }`;
    }
  }

  let circleCiMcpConfig = "";
  if (hasCircleCI) {
    if (hasDoppler) {
      circleCiMcpConfig = `,
    "circleci": {
      "command": "doppler",
      "args": [
        "run",
        "--",
        "npx",
        "-y",
        "@circleci/mcp-server-circleci"
      ]
    }`;
    } else {
      circleCiMcpConfig = `,
    "circleci": {
      "command": "npx",
      "args": [
        "-y",
        "@circleci/mcp-server-circleci"
      ],
      "env": {
        "CIRCLECI_TOKEN": "$CIRCLECI_TOKEN",
        "CIRCLE_API_TOKEN": "$CIRCLE_API_TOKEN"
      }
    }`;
    }
  }

  let githubMcpConfig = "";
  if (hasDoppler) {
    githubMcpConfig = `,
    "github": {
      "command": "doppler",
      "args": [
        "run",
        "--",
        "npx",
        "-y",
        "@modelcontextprotocol/server-github"
      ]
    }`;
  } else {
    githubMcpConfig = `,
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "$GITHUB_PERSONAL_ACCESS_TOKEN"
      }
    }`;
  }

  let dopplerMcpConfig = "";
  if (hasDoppler) {
    dopplerMcpConfig = `,
    "doppler": {
      "command": "sh",
      "args": [
        "-c",
        "DOPPLER_TOKEN=$(doppler configure get token --plain) npx -y @dopplerhq/mcp-server"
      ]
    }`;
  }

  let xcodeNativeMcpConfig = "";
  if (hasXcode) {
    xcodeNativeMcpConfig = `,
    "xcode-native": {
      "command": "node",
      "args": [
        ".agents/mcp-sse-proxy.cjs",
        "http://mac-studio:9876/sse"
      ]
    }`;
  }

  return {
    sonarQubeMcpConfig,
    circleCiMcpConfig,
    githubMcpConfig,
    dopplerMcpConfig,
    xcodeNativeMcpConfig,
  };
}

/**
 * Regression guard for goose extension YAML (memo genproj-goose-env-refs).
 *
 * Goose does NOT expand `${VAR}` or `$VAR` in a stdio extension's env map —
 * the value is passed VERBATIM to the child process. A token entry like
 * `CIRCLECI_TOKEN: "${CIRCLECI_TOKEN}"` makes the MCP server authenticate with
 * the 17-char literal `${CIRCLECI_TOKEN}` → `401 Unauthorized` on every call.
 *
 * Generated goose config must therefore NEVER reference env vars in extension
 * blocks. The canonical pattern is the Doppler wrapper:
 *   cmd: doppler
 *   args: ["run", "--", "npx", "-y", "<mcp-package>"]
 * If env must be inline (no Doppler), use `envs:` with literal values resolved
 * at generation time — never `${VAR}`/`$VAR` text.
 *
 * @param {string} yamlFragment - Goose extension YAML block (may be empty)
 * @param {string} key - Extension key, used in the error message
 * @throws {Error} When the fragment contains an env var reference
 */
function assertNoGooseEnvVarReferences(yamlFragment, key) {
  if (!yamlFragment) return;
  const refs = yamlFragment.match(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g) || [];
  if (refs.length > 0) {
    throw new Error(
      `goose extension '${key}' emits env var reference(s): ${refs.join(", ")}. ` +
        `Goose does not expand env refs in stdio extension env maps (the literal text would be used as the token → MCP 401). ` +
        `Use the doppler wrapper (cmd: doppler, args: ["run", "--", "npx", ...]) or literal envs: values resolved at generation time.`,
    );
  }
}

/**
 * Generates goose MCP server configuration YAML entries for a project's
 * generated `~/.config/goose/config.yaml` (extensions only).
 *
 * Migration (memo goose-mcp-groups-migration §3/§5 + handoff-goose-devcontainer-genproj):
 * MCPHub is now goose's single data plane. genproj no longer wires individual
 * per-capability hub-backed stdio servers — those arrive via the MCPHub `dev`
 * group, consumed as ONE auth-off `streamable_http` extension: `mcphub-dev`
 * (http://nas:8781/mcp/dev). `mcphub-dev` is ALWAYS emitted (default toolset).
 *
 * EXCEPTIONS — capabilities whose tooling is NOT carried by the `dev` group
 * (live membership confirmed on the hub) must stay as per-capability blocks so
 * nothing is silently dropped:
 *   - `sonarqube` (doppler-wrapped stdio) — sonarqube is NOT in `dev`; only
 *     emitted when the `sonarqube` + `doppler` capabilities are selected.
 *   - `xcode-native` (stdio proxy to mac-studio:9876/sse) — when xcode-development.
 *   - `svelte` (remote mcp.svelte.dev) — when sveltekit (dev has no svelte;
 *     it lives in the separate `dev-ui` group).
 *
 * Provider is intentionally NOT emitted (it resolves from the Doppler
 * environment at runtime — GOOSE_ALIAS runs goose under `doppler run`).
 *
 * @param {object} context - The project generation context with capabilities
 * @returns {object} Object with goose YAML config parts (mcphub-dev always present)
 */
function getGooseMcpConfig(context) {
  const caps = context?.capabilities || [];
  const hasSonarQube = caps.includes("sonarcloud");
  const hasDoppler = caps.includes("doppler");
  const hasXcode = caps.includes("xcode-development");
  const hasSvelte = hasFrontend(context);

  // MCPHub `dev` group — the default project toolset (auth-off end state).
  // No headers / env keys / envs: safe on a now auth-free trusted tailnet.
  let mcphubDevGooseConfig = `
  mcphub-dev:
    type: streamable_http
    name: mcphub-dev
    enabled: true
    uri: http://nas:8781/mcp/dev
    timeout: 300`;

  // sonarqube is NOT in the `dev` group, so a sonarcloud project still gets
  // its own doppler-wrapped stdio extension (kept as an exception — see the
  // doc comment above). Never emit a ${VAR}/$VAR env ref (goose passes those
  // verbatim → MCP 401); the doppler wrapper supplies secrets at runtime.
  let sonarQubeGooseConfig = "";
  if (hasSonarQube && hasDoppler) {
    sonarQubeGooseConfig = `
  sonarqube:
    type: stdio
    name: sonarqube
    enabled: true
    cmd: doppler
    args: ["run", "--", "npx", "-y", "sonarqube-mcp-server"]
    timeout: 300`;
  }

  let xcodeNativeGooseConfig = "";
  if (hasXcode) {
    xcodeNativeGooseConfig = `
  xcode-native:
    type: stdio
    name: xcode-native
    enabled: true
    cmd: node
    args: [".agents/mcp-sse-proxy.cjs", "http://mac-studio:9876/sse"]
    timeout: 300`;
  }

  // Svelte MCP is a remote (streamable HTTP) server, no secrets — see
  // https://svelte.dev/docs/ai/remote-setup
  let svelteGooseConfig = "";
  if (hasSvelte) {
    svelteGooseConfig = `
  svelte:
    type: streamable_http
    name: svelte
    enabled: true
    uri: https://mcp.svelte.dev/mcp
    description: Svelte MCP server (remote)
    timeout: 300`;
  }

  return {
    mcphubDevGooseConfig,
    sonarQubeGooseConfig,
    xcodeNativeGooseConfig,
    svelteGooseConfig,
  };
}

// The primary language is the single source of truth for the sonar flavour
// too. Rust has no mapping: emit no `sonar.*.reportPaths` line rather than
// defaulting to JavaScript, which used to write
// `sonar.javascript.lcov.reportPaths=...` for a project with no JavaScript in
// it — the default was a live latent bug for every unset sonarcloud project.
const SONAR_LANGUAGE_BY_PRIMARY = {
  python: "Python",
  node: "JavaScript",
  java: "Java",
};

function getSonarCloudTemplateData(context) {
  const config = context.configuration?.sonarcloud || {};
  const primary = resolveProjectLanguage(context);
  // `sonarcloud.language` is a deprecated explicit override, kept for one
  // release so an in-flight project does not change behaviour under it. New
  // projects declare the primary language instead.
  const language =
    config.language || SONAR_LANGUAGE_BY_PRIMARY[primary] || undefined;
  let languageSettings = "";

  switch (language) {
    case "JavaScript": {
      languageSettings = "sonar.javascript.lcov.reportPaths=coverage/lcov.info";

      break;
    }
    case "Python": {
      languageSettings = "sonar.python.coverage.reportPaths=coverage.xml";
      if (primary === "python") {
        languageSettings += "\nsonar.python.version=3.12";
      }

      break;
    }
    case "Java": {
      languageSettings = "sonar.java.binaries=.";

      break;
    }
    // No default: rust (and anything else) emits no reportPaths line.
  }

  const wranglerConfig = context.configuration?.["cloudflare-wrangler"] || {};
  const isRustWorker = wranglerConfig.workerType === "rust";
  const sonarSources = isRustWorker ? "worker/src" : "src";

  return {
    sonarLanguageSettings: languageSettings,
    organization: config.organization || "bem",
    sonarSources,
  };
}

function _applyGitGuardianConfig(
  data,
  context,
  contextEnabled,
  contextName,
  buildJobContext,
) {
  if (context.capabilities.includes("gitguardian")) {
    data.orbs += `  ggshield: gitguardian/ggshield@1\n`;
    data.buildWorkflowJob = `      - ggshield/scan:
          name: ggshield-scan${contextEnabled ? `\n          context: ${contextName}` : ""}
          base_revision: << pipeline.git.base_revision >>
          revision: <<pipeline.git.revision>>
      - build:
          requires:
            - ggshield-scan${buildJobContext}`;
  } else if (contextEnabled) {
    data.buildWorkflowJob = `      - build:${buildJobContext}`;
  }
}

/**
 * Adds the `install_doppler` command definition to the CircleCI config only
 * when a job actually invokes it (avoids dead code — nas-port-mcp bug 5:
 * defining the command with no consumer in the generated config).
 * @param {Object} data - CircleCI template data (mutated)
 */
function _ensureInstallDopplerCommand(data) {
  if (!data.commands.includes("install_doppler:")) {
    data.commands += `  install_doppler:
    description: "Install Doppler CLI"
    steps:
      - run:
          name: Install Doppler CLI
          command: |
            if ! command -v doppler &> /dev/null; then
              (curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh || wget -t 3 -qO- https://cli.doppler.com/install.sh) | sudo sh
            fi\n`;
  }
}

function _applyDopplerConfig(data, context) {
  // The only consumer of `install_doppler` for the doppler capability is the
  // Cloudflare secrets sync; emit the command only then.
  if (
    context.capabilities.includes("cloudflare-wrangler") &&
    context.capabilities.includes("doppler")
  ) {
    _ensureInstallDopplerCommand(data);
    data.preBuildSteps = `
      - install_doppler
      - run:
          name: Setup Wrangler Config
          command: |
            chmod +x scripts/setup-wrangler-config.sh
            ./scripts/setup-wrangler-config.sh`;
  }
}

function _applyLighthouseConfig(
  data,
  context,
  contextEnabled,
  contextName,
  branchGating,
) {
  const hasLighthouse = context.capabilities.includes("lighthouse-ci");
  if (hasLighthouse) {
    data.lighthouseJobDefinition = `
  lighthouse:
    executor: node/default
    steps:
      - checkout
      - node/install-packages:
          pkg-manager: npm
          override-ci-command: |
            if [ -f package-lock.json ]; then
              npm ci
            else
              npm install
            fi
      - run:
          name: Build
          command: npm run build
      - run:
          name: Run Lighthouse CI
          command: npm install -g @lhci/cli && lhci autorun`;
    // Branch gating: Lighthouse is a release-quality gate, so run it on
    // main only by default (also skips dependabot/** branches, which are
    // never `main`). Opt out with circleci.branchGating = false.
    const filters = branchGating
      ? `
          filters:
            branches:
              only: main`
      : "";
    data.lighthouseWorkflowJob = `
      - lighthouse:${contextEnabled ? `\n          context: ${contextName}` : ""}
          requires:
            - build${filters}`;
  }
}

function _applyCloudflareConfig(
  data,
  context,
  contextEnabled,
  contextName,
  branchGating,
) {
  if (context.capabilities.includes("cloudflare-wrangler")) {
    let setupWranglerStep = "";
    let syncSecretsStep = "";
    if (context.capabilities.includes("doppler")) {
      setupWranglerStep = `
      - install_doppler
      - run:
          name: Setup Wrangler Config
          environment:
            DOPPLER_CONFIG: << parameters.doppler_config >>
          command: |
            chmod +x scripts/setup-wrangler-config.sh
            ./scripts/setup-wrangler-config.sh "$DOPPLER_CONFIG"`;

      syncSecretsStep = `
      - run:
          name: Sync Doppler Secrets to Cloudflare
          environment:
            CLOUDFLARE_ENV: << parameters.environment >>
            DOPPLER_CONFIG: << parameters.doppler_config >>
          command: |
            chmod +x scripts/sync-doppler-secrets.sh
            if [ "$CLOUDFLARE_ENV" = "default" ] || [ -z "$CLOUDFLARE_ENV" ]; then
              ./scripts/sync-doppler-secrets.sh --config "$DOPPLER_CONFIG" --env "$CLOUDFLARE_ENV"
            else
              if ! ./scripts/sync-doppler-secrets.sh --config "$DOPPLER_CONFIG" --env "$CLOUDFLARE_ENV"; then
                echo "⚠️  Warning: Failed to sync secrets to Cloudflare preview."
              fi
            fi`;
    }

    const wranglerConfig = context.configuration?.["cloudflare-wrangler"] || {};
    const isRustWorker = wranglerConfig.workerType === "rust";
    let rustJobDefinition = "";
    let rustWorkflowJob = "";
    let installRustStep = "";
    let requiresList = "\n            - build";

    if (isRustWorker) {
      rustJobDefinition = `
  test-rust:
    docker:
      - image: cimg/rust:1.90.0
    steps:
      - checkout
      - restore_cache:
          keys:
            - cargo-cache-{{ checksum "worker/Cargo.toml" }}
            - cargo-cache-
      - run:
          name: Rust Toolchain Info
          command: rustc --version && cargo --version
      - run:
          name: Rust Test
          command: cd worker && cargo test
      - save_cache:
          paths:
            - ~/.cargo/registry
            - ~/.cargo/git
            - worker/target
          key: cargo-cache-{{ checksum "worker/Cargo.toml" }}\n`;

      rustWorkflowJob = `
      - test-rust:${contextEnabled ? `\n          context: ${contextName}` : ""}
          requires:
            - build`;

      installRustStep = `
      - run:
          name: Install Rust
          command: |
            if ! command -v cargo &> /dev/null; then
              curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
              echo 'source "$HOME/.cargo/env"' >> $BASH_ENV
            fi`;

      requiresList = `\n            - build\n            - test-rust`;
    }

    data.deployJobDefinition =
      rustJobDefinition +
      `
  deploy-to-cloudflare:
    executor: node/default
    parameters:
      environment:
        type: string
        default: "default"
      doppler_config:
        type: string
        default: "stg"
    steps:
      - checkout
      - restore_cache:
          keys:
            - v1-deps-{{ checksum "package.json" }}
            - v1-deps-
      - run:
          name: Install Packages
          command: |
            if [ -f package-lock.json ]; then
              npm ci
            else
              npm install
            fi
      - save_cache:
          paths:
            - node_modules
          key: v1-deps-{{ checksum "package.json" }}${setupWranglerStep}
      - run:
          name: Build
          command: npm run build${installRustStep}
      - run:
          name: Deploy to Cloudflare Workers
          command: |
            export PATH="$HOME/.cargo/bin:$PATH"
            ENV_VAL="<< parameters.environment >>"
            if [ -d worker ]; then cd worker; fi
            if [ "$ENV_VAL" = "default" ] || [ -z "$ENV_VAL" ]; then
              npx wrangler deploy
            else
              npx wrangler deploy --env "$ENV_VAL"
            fi${syncSecretsStep}`;

    // Branch gating: preview deploys are wasteful on every branch push and a
    // main-only preview is redundant with the production deploy on main, so
    // don't emit a preview job by default. Opt out with
    // circleci.branchGating = false to restore a per-branch preview.
    const previewJob = branchGating
      ? ""
      : `
      - deploy-to-cloudflare:${contextEnabled ? `\n          context: ${contextName}` : ""}
          name: deploy-to-cloudflare-preview
          environment: "preview"
          doppler_config: "stg"
          requires:${requiresList}
          filters:
            branches:
              ignore: main`;

    data.deployWorkflowJob =
      rustWorkflowJob +
      `
      - deploy-to-cloudflare:${contextEnabled ? `\n          context: ${contextName}` : ""}
          environment: "default"
          doppler_config: "stg"
          requires:${requiresList}
          filters:
            branches:
              only: main${previewJob}`;
  }
}

/**
 * Language-aware lint step for CircleCI.
 * - Python: `ruff check .` for MicroPython firmware (root + `lib/`), otherwise
 *   `ruff check src tests`; ruff ships in the `[dev]` extra.
 * - Rust: `rustup component add rustfmt clippy`, then `cargo fmt --check` +
 *   `cargo clippy --all-targets -- -D warnings`, contributed by
 *   `code-quality-rust`. rustfmt and clippy are *components*, not part of the
 *   toolchain the official images ship (see {@link RUST_LINT_SETUP_COMMAND});
 *   without the capability the project has no lint gate at all.
 * - Node: ESLint + SonarJS via `npm run lint` (existing behavior).
 */
function _applyCodeQualityConfig(data, context) {
  const language = resolveProjectLanguage(context);
  if (language === "python") {
    if (
      context.capabilities.includes("code-quality-python") ||
      context.capabilities.some((c) => c.startsWith("devcontainer-python"))
    ) {
      data.testSteps += `      - run:
          name: Lint (Ruff)
          command: ${ruffCheckCommand(context)}\n`;
    }
  } else if (language === "rust") {
    // Gated on the capability, not the devcontainer: rustfmt and clippy must be
    // added to the toolchain first, but an ungated `-D warnings` would fail
    // builds on code the project never opted into gating.
    if (context.capabilities.includes("code-quality-rust")) {
      // The setup command runs first: the image is rust's minimal profile, so
      // `cargo fmt`/`cargo clippy` are absent until the components are added.
      const lintCommands = RUST_LINT_STEP_COMMANDS.map(
        (command) => `            ${command}`,
      ).join("\n");
      data.testSteps += `      - run:
          name: Lint (cargo fmt + clippy)
          command: |
${lintCommands}\n`;
    }
  } else if (
    context.capabilities.includes("code-quality") ||
    context.capabilities.includes("devcontainer-node")
  ) {
    data.testSteps += `      - run:
          name: Lint (ESLint + SonarJS)
          command: npm run lint\n`;
  }
}

/**
 * Resolves the Doppler target (project + config) for a generated repo.
 *
 * Doppler scaling memo (memos/doppler-scaling): the Developer plan caps the
 * workplace at 10 projects, and the scaffolder used to burn one project per
 * generated repo via `createProject()`. The genproj fix defaults every repo
 * to the SHARED `common` project — no new project is created — unless the
 * doppler capability is configured with `projectStrategy: "new"` (dedicated
 * per-app project for repos with app-specific secrets).
 *
 * The config stays `dev` (matching doppler.yaml and the devcontainer context
 * pin); only the PROJECT is decided here.
 *
 * @param {Object} context - Generation context (capabilities, configuration, projectName)
 * @returns {{project: string, config: string, strategy: 'common'|'new'}} Resolved target
 */
export function resolveDopplerTarget(context) {
  const configuration = context?.configuration || {};
  const strategy =
    configuration.doppler?.projectStrategy === "new" ? "new" : "common";
  const projectName = context?.projectName || context?.name || "my-project";
  const config = context?.dopplerConfig || "dev";

  return {
    project: strategy === "new" ? projectName : "common",
    config,
    strategy,
  };
}

/**
 * Resolves the project's **Primary Language** — the single-valued,
 * project-level fact that governs the single-valued outputs: the CI image and
 * commands, `releaseArtifactPaths`, the sonar settings and the devcontainer
 * base.
 *
 * Precedence is **declared > derived**. A top-level `configuration.language`
 * (`python | node | java | rust`) always wins, even when no `devcontainer-*`
 * for it is selected — that combination is legal and intentional (e.g. a rust
 * base image with only python dev tooling). Only when nothing is declared does
 * the function fall back to the selected `devcontainer-*` capability, and then
 * to `node` for backward compatibility.
 *
 * This replaced two pickers with two different rules — `resolveLanguage`'s
 * fixed precedence and the devcontainer Dockerfile's
 * `developmentContainerCapabilities[0]` ("first selected") — which could
 * disagree and split the devcontainer base from CI in an order-dependent way.
 * Both now read this one function, so whatever it returns is *the* answer.
 *
 * `docker-container.language` is still read as a deprecated alias for one
 * release; prefer the project-level `language`.
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @returns {'python'|'node'|'java'|'rust'} The resolved primary language
 */
export function resolveProjectLanguage(context) {
  const explicit =
    context.configuration?.language ??
    context.configuration?.["docker-container"]?.language;
  if (typeof explicit === "string") {
    const normalized = explicit.toLowerCase().trim();
    if (["python", "node", "java", "rust"].includes(normalized)) {
      return normalized;
    }
  }
  const caps = context.capabilities || [];
  if (caps.some((c) => c.startsWith("devcontainer-python"))) return "python";
  if (caps.some((c) => c.startsWith("devcontainer-java"))) return "java";
  if (caps.some((c) => c.startsWith("devcontainer-rust"))) return "rust";
  return "node";
}

/**
 * Deprecated alias for {@link resolveProjectLanguage}. Kept exported so the
 * rename does not break callers; remove once nothing imports it.
 * @param {Object} context - Generation context
 * @returns {'python'|'node'|'java'|'rust'}
 */
export const resolveLanguage = resolveProjectLanguage;

/**
 * Resolves the directory the Svelte app is scaffolded into.
 *
 * The frontend does not always own the repository. When node is the primary
 * language the Svelte app *is* the project, so it lives at the root - the
 * behaviour before this option existed, preserved so existing projects do not
 * move. When the primary language is anything else, the Svelte app is a
 * sub-build of that project, and scaffolding it at the root would drop
 * `src/app.html` and `src/routes/+page.svelte` into the language's own source
 * tree (`src/` for Rust and Node alike) - so it gets its own directory, `web/`
 * by default.
 *
 * The catalog does not set a static `default` for `directory` on purpose: a
 * default of `web` would apply to node projects too and silently move them. The
 * rule is derived from the primary language, and an explicit value - `.` for the
 * root, or any name - always wins.
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @returns {string} The directory, without a trailing slash; "" for the root
 */
export function resolveSvelteDirectory(context) {
  // No frontend capability selected → no frontend directory. Returning "" here
  // (rather than "web" for every non-node language) keeps a language-only
  // project from growing a spurious `web/` seam.
  const frontendCapability = frontendCapabilityId(context);
  if (!frontendCapability) {
    return "";
  }
  const config = context?.configuration?.[frontendCapability] || {};
  const declared =
    typeof config.directory === "string" ? config.directory.trim() : "";
  if (declared) {
    const normalized = declared.replace(/\/+$/, "");
    return normalized === "." || normalized === "" ? "" : normalized;
  }
  return resolveProjectLanguage(context) === "node" ? "" : "web";
}

/**
 * Where the built static assets land, relative to {@link resolveSvelteDirectory}.
 * The non-node language's Docker build copies from here, so the two must agree.
 *
 * @param {Object} context - Generation context (configuration)
 * @returns {string} The output directory name, e.g. "build"
 */
export function resolveSvelteOutputDirectory(context) {
  const frontendCapability = frontendCapabilityId(context);
  if (!frontendCapability) {
    return "build";
  }
  const capability = getCatalogCapability(frontendCapability);
  const config = context?.configuration?.[frontendCapability] || {};
  // The default comes from the capability's own schema (SvelteKit → "build",
  // plain Vite → "dist"), so the two capabilities can differ deliberately
  // without this function hardcoding either.
  const withDefaults = applyDefaults(capability, config);
  const declared =
    typeof withDefaults.outputDirectory === "string"
      ? withDefaults.outputDirectory.trim()
      : "";
  return declared || "build";
}

/**
 * Languages genproj emits a serving harness for.
 *
 * A serving harness is the **harness** half of a non-node frontend project:
 * the binary binds the container port, serves the built static frontend, and
 * answers the declared healthcheck. The **domain** half (the wire protocol,
 * business endpoints) stays the developer's.
 *
 * Rust and Python are here because the generator already scaffolds their entry
 * point (`src/main.rs`, `src/<pkg>/__main__.py`) and both can serve HTTP from
 * the standard library alone, so the harness costs no dependency. Java is
 * deliberately absent: genproj emits a Java devcontainer and **no build
 * system** (no `pom.xml`), so there is no scaffold to compile a harness into -
 * adding one is a separate, larger change. A Java frontend project therefore
 * keeps the placeholder and gets no smoke gate (nothing can serve).
 */
export const SERVING_HARNESS_LANGUAGES = ["rust", "python"];

/**
 * The health path a docker-container `healthcheck` declares, or "" when it
 * declares none / a non-http mechanism. Shared by the Dockerfile emitter, the
 * serving harness and the smoke gate so all three agree on one path.
 * @param {Object} config - The `docker-container` capability configuration
 * @returns {string} The path (e.g. "/healthz"), or ""
 */
export function resolveDeclaredHealthPath(config) {
  const setting =
    typeof config?.healthcheck === "string" ? config.healthcheck.trim() : "";
  if (!setting.startsWith("http:")) return "";
  return setting.slice("http:".length) || "/healthz";
}

/**
 * Describes the minimal serving harness a non-node frontend project needs, or
 * null when none applies.
 *
 * The harness is emitted when the primary language is one genproj can scaffold
 * a server for (see {@link SERVING_HARNESS_LANGUAGES}) **and** a frontend is
 * present to serve. A non-node project with no frontend is unchanged: its
 * placeholder binary makes no healthcheck promise and gets no smoke gate.
 *
 * The container contract the harness must honour - the port the Dockerfile
 * `EXPOSE`s and the healthcheck it `HEALTHCHECK`s - is read from the same
 * `docker-container` configuration the Dockerfile is rendered from, so the two
 * cannot drift. Defaults match the Dockerfile's: port 3000 and `/healthz`
 * (the path a frontend project now declares when the user declares none).
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @returns {{language: string, port: number, staticDirectory: string, healthPath: string}|null}
 */
export function servingHarnessSpec(context) {
  const language = resolveProjectLanguage(context);
  if (!SERVING_HARNESS_LANGUAGES.includes(language)) return null;
  if (!hasFrontend(context)) return null;
  const config = context?.configuration?.["docker-container"] || {};
  // Python only scaffolds `src/<pkg>/__main__.py` when the app declares no
  // entry point of its own (round-3 fix: never clobber the app's real entry
  // point). Where the app owns it there is no harness, so there is no health
  // promise and no default healthcheck either. Rust always scaffolds a
  // `src/main.rs`, so this does not apply there.
  const ownsEntrypoint =
    (Array.isArray(config.command) && config.command.length > 0) ||
    (Array.isArray(config.entrypoint) && config.entrypoint.length > 0);
  if (language === "python" && ownsEntrypoint) return null;
  const directory = resolveSvelteDirectory(context);
  const outputDirectory = resolveSvelteOutputDirectory(context);
  return {
    language,
    port: config.exposePort ?? 3000,
    staticDirectory: directory
      ? `${directory}/${outputDirectory}`
      : outputDirectory,
    healthPath: resolveDeclaredHealthPath(config) || "/healthz",
  };
}

/**
 * Whether the project targets a MicroPython board.
 *
 * The `micropython` capability tells the generator that the deliverable is
 * firmware that runs on a board, not a host Python package. That changes where
 * the Python source lives (firmware resolves modules from the filesystem root
 * and `lib/`, never from `src/`) and which language the linter should target,
 * so lint tooling asks this rather than assuming a host package layout.
 *
 * @param {Object} context - Generation context (capabilities)
 * @returns {boolean} True when `micropython` is selected
 */
export function isMicropython(context) {
  return (context?.capabilities || []).includes("micropython");
}

/**
 * The ruff invocation that covers the Python source this project actually has.
 *
 * A MicroPython project's firmware lives at the repository root and in `lib/`,
 * so `ruff check src tests` lints an empty tree and reports a false green.
 * `ruff check .` follows the firmware wherever it is (root modules and `lib/`)
 * and, for a host package, still covers `src/` and `tests/`.
 *
 * @param {Object} context - Generation context
 * @returns {string} The shell command that runs ruff
 */
export function ruffCheckCommand(context) {
  return isMicropython(context) ? "ruff check ." : "ruff check src tests";
}

/**
 * The toolchain setup `code-quality-rust` needs before it can lint.
 *
 * `rustfmt` and `clippy` are rustup **components**, and the official `rust`
 * images are built with the rustup **minimal** profile — rustc and cargo only.
 * That is true both of the CI image (`rust:1-slim`, see the buildkite image
 * table) and of the devcontainer base image
 * (`mcr.microsoft.com/devcontainers/rust:1-bookworm`, which is itself
 * `FROM rust:1-bookworm`). So `cargo fmt` dies with
 * `'cargo-fmt' is not installed for the toolchain '<version>'` and clippy is
 * missing for the same reason — a clean generated project goes red on its first
 * build. A component add is idempotent, so it costs nothing when a host image
 * already carries them.
 *
 * @type {string}
 */
export const RUST_LINT_SETUP_COMMAND = "rustup component add rustfmt clippy";

/**
 * The lint commands `code-quality-rust` contributes to CI.
 *
 * `--all-targets` so tests and benches are linted too (a surprising amount of
 * real code lives there and would otherwise go unchecked), and `-D warnings`
 * so a warning is a failure: an unwarned clippy is a lint nobody reads. The
 * escape hatch is a `#[allow(...)]` at the call site, which is at least visible
 * in review.
 *
 * @type {string[]}
 */
export const RUST_LINT_COMMANDS = [
  "cargo fmt --check",
  "cargo clippy --all-targets -- -D warnings",
];

/**
 * The full lint step: install the components, then run the lints, in that
 * order. Every emitter of a rust lint step uses this — never
 * {@link RUST_LINT_COMMANDS} alone — so no call site (Buildkite, CircleCI, a
 * future provider) can be self-consistent yet broken against a real image by
 * forgetting the install. The regression test pins the emitted order, not the
 * constant, so a template edit that drops the setup fails.
 *
 * @type {string[]}
 */
export const RUST_LINT_STEP_COMMANDS = [
  RUST_LINT_SETUP_COMMAND,
  ...RUST_LINT_COMMANDS,
];

/**
 * The RP2 silicon variant a MicroPython project targets, resolved independently
 * of the board/product name.
 *
 * Product and chip are separate axes because a product can ship with more than
 * one RP2 variant: a Pimoroni Galactic Unicorn has been sold as both an RP2040
 * and a Pico 2 W / RP2350 carrier. The MicroPython `.uf2` is selected by chip,
 * so a chip silently asserted inside a product label is exactly how the wrong
 * firmware gets chosen with no warning. An explicit `micropython.chip` always
 * wins; otherwise the two Pico products resolve to their definitional chips
 * (Pico W is RP2040, Pico 2 W is RP2350); anything else is `unknown` rather
 * than guessed, which makes the README tell the reader to read the board's
 * runtime banner (`os.uname().machine`) instead of asserting a chip it cannot
 * know. The USB PID (`2e8a:0005`) is never consulted: it identifies the
 * MicroPython CDC firmware class, not the variant.
 *
 * @param {Object} context - Generation context
 * @returns {"rp2040"|"rp2350"|"unknown"} The resolved chip variant
 */
export function resolveMicropythonChip(context) {
  const configured = context?.configuration?.micropython?.chip;
  if (configured === "rp2040" || configured === "rp2350") return configured;
  const board = context?.configuration?.micropython?.board;
  if (board === "pico-w") return "rp2040";
  if (board === "pico-2-w") return "rp2350";
  return "unknown";
}

/**
 * The cargo package/binary name for a project name.
 *
 * A project name is a GitHub repository name, whose alphabet (letters, digits,
 * `.`, `-`, `_`) is not cargo's: a `.` is not a package-name character and cargo
 * rejects it, while `-` is legal in both the package and the binary cargo builds
 * from it. Three generated things have to agree on one spelling of the name -
 * the `Cargo.toml` package, the `target/<triple>/release/<name>` the build step
 * copies to `build/<target>/bin/`, and the `/app/target/release/<name>` the
 * Dockerfile copies onto PATH - so all three go through this function rather
 * than sanitising separately and drifting.
 *
 * A name that sanitises away entirely, or that starts with a digit (which cargo
 * also rejects), is prefixed rather than allowed through: an invalid manifest is
 * a build that fails on the first push, which is the failure this exists to
 * prevent.
 *
 * @param {string} name - The project/repository name
 * @returns {string} A name cargo accepts and the pipeline looks for
 */
export function cargoPackageName(name) {
  const sanitized = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (sanitized && !/^\d/.test(sanitized)) return sanitized;
  return sanitized ? `app-${sanitized}` : "app";
}

/**
 * The devcontainer capability that provides the primary language's toolchain —
 * `devcontainer-${primaryLanguage}`. The devcontainer **base** (Dockerfile and
 * JSON: remoteUser, features, remoteEnv PATH) follows this rather than the
 * first-selected `devcontainer-*`, so the base and CI cannot disagree. The
 * *other* selected devcontainers are still merged in as toolboxes.
 *
 * @param {Object} context - Generation context
 * @returns {string} A devcontainer capability id, e.g. "devcontainer-python"
 */
export function primaryDevcontainerCapabilityId(context) {
  return `devcontainer-${resolveProjectLanguage(context)}`;
}

/**
 * Converts a project/repo name into a valid Python import package name.
 * e.g. "nas-port-mcp" -> "nas_port_mcp"
 * @param {string} projectName
 * @returns {string}
 */
export function toPythonPackageName(projectName) {
  let pkg = (projectName || "my-project")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .replace(/[-.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(pkg)) pkg = `pkg_${pkg}`;
  return pkg || "app";
}

/**
 * Converts a project name into a valid PEP 508 distribution name.
 * @param {string} projectName
 * @returns {string}
 */
export function toDistributionName(projectName) {
  return (
    (projectName || "my-project")
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "my-project"
  );
}

// GHCR is the only supported registry (matches the GitHub + CircleCI stack, and
// public packages need no NAS-side credentials).
const DOCKER_REGISTRY_PREFIX = "ghcr.io";
const DOCKER_CREDENTIAL_VARS = { user: "GHCR_USERNAME", token: "GHCR_TOKEN" };

function getDockerRegistryPrefix() {
  return DOCKER_REGISTRY_PREFIX;
}

/**
 * Derives the host port from a compose publishPort binding.
 *
 * Format: `[hostIp:]hostPort:containerPort[/proto]` — e.g. `"3000:3000"`,
 * `"127.0.0.1:3002:3000"`, `"0.0.0.0:8080:80/tcp"`. The host port is the
 * left-hand side of the mapping: the port actually bound on the host, which
 * is what browser-facing URLs (Homepage href/widget) must use. When the
 * container port is also the host port this is invisible; when they differ
 * (loopback-bound services, ports allocated by nas-port-mcp) using the
 * container port produces a URL nothing listens on.
 *
 * Falls back to `exposePort` when publishPort is unset or unparseable, so
 * the default (`3000:3000` -> hostPort 3000) is unchanged. Indexing from the
 * end also tolerates bracketed IPv6 host IPs (`[::1]:3002:3000`).
 *
 * @param {string|undefined} publishPort - Compose port binding from config
 * @param {number|string} exposePort - Container port (fallback host port)
 * @returns {number|string} The published host port
 */
function getHostPort(publishPort, exposePort) {
  if (typeof publishPort !== "string" || !publishPort.includes(":"))
    return exposePort;
  const parts = publishPort.split(":");
  if (parts.length < 2) return exposePort;
  const hostPort = parts[parts.length - 2];
  return /^\d+$/.test(hostPort) ? hostPort : exposePort;
}

/**
 * The CI-provider-specific prose in the docker-container deploy runbook.
 *
 * `docker-container` is CI-agnostic — it can be selected with `circleci`, with
 * `buildkite`, or with neither — but the runbook is the one generated file that
 * has to *name* the provider that publishes the image. So the wording is chosen
 * here rather than hardcoded: a Buildkite-selected project reads as Buildkite
 * (its pipeline, the agent's `environment` hook, and Doppler for secrets),
 * never as CircleCI. When both CI capabilities are selected Buildkite wins, so
 * a buildkite-selected render never carries a stale CircleCI reference.
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @param {Object} vars - Values interpolated into the prose
 * @returns {{dockerPublishIntro: string, ciPublishJobName: string,
 *   registryCredentialSource: string, ciSetupSection: string}}
 */
function getDockerDeployCiDocs(context, vars) {
  const {
    projectName,
    registryPrefix,
    registryNamespace,
    buildPlatforms,
    circleciContext,
  } = vars;
  const imageRef = `${registryPrefix}/${registryNamespace}/${projectName}`;
  const caps = context.capabilities || [];
  const hasBuildkite = caps.includes("buildkite");
  const hasCircleci = caps.includes("circleci");
  const hasDoppler = caps.includes("doppler");
  const classicPatWarning = `> GitHub **fine-grained** PATs cannot access the Container registry (GHCR)
> yet, and offer no "Packages: read & write" permission — do not use one here.`;

  if (hasBuildkite) {
    // The pipeline's publish step resolves the credential from Doppler
    // (`common`/`prd`, GHCR_UPDATE_TOKEN) when doppler is selected, and from
    // the agent's `environment` hook otherwise. The wording mirrors the emitted
    // pipeline exactly (see getBuildkiteTemplateData), so the runbook and the
    // step cannot disagree about where the credential comes from.
    const credentialSource = hasDoppler
      ? `- Registry credentials are resolved at run time from Doppler
  (\`common\`/\`prd\`, secret \`GHCR_UPDATE_TOKEN\`) using the \`DOPPLER_TOKEN\` the
  agent's \`environment\` hook provides:
  - \`GHCR_USERNAME\` — the GHCR namespace the image is published under
  - the resolved \`GHCR_UPDATE_TOKEN\` — a **classic** PAT with the
    \`write:packages\` scope, used to push to GHCR`
      : `- Registry credentials come from the agent's \`environment\` hook, where
  they are set by name:
  - \`GHCR_USERNAME\` — the GitHub account name
  - \`GHCR_TOKEN\` — a **classic** PAT with the \`write:packages\` scope, used
    to push to GHCR`;
    const setupSteps = hasDoppler
      ? `1. In the agent's \`environment\` hook, export \`DOPPLER_TOKEN\` so the
   \`docker_publish\` step can read \`GHCR_UPDATE_TOKEN\` from Doppler
   (\`common\`/\`prd\`) at run time.
2. Confirm \`plugins-path\` is set in \`buildkite-agent.cfg\` — every step here
   uses a plugin, and agent v4 has no usable default.`
      : `1. In the agent's \`environment\` hook, export:
   - \`GHCR_USERNAME\` = your GitHub username
   - \`GHCR_TOKEN\` = a **classic** personal access token with the
     \`write:packages\` scope — create one at
     https://github.com/settings/tokens/new?scopes=write:packages (the UI
     auto-selects the \`repo\` scope alongside it)
2. Confirm \`plugins-path\` is set in \`buildkite-agent.cfg\` — every step here
   uses a plugin, and agent v4 has no usable default.`;
    const secretNote = hasDoppler
      ? `The registry token never lands in the agent's \`environment\` hook, where
every job on the fleet could read it.`
      : `A step-level \`env:\` value does **not** reach the container unless the name
is listed in the docker plugin's \`environment:\`, which is why these live in the
agent hook.`;

    return {
      dockerPublishIntro: `The repository's Buildkite pipeline (\`.buildkite/pipeline.yml\`) contains a
\`docker_publish\` step that builds the image for \`${buildPlatforms}\` and
pushes it to \`${imageRef}\` on every push to \`main\` (tagged with the commit
SHA and \`latest\`).`,
      ciPublishJobName: "docker_publish",
      registryCredentialSource: credentialSource,
      ciSetupSection: `### One-time CI setup (agent \`environment\` hook)

Before the first push can publish an image, the agent must supply the registry
credentials:

${setupSteps}

${secretNote} See \`.buildkite/README.md\` for the full list of agent
prerequisites.

${classicPatWarning}`,
    };
  }

  if (hasCircleci) {
    return {
      dockerPublishIntro: `The repository's CircleCI config contains a \`docker-publish\` job that builds
the image for \`${buildPlatforms}\` and pushes it to \`${imageRef}\` on every
push to \`main\` (tagged with the commit SHA and \`latest\`).`,
      ciPublishJobName: "docker-publish",
      registryCredentialSource: `- Registry credentials are read from the CircleCI context (\`${circleciContext}\`):
  - \`GHCR_USERNAME\` — the GitHub account name
  - \`GHCR_TOKEN\` — a **classic** PAT with the \`write:packages\` scope, used to
    \`docker login\`/push to GHCR`,
      ciSetupSection: `### One-time CI setup (CircleCI context)

Before the first push can publish an image, the CircleCI context must exist
with the registry credentials:

1. CircleCI -> Organization Settings -> Contexts -> Create Context, and name
   it \`${circleciContext}\` (this is what the generated pipeline reads).
2. Add these environment variables to the context:
   - \`GHCR_USERNAME\` = your GitHub username
   - \`GHCR_TOKEN\` = a **classic** personal access token with the
     \`write:packages\` scope — create one at
     https://github.com/settings/tokens/new?scopes=write:packages (the UI
     auto-selects the \`repo\` scope alongside it)

${classicPatWarning}`,
    };
  }

  // Neither CI capability: no publish job is generated, so the runbook has to
  // be honest about that rather than naming a provider the project does not
  // use.
  return {
    dockerPublishIntro: `No CI capability is selected, so no publish job is generated. Build and
push the image yourself, then the rest of this runbook applies unchanged:

\`\`\`bash
docker buildx build --platform ${buildPlatforms} -t ${imageRef}:latest --push .
\`\`\``,
    ciPublishJobName: "publish",
    registryCredentialSource: `- Registry credentials are whatever your local Docker daemon is logged in to.`,
    ciSetupSection: `### One-time CI setup

No CI provider is selected, so there is no context or agent hook to configure.
Log the Docker daemon in to the registry once:

\`\`\`bash
docker login ${registryPrefix}
\`\`\``,
  };
}

/**
 * Builds template data for the docker-container deployment capability.
 * Provides language-aware Dockerfile fragments, compose fragments, and
 * registry metadata for generated deploy artifacts.
 *
 * Language resolution (memo §1): the selected `devcontainer-*` capability (or
 * an explicit `language` config option) drives the base image, install
 * commands, healthcheck, entry point and lint/test tooling.
 *
 * Health mechanism (memo §2.8): config option `healthcheck` on
 * docker-container (`none | http:<path> | command:<cmd>`). The Dockerfile
 * HEALTHCHECK, the Homepage widget and the health route are only emitted when
 * a mechanism is declared; a node primary defaults to `http:/health` (the
 * SvelteKit app is the node server, and it emits the route). Python containers
 * default to `none` because the framework is unknown — declare one to opt in.
 * A non-node primary owns `/healthz` in its own server; genproj emits the
 * static assets and the seam (see the generated frontend README), not a route.
 *
 * @param {Object} context - Generation context (capabilities, configuration, projectName)
 * @returns {Object} Data consumed by the docker-container templates
 */
function getDockerContainerTemplateData(context) {
  const config = context.configuration?.["docker-container"] || {};
  const language = resolveProjectLanguage(context);
  const isPython = language === "python";
  const isNode = language === "node";
  const networkMode = config.networkMode || "bridge";
  const exposePort = config.exposePort ?? 3000;
  const watchtower = config.watchtower !== false;
  const homepage = config.homepage !== false;
  // Build platforms for the CircleCI docker-publish job. Default to x86_64
  // (linux/amd64) only; arm64 is built additionally only when `armBuilds` is
  // explicitly enabled (most NAS deploy targets are x86_64).
  const armBuilds = config.armBuilds === true;
  const buildPlatforms = armBuilds ? "linux/amd64,linux/arm64" : "linux/amd64";
  const imageVisibility = config.imageVisibility || "public";
  const projectName = context.projectName || "my-project";
  const registryPrefix = getDockerRegistryPrefix();
  const registryNamespace =
    context.registryNamespace || config.registryNamespace || "OWNER";
  const hostname = config.hostname || "localhost";
  // CircleCI context that holds the registry credentials (deploy runbook
  // guidance). Defaults to `common`, matching the circleci capability.
  const circleciContext =
    context.configuration?.circleci?.context?.name || "common";
  // CI-provider-specific prose for the deploy runbook. Chosen from the selected
  // CI capability so a Buildkite project never reads as CircleCI-shaped.
  const deployCiDocs = getDockerDeployCiDocs(context, {
    projectName,
    registryPrefix,
    registryNamespace,
    buildPlatforms,
    circleciContext,
  });

  // glibc base by default: Alpine (musl) breaks native npm/python modules
  // (duckdb, better-sqlite3, sharp, ...) which ship glibc prebuilds.
  // Alpine only via explicit opt-in (safe for pure-JS apps).
  // Java/Rust get their own toolchain images (maven/temurin, rust) instead of
  // falling back to the node image (memo: genproj-docker-build-speedup).
  const isJava = language === "java";
  const isRust = language === "rust";
  // "Is there a frontend to build?" is answered by the `frontend` contribution
  // type, not by the `sveltekit` id: any capability providing
  // `{ type: "frontend" }` (svelte, sveltekit, and whatever comes next) is a
  // frontend. See `hasFrontend` / `frontendCapabilityId`.
  const hasFrontendSelected = hasFrontend(context);
  // The serving harness this project will get, if any (non-node + frontend).
  // It decides the default healthcheck below: with a harness the container
  // really serves /healthz, so - like a node project's /health - a frontend
  // project declares one by default instead of emitting no HEALTHCHECK at all.
  const harness = servingHarnessSpec(context);
  const dockerBaseImage =
    config.baseImage ||
    (isPython
      ? "python:3.12-slim"
      : isNode
        ? "node:22-slim"
        : isJava
          ? "maven:3.9-eclipse-temurin-21"
          : isRust
            ? "rust:1-slim"
            : "node:22-slim");

  // The container's HTTP server is the project's primary language. When that
  // language is node the built app *is* a Node server (SvelteKit adapter-node
  // emits a standalone `build/index.js`). When it is anything else the Svelte
  // UI is built to STATIC assets (adapter-static / plain Vite) that the
  // language's own server serves - the runtime image is the language image and
  // carries no node. The frontend is still built in its own `frontend` stage,
  // because the language image has no node to build it with.
  //
  // This reverses the earlier "Node serves the SvelteKit app regardless of the
  // primary language" assumption (roost): the design has Rust serve the hub
  // (§6.2), and a Node runtime in a Rust image was never the intended shape.
  const runtimeHasNode = isNode;
  const dockerRuntimeImage = dockerBaseImage;

  // Python package name (src-layout) and Rust binary name (package name)
  // used by the manifest-first build and the runtime stage below.
  const pkgName = toPythonPackageName(projectName);
  const rustBinName = cargoPackageName(projectName || "my-project");

  // ---- Svelte frontend sub-build (a frontend in a non-node project).
  // When node is the primary language the frontend IS the build and the node
  // branch below handles it. Otherwise the frontend is a separate build that
  // the language's own stage (which has no node) cannot perform, so it gets a
  // preceding node stage and the output is copied into the language stage - both
  // so a compile-time embed (rust-embed, include_dir!) can read it and so a
  // runtime that serves it from disk finds it. Where the output lands
  // ({{svelteDirectory}}/{{svelteOutputDirectory}}) is the documented seam: see
  // the generated web/README.md.
  const buildsSvelteFrontend = hasFrontendSelected && language !== "node";
  const svelteDirectory = buildsSvelteFrontend
    ? resolveSvelteDirectory(context)
    : "";
  const svelteOutputDirectory = resolveSvelteOutputDirectory(context);
  const sveltePrefix = svelteDirectory ? `${svelteDirectory}/` : "";
  const svelteFrontendCopy = buildsSvelteFrontend
    ? `COPY --from=frontend /app/${svelteOutputDirectory} ./${sveltePrefix}${svelteOutputDirectory}`
    : "";
  const svelteBuildCopyLine = svelteFrontendCopy
    ? `\n${svelteFrontendCopy}`
    : "";
  const dockerFrontendStage = buildsSvelteFrontend
    ? `# Frontend stage: builds the Svelte app before the ${language} build below.
# The ${language} image has no node, so this is a separate stage rather than a
# step in the main one. Output lands in ${sveltePrefix}${svelteOutputDirectory}/
# (see ${sveltePrefix}README.md).
FROM node:22-bookworm AS frontend
WORKDIR /app
COPY ${sveltePrefix}package.json ${sveltePrefix}package-lock.json* ${sveltePrefix}.npmrc* ./
RUN PINNED_NPM="$(node -p "try{require('./package.json').packageManager}catch(e){''}" 2>/dev/null || true)" \\
    && if [ -n "$PINNED_NPM" ] && [ "$(npm --version)" != "\${PINNED_NPM#npm@}" ]; then \\
         echo "Activating pinned \${PINNED_NPM}..."; \\
         npm install -g "\${PINNED_NPM}" >/dev/null || true; \\
       fi \\
    && if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY ${sveltePrefix}. .
RUN npm run build
`
    : "";

  // ---- Health mechanism (config-driven; see jsdoc above).
  let healthcheckSetting =
    typeof config.healthcheck === "string" ? config.healthcheck.trim() : "";
  let healthcheckPath = "";
  if (healthcheckSetting === "none") healthcheckSetting = "";
  if (healthcheckSetting.startsWith("http:")) {
    healthcheckPath = healthcheckSetting.slice("http:".length) || "/health";
  }
  // A node web app defaults to a /health route: the SvelteKit app is the node
  // server and the generator emits src/routes/health/+server.js for it.
  //
  // A NON-node frontend project now defaults to /healthz too, because the
  // serving harness genproj scaffolds answers it (see servingHarnessSpec). That
  // is what lets the smoke gate apply by default: the promise and the server
  // are emitted together. A non-node project WITHOUT a frontend still declares
  // nothing - its placeholder binary makes no promise.
  if (!healthcheckSetting && isNode) {
    healthcheckSetting = "http:/health";
    healthcheckPath = "/health";
  } else if (!healthcheckSetting && harness) {
    healthcheckSetting = `http:${harness.healthPath}`;
    healthcheckPath = harness.healthPath;
  }

  // ---- apt packages (memo §3.2): aptPackages config emitted into the
  // runtime stage. curl is auto-added for http healthchecks on non-Node
  // images (python/java/rust) because they do not ship curl — Node uses
  // `node -e fetch` and needs nothing.
  const aptPackages = Array.isArray(config.aptPackages)
    ? [...config.aptPackages]
    : [];
  if (
    healthcheckSetting.startsWith("http:") &&
    !runtimeHasNode &&
    !aptPackages.includes("curl")
  ) {
    aptPackages.push("curl");
  }
  const dockerAptInstall =
    aptPackages.length > 0
      ? `RUN apt-get update && apt-get install -y --no-install-recommends ${aptPackages.join(" ")} \\\n    && rm -rf /var/lib/apt/lists/*`
      : "";

  // Stage 1 (build) — manifest-first layer ordering (memo:
  // genproj-docker-build-speedup, proven in mailroom 4f8d9a4): copy the
  // dependency manifests, install dependencies, THEN copy the source and
  // build. The expensive dependency layer only rebuilds when the manifest
  // changes, so every source-only commit reuses it (via docker_layer_caching
  // and the buildx registry cache in the docker-publish job).
  //
  // Python: deps install before `COPY . .` via a minimal placeholder package
  // (`pip install .` resolves pyproject deps with no source present; the
  // real package is reinstalled `--no-deps` after the copy). README.md must
  // be copied too — pyproject's `readme = "README.md"` fails the metadata
  // build without it. A requirements.txt is pre-installed with local
  // references (`-e .[dev]`) filtered out, then fully installed after the
  // copy (nas-port-mcp bug 2: editable self-installs need the real source).
  let dockerBuildCommands;
  if (isPython) {
    dockerBuildCommands = `COPY README.md pyproject.toml* requirements.txt* ./
RUN python -m venv /opt/venv \\\n    && /opt/venv/bin/pip install --upgrade pip \\\n    && mkdir -p src/${pkgName} && touch src/${pkgName}/__init__.py \\\n    && if [ -f requirements.txt ]; then \\\n         grep -vE '^\\s*(-e|--editable)\\s+\\.' requirements.txt > /tmp/reqs.txt || true; \\\n         [ -s /tmp/reqs.txt ] && /opt/venv/bin/pip install --no-cache-dir -r /tmp/reqs.txt; \\\n       fi \\\n    && if [ -f pyproject.toml ]; then \\\n         /opt/venv/bin/pip install --no-cache-dir .; \\\n       fi
COPY . .
RUN if [ -f requirements.txt ]; then \\\n      /opt/venv/bin/pip install --no-cache-dir -r requirements.txt; \\\n    elif [ -f pyproject.toml ]; then \\\n      /opt/venv/bin/pip install --no-cache-dir --no-deps .; \\\n    fi${svelteBuildCopyLine}`;
  } else if (isNode) {
    // genproj-npm-pin: activate the npm pinned in package.json before
    // installing. npm 10 bundled with node:22 crashes fresh-installing
    // vitest-4 projects ('edgesOut'), and engine-strict .npmrc would reject
    // npm ci/install outright; corepack can't switch npm, so install the
    // pinned version globally in the build stage.
    dockerBuildCommands = `COPY package.json package-lock.json* .npmrc* ./
RUN PINNED_NPM="$(node -p "try{require('./package.json').packageManager}catch(e){''}" 2>/dev/null || true)" \\
    && if [ -n "$PINNED_NPM" ] && [ "$(npm --version)" != "\${PINNED_NPM#npm@}" ]; then \\
         echo "Activating pinned \${PINNED_NPM}..."; \\
         npm install -g "\${PINNED_NPM}" >/dev/null || true; \\
       fi \\
    && if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build`;
  } else if (isJava) {
    dockerBuildCommands = `COPY pom.xml ./
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B package${svelteBuildCopyLine}`;
  } else {
    // Rust: `cargo fetch` downloads crate sources from the lockfile before
    // the source copy, so the fetch layer is cached unless Cargo.toml or
    // Cargo.lock changes.
    //
    // `cargo fetch` parses Cargo.toml to resolve the dependency graph, and
    // Cargo rejects a manifest with no targets ("no targets specified in the
    // manifest: either src/lib.rs, src/main.rs, a [lib] section, or [[bin]]
    // section must be present"). At the fetch layer only the manifests exist,
    // so we stub a target first. The stub must be removed before the real
    // source copy: `COPY` merges directories rather than replacing them, so a
    // leftover src/main.rs would become an extra target the user never wrote
    // (and a duplicate `main` symbol against the real one).
    dockerBuildCommands = `COPY Cargo.toml Cargo.lock* ./
RUN mkdir -p src && echo 'fn main() {}' > src/main.rs \\
    && cargo fetch \\
    && rm -rf src
COPY src ./src${svelteBuildCopyLine}
RUN cargo build --release`;
  }

  // Stage 2 (runtime): only the build output + production deps. Node keeps
  // `package*.json` (package.json always present + lockfile when one exists)
  // with the strict `npm ci --omit=dev` vs fallback. Java runs the packaged
  // jar (single-jar assumption, e.g. a Spring Boot fat jar); Rust runs the
  // release binary from PATH.
  let dockerRuntimeCommands;
  if (isPython) {
    dockerRuntimeCommands = `ENV PATH="/opt/venv/bin:$PATH"\nCOPY --from=build /opt/venv /opt/venv\nCOPY . .`;
  } else if (isNode) {
    // Runtime stage copies only the build output — no `npm ci --omit=dev`.
    // genproj's Node target is SvelteKit, and `adapter-node`'s build output
    // is self-contained (app deps are bundled; only `node:*` builtins
    // remain), so `build/` alone is enough to run `node build/index.js`.
    // A runtime `npm ci --omit=dev` is not just redundant — it actively
    // breaks the build: `npm ci`/`npm install` always run lifecycle scripts
    // (incl. `prepare`) regardless of `--omit=dev`, and genproj emits a
    // `prepare` script (`simple-git-hooks`) that shells out to a
    // devDependency, which is omitted in the runtime stage -> "command not
    // found" (exit 127). ENV NODE_ENV=production keeps npm/Node in
    // production mode for the runtime (memo: genproj Node Dockerfile).
    dockerRuntimeCommands = `ENV NODE_ENV=production\nCOPY --from=build /app/build ./build`;
  } else if (isJava) {
    dockerRuntimeCommands = `COPY --from=build /app/target/*.jar /app/app.jar`;
  } else {
    dockerRuntimeCommands = `COPY --from=build /app/target/release/${rustBinName} /usr/local/bin/${rustBinName}`;
  }
  // A non-node project keeps node out of the runtime image entirely: the
  // frontend was built to static assets in the `frontend` stage, and the
  // language's own server serves them. The built assets are a runtime asset
  // whether the binary embeds them at compile time (the build stage already has
  // them) or serves them from disk; the copy is harmless in the former case and
  // load-bearing in the latter.
  if (svelteFrontendCopy) {
    dockerRuntimeCommands += `\n${svelteFrontendCopy}`;
  }

  // ---- HEALTHCHECK: emitted only when a mechanism is declared (memo §2.8).
  // Node images have node built in (`node -e fetch`); every other language
  // uses curl (auto-added to aptPackages above).
  let dockerHealthcheck = "";
  if (healthcheckSetting.startsWith("http:")) {
    dockerHealthcheck = runtimeHasNode
      ? `HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:${exposePort}${healthcheckPath}').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"`
      : `HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD curl -fsS http://127.0.0.1:${exposePort}${healthcheckPath} || exit 1`;
  } else if (healthcheckSetting.startsWith("command:")) {
    dockerHealthcheck = `HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ${healthcheckSetting
      .slice("command:".length)
      .trim()}`;
  }

  // ---- Entry point (memo §3.1): config-driven ENTRYPOINT/CMD, never a
  // placeholder comment. `command` overrides the default CMD; `entrypoint`
  // prepends an ENTRYPOINT. The Python default runs the scaffolded package
  // module (`python -m <pkg>`), installed into the venv by the build stage.
  //
  // Script contract: when command/entrypoint references a script at
  // /usr/local/bin/<name>, the repo copy is expected at scripts/<name> and is
  // copied into the runtime image (chmod +x). Regression: the ENTRYPOINT used
  // to reference a file that never existed in the image, so containers with a
  // custom entrypoint failed to start ("exec: ... no such file").
  let dockerEntrypoint = "";
  let dockerCommand = "";
  let dockerScriptCopy = "";
  for (const argv of [config.entrypoint, config.command]) {
    const script = Array.isArray(argv) ? argv[0] : "";
    const match =
      typeof script === "string"
        ? script.match(/^\/usr\/local\/bin\/([^/]+)$/)
        : null;
    if (match) {
      dockerScriptCopy = `COPY scripts/${match[1]} /usr/local/bin/${match[1]}\nRUN chmod +x /usr/local/bin/${match[1]}`;
      break;
    }
  }
  if (Array.isArray(config.entrypoint) && config.entrypoint.length > 0) {
    dockerEntrypoint = `ENTRYPOINT ${JSON.stringify(config.entrypoint)}`;
  }
  if (Array.isArray(config.command) && config.command.length > 0) {
    dockerCommand = `CMD ${JSON.stringify(config.command)}`;
  } else if (!dockerEntrypoint) {
    if (isPython) dockerCommand = `CMD ["python", "-m", "${pkgName}"]`;
    else if (isNode) dockerCommand = 'CMD ["node", "build/index.js"]';
    else if (isJava) dockerCommand = 'CMD ["java", "-jar", "/app/app.jar"]';
    // Non-node: the language's own binary is the entry point (and the server,
    // for a project that adds one). The frontend is static assets it serves.
    else dockerCommand = `CMD ["${rustBinName}"]`;
  }
  const dockerRunCommand = [dockerScriptCopy, dockerEntrypoint, dockerCommand]
    .filter(Boolean)
    .join("\n");

  const networkModeLine =
    networkMode === "host" ? "    network_mode: host" : "";

  // 3.4: publishPort controls the compose port binding. Default is
  // "<exposePort>:<exposePort>" (all interfaces). Bind to 127.0.0.1 (or a
  // specific interface) to keep the service private (e.g. Tailscale-only).
  // hostPort is the left-hand side of the binding — the port actually bound
  // on the host — and is what browser-facing URLs (Homepage href/widget)
  // must use: when publishPort maps a different host port than the container
  // port (e.g. "127.0.0.1:3002:3000"), the container port is wrong for URLs
  // (memo: genproj-homepage-port-wart).
  const publishPort = config.publishPort || `${exposePort}:${exposePort}`;
  const hostPort = getHostPort(publishPort, exposePort);
  const portsConfig =
    networkMode === "host" ? "" : `    ports:\n      - "${publishPort}"`;

  // 3.3: dataMounts config -> compose volumes (read-only by default).
  const dataMounts = Array.isArray(config.dataMounts) ? config.dataMounts : [];
  const volumesConfig =
    dataMounts.length > 0
      ? "    volumes:\n" +
        dataMounts
          .map(
            (mount) =>
              `      - ${mount.hostPath}:${mount.containerPath}${mount.readOnly === false ? "" : ":ro"}`,
          )
          .join("\n")
      : "";

  // ---- envVars (memo §3.3 / round-2 fix 1): emitted into compose
  // `environment:` as VALID YAML map entries with `${KEY:-default}`
  // interpolation (preserves the .env override) — never a bare `KEY=value`
  // line under the mapping, which parses as an invalid mapping key and breaks
  // `docker compose config`. .env.example keeps the plain derived keys.
  const envVars = Array.isArray(config.envVars) ? config.envVars : [];
  const composeEnvVars = envVars
    .map((entry) => {
      const eq = entry.indexOf("=");
      const key = eq === -1 ? entry : entry.slice(0, eq);
      const def = eq === -1 ? "" : entry.slice(eq + 1);
      // Map form: `KEY: ${KEY:-default}` (or `${KEY}` for a bare key).
      return def
        ? `      ${key}: ${"$"}{${key}:-${def}}`
        : `      ${key}: ${"$"}{${key}}`;
    })
    .join("\n");
  const envExampleEntries = envVars
    .map((entry) => (entry.includes("=") ? entry : `${entry}=`))
    .join("\n");

  // The whole compose `environment:` block, not just its entries. A mapping
  // header with only comment lines under it is YAML null, and Compose v2
  // rejects it: `services.app.environment must be a mapping` (roost defect 2).
  // With no env vars we emit an explicit empty mapping (`environment: {}`),
  // which is both valid and says "nothing here" on purpose.
  const composeEnvironment =
    envVars.length > 0
      ? `    environment:
      # Set your environment variables here or in a NAS-side .env file
      # (genproj never commits secrets). See .env.example.
${composeEnvVars}`
      : "    environment: {}";

  const labels = [];
  if (watchtower || homepage) labels.push("    labels:");
  if (watchtower)
    labels.push('      - "com.centurylinklabs.watchtower.enable=true"');
  if (homepage) {
    labels.push(
      '      - "homepage.group=Services"',
      `      - "homepage.name=${projectName}"`,
      `      - "homepage.href=http://${hostname}:${hostPort}/"`,
    );
    // Widget only when a real health endpoint exists (memo §2.8).
    if (healthcheckPath) {
      // The customapi widget renders nothing without `mappings` (its default is
      // an empty list), so emit the health payload's own `status` field - the
      // generated health endpoints answer `{"status":"ok"}`.
      labels.push(
        '      - "homepage.widget.type=customapi"',
        `      - "homepage.widget.url=http://localhost:${hostPort}${healthcheckPath}"`,
        '      - "homepage.widget.mappings[0].field=status"',
        '      - "homepage.widget.mappings[0].label=Status"',
      );
    }
  }

  // Homepage's Docker provider queries the daemon, so the widget URL
  // legitimately uses localhost (even for a loopback-bound service) — but it
  // must still point at the published HOST port, never the container port
  // (memo: genproj-homepage-port-wart).
  const homepageWidget = healthcheckPath
    ? `    widget:\n      type: customapi\n      url: http://localhost:${hostPort}${healthcheckPath}\n      mappings:\n        - field: status\n          label: Status`
    : "";

  return {
    registryPrefix,
    registryNamespace,
    circleciContext,
    ...deployCiDocs,
    dockerBaseImage,
    dockerRuntimeImage,
    dockerAptInstall,
    dockerFrontendStage,
    dockerBuildCommands,
    dockerRuntimeCommands,
    dockerHealthcheck,
    dockerRunCommand,
    exposePort: String(exposePort),
    hostPort: String(hostPort),
    networkMode,
    networkModeLine,
    portsConfig,
    volumesConfig,
    composeEnvVars,
    composeEnvironment,
    envExampleEntries,
    composeLabels: labels.join("\n"),
    homepageWidget,
    hostname,
    watchtower: String(watchtower),
    homepage: String(homepage),
    imageVisibility,
    armBuilds,
    buildPlatforms,
  };
}

/**
 * Adds a docker-publish job to the CircleCI config data when the
 * docker-container deployment capability is selected.
 * @param {Object} data - CircleCI template data (mutated)
 * @param {Object} context - Generation context
 * @param {boolean} contextEnabled - Whether the CircleCI context is enabled
 * @param {string} contextName - CircleCI context name
 */
function _applyDockerContainerConfig(
  data,
  context,
  contextEnabled,
  contextName,
) {
  if (!context.capabilities.includes("docker-container")) {
    return;
  }

  const registryPrefix = getDockerRegistryPrefix();
  const projectName = context.projectName || "my-project";
  const config = context.configuration?.["docker-container"] || {};
  const registryNamespace =
    context.registryNamespace || config.registryNamespace || "OWNER";
  const imageRef = `${registryPrefix}/${registryNamespace}/${projectName}`;
  // Registry-backed BuildKit cache (memo: genproj-docker-build-speedup,
  // proven in mailroom 4f8d9a4). Every buildx push pulls the previous layer
  // cache from the dedicated `:buildcache` tag and pushes it back with
  // mode=max, so only changed layers rebuild. The first run after enabling
  // is still cold (it seeds the tag); the speedup shows from run #2.
  const cacheRef = `${imageRef}:buildcache`;
  const credentialVars = DOCKER_CREDENTIAL_VARS;
  // Default to x86_64 (linux/amd64) only; build arm64 too when armBuilds is
  // enabled (most NAS deploy targets are x86_64).
  const armBuilds = config.armBuilds === true;
  const buildPlatforms = armBuilds ? "linux/amd64,linux/arm64" : "linux/amd64";
  // GHCR package visibility is configured in the generated workflow below.
  // (The old `imageVisibility` local was never read.)

  data.deployJobDefinition =
    `
  docker-publish:
    docker:
      - image: cimg/base:stable
    environment:
      # BuildKit layer cache ref (ghcr.io registry cache, mode=max). Cache-only
      # tag — never used as a deployable image.
      CACHE_REF: ${cacheRef}
      # Image ref (ghcr.io namespace/name). The generated Dockerfile carries
      # ` +
    "`org.opencontainers.image.source`" +
    ` so GHCR links the package to
      # this repo on first push — a public repo yields a public package (no
      # credentials needed for NAS/Watchtower pulls).
      IMAGE: ${imageRef}
    steps:
      - checkout
      - setup_remote_docker:
          docker_layer_caching: true
      - run:
          name: Login to Container Registry
          command: |
            echo "$${credentialVars.token}" | docker login ${registryPrefix} -u "$${credentialVars.user}" --password-stdin
      - run:
          name: Build and Push Image
          command: |
            BUILDX_BUILDER_NAME="ci-$$CIRCLE_WORKFLOW_JOB_ID"
            trap 'docker buildx rm "$$BUILDX_BUILDER_NAME" >/dev/null 2>&1 || true' EXIT
            docker buildx create --bootstrap --name "$$BUILDX_BUILDER_NAME" >/dev/null
            docker buildx build --builder "$$BUILDX_BUILDER_NAME" --platform ${buildPlatforms} \\
              --cache-from type=registry,ref=$CACHE_REF \\
              --cache-to type=registry,ref=$CACHE_REF,mode=max \\
              -t $IMAGE:$CIRCLE_SHA1 -t $IMAGE:latest --push .
`;

  data.deployWorkflowJob = `
      - docker-publish:${contextEnabled ? `\n          context: ${contextName}` : ""}
          requires:
            - build
          filters:
            branches:
              only: main`;
}

function getCircleCiTemplateData(context) {
  const data = {
    preBuildSteps: "",
    testSteps: "",
    lighthouseJobDefinition: "",
    lighthouseWorkflowJob: "",
    deployJobDefinition: "",
    deployWorkflowJob: "",
    orbs: "",
    commands: "",
    additionalWorkflowJobs: "",
    buildWorkflowJob: "      - build",
    jobEnvironment: "",
    // Language-aware build job fragments (memo §2.1). Python gets a
    // cimg/python executor + venv/pip install/ruff/pytest; Node keeps the
    // node orb + npm ci/build/test. docker-publish is unchanged (multi-arch
    // buildx -> GHCR) and shared by both languages.
    ciOrbs: "  node: circleci/node@5.0.2\n",
    buildExecutor: "    executor: node/default",
    ciCacheRestore:
      '          keys:\n            - v1-deps-{{ checksum "package.json" }}\n            - v1-deps-',
    ciCacheSave:
      '          paths:\n            - node_modules\n          key: v1-deps-{{ checksum "package.json" }}',
    ciInstallCommand:
      "            if [ -f package-lock.json ]; then\n              npm ci\n            else\n              npm install\n            fi",
    ciBuildStep:
      "      - run:\n          name: Build\n          command: npm run build",
    ciNpmActivateStep: "",
    ciDriftCheckStep: "",
  };

  const contextConfig = context.configuration?.circleci?.context;
  // Default enabled is true, default name is 'common'
  const contextEnabled = contextConfig?.enabled ?? true;
  const contextName = contextConfig?.name || "common";

  // Branch gating is ON by default: Lighthouse and preview deploys run on
  // main only. Opt out with circleci.branchGating = false.
  const branchGating = context.configuration?.circleci?.branchGating !== false;

  const buildJobContext = contextEnabled
    ? `\n          context: ${contextName}`
    : "";

  const language = resolveProjectLanguage(context);
  if (language === "python") {
    data.ciOrbs = "";
    data.buildExecutor = "    docker:\n      - image: cimg/python:3.12\n";
    data.ciCacheRestore =
      '          keys:\n            - v1-venv-{{ checksum "pyproject.toml" }}\n            - v1-venv-';
    data.ciCacheSave =
      '          paths:\n            - .venv\n          key: v1-venv-{{ checksum "pyproject.toml" }}';
    data.ciInstallCommand =
      '            python3 -m venv .venv\n            echo \'. .venv/bin/activate\' >> "$BASH_ENV"\n            pip install --upgrade pip\n            pip install -e ".[dev]"';
    data.ciBuildStep = "";
  } else {
    // Node CI: activate the npm pinned in package.json before installing and
    // guard against package.json/package-lock.json drift. Mirrors the FTN
    // webapp CI; prevents npm 10's arborist 'edgesOut' crash on fresh
    // vitest-4 installs and the recurring 'npm ci' drift breakage.
    data.ciNpmActivateStep = `      - run:
          name: Activate pinned npm
          command: |
            PINNED_NPM="$(node -p "try{require('./package.json').packageManager}catch(e){''}" 2>/dev/null || true)"
            if [ -n "$PINNED_NPM" ]; then
              VERSION="\${PINNED_NPM#npm@}"
              CURRENT="$(npm --version 2>/dev/null || echo '')"
              if [ "$VERSION" != "$CURRENT" ]; then
                echo "Activating pinned \${PINNED_NPM} (image npm: \${CURRENT:-unknown})..."
                (npm install -g "npm@\${VERSION}" 2>/dev/null || sudo npm install -g "npm@\${VERSION}")
              fi
            fi
            node -v && npm --version
`;
    data.ciDriftCheckStep = `      - run:
          name: Lockfile drift check
          command: |
            if [ -f package-lock.json ]; then
              cp package-lock.json /tmp/lock.orig
              npm install --package-lock-only --ignore-scripts
              if ! cmp -s package-lock.json /tmp/lock.orig; then
                cp /tmp/lock.orig package-lock.json
                echo "ERROR: package-lock.json is out of sync with package.json."
                echo "Run 'npm install --package-lock-only' and commit the result."
                exit 1
              fi
              echo "OK: package-lock.json is in sync with package.json."
            fi
`;
  }

  _applyGitGuardianConfig(
    data,
    context,
    contextEnabled,
    contextName,
    buildJobContext,
  );
  _applyDopplerConfig(data, context);
  _applyLighthouseConfig(
    data,
    context,
    contextEnabled,
    contextName,
    branchGating,
  );
  _applyCloudflareConfig(
    data,
    context,
    contextEnabled,
    contextName,
    branchGating,
  );
  _applyDockerContainerConfig(data, context, contextEnabled, contextName);

  // Lint step first (ruff/ESLint), then the test step.
  _applyCodeQualityConfig(data, context);

  if (language === "python") {
    // A MicroPython project is firmware, not a host package: there is no host
    // test suite to collect, and `pytest -v` over an empty tree exits 5
    // ("no tests ran"), failing a build that has nothing wrong with it. The
    // Buildkite pipeline drops the same step for the same reason.
    if (
      context.capabilities.some((c) => c.startsWith("devcontainer-python")) &&
      !isMicropython(context)
    ) {
      data.testSteps += `      - run:
          name: Test (pytest)
          command: pytest -v\n`;
    }
  } else if (
    context.capabilities.includes("devcontainer-node") &&
    context.capabilities.includes("circleci")
  ) {
    data.testSteps += `      - run:
          name: Test with Coverage
          command: npx vitest --coverage\n`;
  }

  if (data.commands) {
    data.commands = `commands:\n${data.commands}`;
  }

  return data;
}

/**
 * Builds the Dependabot `groups:` block for an ecosystem.
 *
 * Grouping is a compute lever, not a cosmetic one. Without it Dependabot opens
 * one PR per dependency, and on a self-hosted pipeline every PR is a full build
 * (ftn measured ~290s of agent time each). Grouping minor/patch updates took
 * ftn from a daily limit of ten PRs down to about two — see
 * `.buildkite/README.md` for the measurements and the trade-off.
 *
 * `update-types` is deliberately minor+patch only: a major bump is the one you
 * want to read on its own, and a grouped PR is harder to attribute when it goes
 * red. `dependency-type` is npm-only — the one ecosystem where Dependabot
 * distinguishes development from production dependencies.
 *
 * @param {boolean} isNpm - Split into development/production groups.
 * @returns {string} YAML block, indented for an `updates:` list entry.
 */
function _dependabotGroups(isNpm) {
  const minorAndPatch = `        update-types:
          - "minor"
          - "patch"`;
  if (isNpm) {
    return `
    groups:
      dev-minor-and-patch:
        patterns:
          - "*"
        dependency-type: "development"
${minorAndPatch}
      prod-minor-and-patch:
        patterns:
          - "*"
        dependency-type: "production"
${minorAndPatch}`;
  }
  return `
    groups:
      minor-and-patch:
        patterns:
          - "*"
${minorAndPatch}`;
}

/**
 * Doppler CLI install, shared by every step that resolves secrets from Doppler.
 *
 * `cli.doppler.com/install.sh` verifies its own download with `gpgv` and exits 3
 * when it cannot find the binary ("Unable to find gpg binary for signature
 * verification"), which is what the release step hit. That check is about the
 * script's own signature verification, not about apt: Debian 13's apt verifies
 * repositories itself and no longer needs `gpgv` to do it, so the images the
 * containerised steps run in - rust:1-slim among them - are free to ship
 * without it. `gpgv` is not pulled in by `gnupg` either (it is a Recommends,
 * and these installs pass --no-install-recommends), so it is named here: the
 * install script is the only thing on the image that wants it.
 *
 * @param {string} indent - Leading indentation for the command lines
 * @returns {string} YAML command block
 */
function dopplerCliInstallCommands(indent) {
  return `${indent}if ! command -v doppler >/dev/null 2>&1; then
${indent}  apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gpgv
${indent}  curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh
${indent}fi
`;
}

/**
 * Fetch the build step's uploaded artifacts, over the Buildkite agent API.
 *
 * NOT `buildkite-agent artifact download`, which is the obvious call and the one
 * the mounted agent is for. The fleet runs macOS (`/opt/homebrew` paths in the
 * agent's own log), so the binary the docker plugin mounts at
 * `/usr/bin/buildkite-agent` is a Mach-O executable: every call into it from the
 * step's linux container dies with "Cannot run macOS (Mach-O) executable in
 * Docker: Exec format error". The plugin's own README says as much - "don't try
 * to mount the OS X agent binary in a container running linux" - and mounts it
 * anyway unless `BUILDKITE_AGENT_BINARY_PATH` names a linux build of the same
 * agent. The downloads therefore failed, and the release they feed was published
 * with no assets: silently, because a missing artifact is a normal case here.
 *
 * So the agent's own API is called directly. Not the public REST API: a job
 * holds a *job token*, minted per job and dead when the job ends, which the
 * public REST API rejects (401). `https://agent-edge.buildkite.com/v3` is the
 * endpoint the `buildkite-agent artifact` commands use with exactly this token,
 * and artifact search is one of the operations job tokens are documented to
 * perform. The download itself needs no credential at all: the search result
 * carries a URL to the uploaded bytes.
 *
 * The docker plugin forwards the token by name, like every other env var these
 * steps need.
 *
 * @param {string[]} patterns - Artifact path globs, e.g. "dist/**"
 * @param {string} indent - Leading indentation for the command lines
 * @returns {string} YAML command block
 */
function releaseArtifactFetchCommands(patterns, indent = "        ") {
  // An artifact's `path` is its uploaded location, so the glob is what selects
  // them: "build/<target>/**" is "everything the build step uploaded under
  // build/<target>/". The search is the server's, so a pattern matching nothing
  // is an empty result rather than an error.
  const patternList = patterns.map((pattern) => `"${pattern}"`).join(" ");

  return `${indent}# The build step uploaded what it compiled and the tests ran against;
${indent}# this fetches those exact bytes back rather than rebuilding the tree.
${indent}if ! command -v jq >/dev/null 2>&1; then
${indent}  apt-get update && apt-get install -y --no-install-recommends curl jq
${indent}fi
${indent}AGENT_API="https://agent-edge.buildkite.com/v3"
${indent}for pattern in ${patternList}; do
${indent}  if curl -fsS -G -H "Authorization: Token $$BUILDKITE_AGENT_ACCESS_TOKEN" \\
${indent}    --data-urlencode "query=$$pattern" --data-urlencode "state=finished" \\
${indent}    "$$AGENT_API/builds/$$BUILDKITE_BUILD_ID/artifacts/search" -o /tmp/buildkite-artifacts.json; then
${indent}    if [ "$$(jq 'length' /tmp/buildkite-artifacts.json)" -eq 0 ]; then
${indent}      echo "No $$pattern artifacts to attach - the release will carry notes only."
${indent}    else
${indent}      jq -r '.[] | [.path, .url] | @tsv' /tmp/buildkite-artifacts.json |
${indent}        while IFS="$$(printf '\\t')" read -r artifact_path artifact_url; do
${indent}          mkdir -p "$$(dirname "$$artifact_path")"
${indent}          curl -fsSL -o "$$artifact_path" "$$artifact_url" ||
${indent}            echo "Failed to fetch $$artifact_path - the release may not carry it." >&2
${indent}        done
${indent}    fi
${indent}  else
${indent}    echo "Could not list this build's artifacts - the release will carry notes only." >&2
${indent}  fi
${indent}done
`;
}

/**
 * Queue declaration shared by every generated step.
 * @param {string} queue - Agent queue
 * @returns {string} YAML fragment
 */
function _bkAgents(queue) {
  return `    agents:
      queue: ${queue}
`;
}

/**
 * The docker plugin block every containerised step uses.
 *
 * `envNames` are NAME-ONLY on purpose: a step-level `env:` value does not enter
 * the container, so anything the container needs must be listed here and take
 * its value from the job environment.
 *
 * @param {string} image - Container image
 * @param {string[]} [envNames] - Environment variable names to forward
 * @param {string} [commandYaml] - Optional `command:` in exec form
 * @param {string} [extraYaml] - Additional plugin options (e.g. `user: "1000"`)
 * @returns {string} YAML fragment
 */
function _bkDockerPlugin(
  image,
  envNames = [],
  commandYaml = "",
  extraYaml = "",
) {
  const envBlock = envNames.length
    ? `          environment:
${envNames.map((name) => `            - ${name}`).join("\n")}
`
    : "";
  return `      - docker#v5.13.0:
          image: "${image}"
          # The fleet is Apple silicon. Without this, docker resolves a
          # multi-arch tag to linux/amd64 and runs the whole step emulated (with
          # a warning, and native modules built for the wrong architecture).
          platform: linux/arm64
          workdir: /workdir
${extraYaml}${envBlock}${commandYaml}`;
}

/**
 * The queue fleet jobs run on, and the only queue a darwin target may use.
 *
 * Two roles, one value, deliberately: every generated step is dispatched here
 * unless the project names another queue, and a step that links a darwin binary
 * (and, separately, the darwin smoke gate that runs one) is dispatched here
 * *whatever* the project names, because the two reasons a queue is chosen are
 * not the same reason. A project changes `buildkite.queue` to control where its
 * containers run - the queue is a container-running decision - and a native
 * darwin step is not a container. Left to follow the project's queue it would be
 * sent to a Linux-only queue and hang, or worse, be handed to an agent that
 * starts `cargo` and cannot link a Mach-O binary.
 *
 * The name is misleading on purpose, and worth stating: `mac-studio-linux`
 * names the *containers* the queue's steps run in, not its hosts. Those hosts
 * are Macs (darwin/arm64), and a step with no docker plugin runs natively on
 * them - which is the whole reason a darwin target works here at all.
 *
 * Kept a constant rather than a `buildkite.macosQueue` setting: this is a fact
 * about the fleet, not a per-project choice, and the one fleet is declared here
 * rather than restated per capability.
 */
export const MACOS_QUEUE = "mac-studio-linux";

/**
 * The directory a singular unit's payload root is assembled into.
 *
 * One name, two callers: the smoke gate assembles it and then runs it, and the
 * release step assembles it and then packs it. They must agree, or the gate
 * stops being a gate — it would test a tree the tarball does not contain. The
 * assembler itself is the app-owned `scripts/build-payload.sh` (see its
 * template); this constant is only the path both generated steps hand it.
 */
const RELEASE_PAYLOAD_ROOT = "payload";

/**
 * Whether a target label names darwin. A *label* fact only: it says which host
 * may run the eventual artifact, not which host can build the step.
 *
 * A darwin *binary* cannot be linked in a Linux container - it needs the macOS
 * SDK and the linker that ships with Xcode - so the step that links one runs on
 * the agent HOST, with no docker plugin (which is why the queue's Macs need the
 * toolchain installed on the host and not only in the image). But only a step
 * that actually produces a platform binary is such a step; see
 * {@link releaseBuildUnits}' `platformBinary` and its use in
 * {@link renderBuildStep}. A singular non-rust target carries a darwin label
 * because the *payload* assembled from its output is darwin - the step itself
 * still produces a portable wheel or bundle and stays a container.
 *
 * The same predicate decides the queue: see {@link MACOS_QUEUE}.
 *
 * @param {string} target - A release target label
 * @returns {boolean} Whether the target names darwin
 */
function isDarwinTarget(target) {
  return target.endsWith("-apple-darwin");
}

/**
 * Buildkite step keys allow letters, digits, dashes and underscores; a target
 * label contains dots or dashes where a triple has a version or a vendor.
 *
 * @param {string} target - A release target label
 * @returns {string} A step key unique to that target
 */
function targetStepKey(target) {
  return `build_${target.replaceAll(/[.-]/g, "_")}`;
}

/**
 * The dpkg architecture name for a target triple.
 *
 * Needed because Debian's `musl-tools` is built for the host architecture only:
 * on the fleet's arm64 containers, `apt-get install musl-tools` installs an
 * arm64 `musl-gcc`, which cannot link an x86_64 target at all. Asked for with
 * `:<arch>` it installs the target's own, which is the only useful one.
 *
 * @param {string} target - A release target label
 * @returns {string} The dpkg architecture
 */
function debianArchForTarget(target) {
  const arch = target.split("-")[0];
  const debian = {
    x86_64: "amd64",
    aarch64: "arm64",
    i686: "i386",
    armv7: "armhf",
  };
  return debian[arch] || arch;
}

/**
 * The env var rustc reads to pick a target's linker:
 * `CARGO_TARGET_<TRIPLE_UPPER_UNDERSCORE>_LINKER`.
 *
 * Setting it is what makes a musl build musl. Without it rustc's final link
 * goes through the host `cc` — `aarch64-linux-gnu-gcc` in the fleet's arm64
 * containers — so an x86_64 target dies with `cc: error: unrecognized
 * command-line option '-m64'`, a failure with nothing to do with musl. Note
 * `CC_x86_64_unknown_linux_musl` is the *wrong* knob: it is read by the `cc`
 * crate for build scripts, not by rustc's link.
 *
 * @param {string} target - A release target label
 * @returns {string} The linker env var name
 */
function targetLinkerEnvVar(target) {
  return `CARGO_TARGET_${target.toUpperCase().replaceAll("-", "_")}_LINKER`;
}

/**
 * The commands for one target's rust build.
 *
 * Building for a target that is not the build host's own triple cannot be
 * followed by running the result, so tests run once - in the first target's step,
 * against the host toolchain - and the other steps build only. The alternative,
 * a `cargo test --target <triple>`, fails at the first executed test binary with
 * "cannot execute binary file".
 *
 * @param {string} target - A release target label
 * @param {boolean} runTests - Whether this step also runs the test suite
 * @param {string} projectBinaryName - The cargo package/binary name
 * @returns {string[]} Command blocks for the step
 */
function rustTargetCommands(target, runTests, projectBinaryName) {
  const isMusl = target.endsWith("-linux-musl");
  return [
    `|
        mkdir -p "build/${target}/bin"
        rustup target add "${target}"
${
  isMusl
    ? `        # The musl C toolchain, for the TARGET's architecture. Debian's
        # musl-tools is built for the host architecture only, so a plain
        # install puts an arm64 \`musl-gcc\` on the fleet's arm64 containers -
        # inert for an x86_64 target. Adding the target's architecture and
        # installing it multiarch repoints /usr/bin/musl-gcc at that arch's
        # wrapper, which is what the linker variable in this step's env names.
        dpkg --add-architecture ${debianArchForTarget(target)}
        apt-get update && apt-get install -y --no-install-recommends musl-tools:${debianArchForTarget(target)}
`
    : ""
}        cargo build --release --locked --target "${target}"
        if [ -f "target/${target}/release/${projectBinaryName}" ]; then
          cp "target/${target}/release/${projectBinaryName}" "build/${target}/bin/"
        else
          echo "target/${target}/release/${projectBinaryName} was not produced. Name the cargo package ${projectBinaryName}, or copy your binary into build/${target}/bin/ here." >&2
        fi`,
    ...(runTests ? ["cargo test --locked"] : []),
  ];
}

/**
 * The build steps a project's release needs: one per declared target, or the
 * single default step when it declares none.
 *
 * One step per target is what makes `github-release.targets` mean something -
 * the labels are the same table the release manifest is keyed by, so the
 * pipeline and whatever consumes the release agree on one vocabulary instead of
 * the consumer fetching a file the pipeline never built. `build/<target>/` is
 * the contract between them: the build step writes its payload there, the
 * release step uploads exactly that path, and scripts/release-artifacts.sh packs
 * it into `<project>-<target>.tar.gz`.
 *
 * @param {Object} params - Build inputs
 * @param {string} params.language - The primary language
 * @param {Object} params.commands - The language's default command set
 * @param {string[]} params.releaseTargets - Declared release targets
 * @param {string} params.singleTarget - Declared singular release target ("" if none)
 * @param {string[]} params.singleArtifactPaths - Default artifact paths
 * @param {string} params.projectBinaryName - The cargo package/binary name
 * @returns {Object[]} One entry per build step. Each carries `platformBinary`:
 * whether the step *links* a platform binary (only a per-target rust build
 * does), which is what decides the native/no-container build host rather than
 * the target label alone.
 */
function releaseBuildUnits({
  language,
  commands,
  releaseTargets,
  singleTarget = "",
  singleArtifactPaths,
  projectBinaryName,
}) {
  if (releaseTargets.length === 0) {
    return [
      {
        key: "build",
        label: `:hammer: Build and test (${language})`,
        // A singular `github-release.target` is one artifact, not a matrix. It
        // is *not* a build-host instruction: the label says what the payload
        // assembled from this step's output runs on, and for every language
        // that can declare one (i.e. every non-rust language - see
        // validateReleaseTargets) that output is architecture-independent: a
        // wheel, a JS bundle, a jar. The darwin-ness lives in the payload
        // (assembled by the app's own script) and in the smoke gate, so this
        // step stays a container. Only a unit that *links* a platform binary
        // gets the native, no-container decision - see renderBuildStep.
        target: singleTarget || null,
        // `language === "rust"` rather than `false`: a rust single unit would
        // link a platform binary and belong on a Mac, though validation sends
        // rust to the `targets` matrix and never reaches this branch.
        platformBinary: language === "rust",
        commands: commands[language],
        artifactPaths: singleArtifactPaths,
        env: {},
      },
    ];
  }

  return releaseTargets.map((target, index) => ({
    key: targetStepKey(target),
    label: `:hammer: Build (${language}, ${target})`,
    target,
    // A per-target rust build links a platform binary for `target` and only a
    // Mac can link the darwin one. This is the one unit shape whose build host
    // the label genuinely constrains.
    platformBinary: true,
    commands: rustTargetCommands(target, index === 0, projectBinaryName),
    artifactPaths: [`build/${target}/**`],
    // A musl target needs its own linker named explicitly; see
    // targetLinkerEnvVar. Nothing else about a target changes the environment.
    env: target.endsWith("-linux-musl")
      ? { [targetLinkerEnvVar(target)]: "musl-gcc" }
      : {},
  }));
}

/**
 * Renders one build step.
 *
 * @param {Object} unit - A release build unit
 * @param {Object} options - Step options
 * @param {string} options.queue - The agent queue
 * @param {string} options.image - The language's toolchain image
 * @param {boolean} options.hasGitGuardian - Whether the secret scan gates this
 * @param {boolean} options.hasGithubRelease - Whether anything consumes the output
 * @param {string[]} [options.extraDependencies] - Further step keys this step
 *   waits for (the frontend build, when the language's own image cannot build
 *   it).
 * @returns {string} The step, as YAML
 */
function renderBuildStep(
  unit,
  { queue, image, hasGitGuardian, hasGithubRelease, extraDependencies = [] },
) {
  const buildCommands = unit.commands.map((c) => `      - ${c}`).join("\n");
  // A release is the only thing that reads this step's output, so the upload
  // exists only when the capability is selected.
  const buildArtifacts =
    hasGithubRelease && unit.artifactPaths.length
      ? `    # Uploaded so the release step can attach what this build produced and
    # tested instead of rebuilding it.
    artifact_paths:
${unit.artifactPaths.map((p) => `      - "${p}"`).join("\n")}
`
      : "";
  // RELEASE_TARGET names the target for anything the project adds to this step;
  // the generated commands already have it spelled out literally. A musl target
  // adds the linker variable, without which rustc links with the host `cc`.
  const env = {
    ...(unit.target ? { RELEASE_TARGET: unit.target } : {}),
    ...(unit.env || {}),
  };
  const envKeys = Object.keys(env);
  const buildEnv = envKeys.length
    ? `    env:
${envKeys.map((name) => `      ${name}: ${env[name]}`).join("\n")}
`
    : "";
  // One predicate, two consequences - but the predicate is "this step LINKS a
  // platform binary AND its target is darwin", not "the target is darwin". Only
  // a per-target rust build links a platform binary (see releaseBuildUnits); a
  // singular non-rust target's step produces a portable wheel or bundle, so it
  // stays a container even though its label names darwin. Applying the rule to
  // the label alone made a python build native, where it cannot pip-install
  // into Homebrew's PEP-668-managed interpreter at all.
  //
  // The two consequences, when the step is native: no docker plugin (the plugin
  // would run it in a Linux container, where a macOS binary cannot be linked)
  // and the macOS queue rather than the project's - a project that moved its
  // containers to a Linux queue must not take its native build with them.
  const nativeDarwin = unit.platformBinary && isDarwinTarget(unit.target || "");
  // The step's `env:` values do not enter the container on their own - only the
  // names listed in the plugin's `environment:` do, and they take their value
  // from the job environment. Without this the musl target's
  // CARGO_TARGET_<TRIPLE>_LINKER never reaches rustc, whose final link then
  // falls back to the host `cc` and dies on `-m64` (see targetLinkerEnvVar).
  const buildPlugins = nativeDarwin
    ? ""
    : `    plugins:
${_bkDockerPlugin(image, envKeys)}`;
  const dependencies = [
    ...(hasGitGuardian ? ["secret_scan"] : []),
    ...extraDependencies,
  ];
  const dependsOnLines = dependencies.map((key) => `      - ${key}`).join("\n");
  const buildDependsOn = dependencies.length
    ? `    depends_on:\n${dependsOnLines}\n`
    : "";
  return `
  - label: "${unit.label}"
    key: ${unit.key}
${buildDependsOn}${_bkAgents(nativeDarwin ? MACOS_QUEUE : queue)}${buildEnv}${buildArtifacts}${buildPlugins}    commands:
${buildCommands}
`;
}

/**
 * The step key of the smoke gate for a target. Distinct from the build step's
 * key so the release can depend on the gate rather than on the build.
 *
 * @param {string} target - A release target label
 * @returns {string} A step key unique to that target's smoke gate
 */
function smokeStepKey(target) {
  return `smoke_${target.replaceAll(/[.-]/g, "_")}`;
}

/**
 * Renders the smoke step that RUNS a darwin target's payload before release.
 *
 * A darwin payload is built on a Mac host - the only host in the fleet that can
 * execute it - but building it there proves it links, not that it runs. Nothing
 * between the build step and the release used to execute the artifact, so a
 * payload that could not start shipped and failed only once a host installed
 * it. This step runs the seeded, app-owned `scripts/smoke-launch.sh` against
 * the payload the build step uploaded, and the release depends on it.
 *
 * Native always, whether or not the build step was: it is the *payload* that is
 * darwin - a rust build's linked binary, or a non-rust build's assembled one -
 * and running it needs a Mac whatever produced it. So no docker plugin (a macOS
 * payload cannot run in a Linux container) and the macOS queue whatever the
 * project's queue is. Being native is also what lets it fetch artifacts with the
 * agent binary directly - the release step cannot, because its Linux container
 * cannot launch the macOS agent binary (which is why that step uses the agent
 * API).
 *
 * @param {Object} unit - The darwin build unit this gate runs
 * @param {Object} options - Step options
 * @param {boolean} options.assemblePayload - Whether the build output must be
 * assembled into a payload root before it can run (the singular, non-rust
 * case). A rust build links its payload directly, so it is false there.
 * @returns {string} The step, as YAML
 */
function renderSmokeStep(unit, { assemblePayload } = {}) {
  const roots = unit.artifactPaths.map((p) => p.replace(/\/\*\*$/, ""));
  const patterns = unit.artifactPaths.map((p) => `"${p}"`).join(" ");
  // A unit whose build output is not already a payload root — every singular
  // (non-rust) unit — has to assemble one first, through the same app-owned
  // script and into the same output root the release step uses, so this gate
  // executes exactly the tree the tarball will contain. A rust matrix build
  // links its payload into build/<target>/ directly: that IS the root, so it is
  // run as-is and nothing is assembled.
  const assemble = assemblePayload
    ? `
      - |
        # The build output is a release INPUT (a wheel, a bundle), not a payload
        # root. Assemble it with the same script and the same output root the
        # release step uses, so this gate runs what the tarball will contain. The
        # version is positional because the two callers pass different ones: a
        # smoke label here, the release tag there.
        bash scripts/build-payload.sh ${'"$${SMOKE_VERSION:-0.0.0-smoke}"'} ${RELEASE_PAYLOAD_ROOT} ${roots[0]}`
    : "";
  const smokeRoots = assemblePayload ? [RELEASE_PAYLOAD_ROOT] : roots;
  return `
  - label: ":apple: Smoke-test (${unit.target})"
    key: ${smokeStepKey(unit.target)}
    depends_on:
      - ${unit.key}
    # Main-only, like the release it gates: a darwin payload is only published
    # from main, and a native Mac job on every branch buys nothing the release
    # gate does not already cover.
    if: build.branch == "main"
    agents:
      queue: ${MACOS_QUEUE}
    env:
      RELEASE_TARGET: ${unit.target}
    commands:
      - |
        # The payload this step runs is exactly what the build step uploaded. A
        # native step can call the agent binary directly; the release step cannot
        # (its Linux container cannot launch the macOS agent binary), which is
        # why that step uses the agent API instead.
        for pattern in ${patterns}; do
          buildkite-agent artifact download "$$pattern" .
        done${assemble}
      - bash scripts/smoke-launch.sh ${smokeRoots.map((r) => `"${r}"`).join(" ")}
`;
}

/**
 * Builds the generated project's `.buildkite/pipeline.yml`.
 *
 * The step set is **capability-driven**, mirroring the CircleCI template: the
 * deployment capabilities contribute deploy steps, `gitguardian` contributes the
 * secret scan, `lighthouse-ci` contributes the performance gate, and so on. A
 * project that selects none of them gets build + test and nothing else.
 *
 * Deliberately smaller than ftn's pipeline in two ways. ftn's bootstrap +
 * routing split exists to path-filter, and the generated CircleCI config does
 * not path-filter either (parity). And install/build/test run in ONE job, since
 * ftn measured the install as the dominant fixed cost.
 *
 * @param {Object} context - Template context (capabilities, configuration)
 * @returns {Object} Buildkite template data
 */
function getBuildkiteTemplateData(context) {
  const config = context.configuration?.buildkite || {};
  const caps = context.capabilities || [];
  const language = resolveProjectLanguage(context);
  const queue = config.queue || MACOS_QUEUE;
  const branchGating = config.branchGating !== false;
  const usesPlaywright = caps.includes("playwright");
  const hasDoppler = caps.includes("doppler");
  const hasGitGuardian = caps.includes("gitguardian");
  const hasLighthouse = caps.includes("lighthouse-ci");
  const hasWrangler = caps.includes("cloudflare-wrangler");
  const hasDockerContainer = caps.includes("docker-container");
  const hasGithubRelease = caps.includes("github-release");

  // What the build step hands to the release step. Buildkite artifacts are the
  // channel one step reads another step's output through, and using them is
  // what lets the release step attach the exact bytes this build compiled and
  // tested rather than compiling them a second time. The paths are the one
  // project-specific detail in the mechanism: they follow the language's usual
  // output directory, and `buildkite-agent artifact upload` does not fail when
  // a pattern matches nothing, so a build that outputs elsewhere costs nothing
  // until it is corrected. Change them here and the matching download in the
  // release step together.
  const singleArtifactPaths =
    language === "node"
      ? ["dist/**"]
      : language === "rust"
        ? ["target/release/**"]
        : language === "python"
          ? ["dist/**"]
          : [];

  // Per-target release builds (`github-release.targets`). Empty is the
  // single-artifact case above. With targets declared the build becomes a
  // matrix - one step per target, each uploading its own payload - because one
  // artifact is only the right answer for a project that ships one platform,
  // and because the target labels are the same table the release manifest is
  // keyed by: the pipeline and whatever consumes the release have to agree on
  // one vocabulary, or the consumer fetches a file the pipeline never built.
  //
  // `build/<target>/` is the contract between the two: the build step writes
  // its per-target payload there, the release step uploads exactly that path,
  // and scripts/release-artifacts.sh packs it into `<project>-<target>.tar.gz`.
  const grConfig = context.configuration?.["github-release"] || {};
  const releaseTargets = Array.isArray(grConfig.targets)
    ? grConfig.targets.filter(
        (target) => typeof target === "string" && target.trim() !== "",
      )
    : [];
  // The singular counterpart: one artifact, one label (mutually exclusive with
  // `targets`; see validateReleaseTargets). It is not a matrix, but it *is* a
  // target, so it is passed to releaseBuildUnits so the darwin decision is made
  // in one place rather than once per path.
  const singleTarget =
    typeof grConfig.target === "string" ? grConfig.target.trim() : "";
  // The cargo binary the build step looks for under
  // `target/<triple>/release/`. It goes through the same sanitiser as the
  // generated Cargo.toml's package name, so the manifest and the step cannot
  // disagree about what cargo will have produced.
  const projectBinaryName = cargoPackageName(
    context.projectName || context.name || "my-project",
  );

  const releaseArtifactPaths = releaseTargets.length
    ? releaseTargets.map((target) => `build/${target}/**`)
    : singleArtifactPaths;

  const images = {
    node: "node:22-bookworm",
    python: "python:3.13-slim",
    rust: "rust:1-slim",
    java: "eclipse-temurin:21-jdk",
  };
  const image = images[language];
  // The pinned Playwright image is the one proven on this fleet; Lighthouse
  // needs the Chromium it bakes in (there is no Google Chrome Stable).
  const playwrightImage =
    "mcr.microsoft.com/playwright:v1.63.0-jammy@sha256:167d0506cfbe3c294fb214b2d11737326eeee028aa611fa1ba538e5057675847";
  const chromiumPath = "/ms-playwright/chromium-1243/chrome-linux-arm64/chrome";

  // A generated project has a package.json but NO package-lock.json, so a bare
  // `npm ci` fails outright ("can only install with an existing
  // package-lock.json"). CircleCI's template guards this the same way.
  // The generated package.json pins npm (`packageManager`) and .npmrc sets
  // engine-strict=true, so the image's bundled npm REFUSES to install and dies
  // with the opaque "Cannot read properties of null (reading 'edgesOut')".
  // Activate the pinned npm first - this is CircleCI's activate_pinned_npm
  // step, and skipping it is why the first fleet build of a generated project
  // failed.
  // The command *value* (no leading `- `): used as an array element in the
  // node command list and interpolated into the other step blocks.
  const npmActivate = `|
        PINNED="$$(node -p "require('./package.json').packageManager || ''" | sed -e 's/^npm@//')"
        if [ -n "$$PINNED" ]; then npm install -g "npm@$$PINNED"; fi`;
  const npmInstall =
    "if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --prefer-offline; else npm install --no-audit --no-fund; fi";

  const commands = {
    node: [
      npmActivate,
      npmInstall,
      ...(usesPlaywright
        ? ["npx --yes playwright install --with-deps chromium"]
        : []),
      "npm run build --if-present",
      "npm run lint --if-present",
      // `CI=true` because the docker plugin allocates a TTY, and without
      // it vitest starts in WATCH MODE and the step hangs until the job is
      // killed (observed on the fleet). CircleCI never hit this - it has
      // no TTY - which is exactly why the difference matters here.
      //
      // `--if-present` is not enough on its own: a plain `npm init` project
      // carries `"test": "echo \"Error: no test specified\" && exit 1"`,
      // which fails by design. Skip that placeholder (and say so) rather
      // than reporting a red build for a repo that has no tests yet.
      `|
        if node -e "const s = require('./package.json').scripts || {}; process.exit(s.test && !s.test.includes('no test specified') ? 0 : 1)"; then
          CI=true npm test
        else
          echo "No test script (or the npm placeholder) - skipping tests."
        fi`,
    ],
    python: [
      'python -m pip install --no-cache-dir -e ".[dev]"',
      // A MicroPython project is firmware, not an installable host package:
      // there is no wheel to build and no host test suite to run, so those
      // steps are omitted rather than run against an empty tree.
      ...(isMicropython(context)
        ? []
        : [
            // The release attaches what the build produced, so the build has
            // to produce a distribution: a `dist/` path with nothing creating
            // `dist/` is the silent-empty-match trap - `artifact upload` does
            // not fail on a pattern that matches nothing, so the release would
            // silently be notes-only. `python -m build` makes the wheel + sdist
            // the existing release-artifacts.sh already knows how to pack.
            "python -m pip install --no-cache-dir build",
            "python -m build",
          ]),
      ruffCheckCommand(context),
      ...(isMicropython(context) ? [] : ["pytest -q"]),
    ],
    rust: ["cargo build --locked", "cargo test --locked"],
    // genproj generates a Java devcontainer but no build system (no pom.xml
    // or build.gradle), so there is genuinely nothing to build yet. Say that
    // rather than emitting a step that fails on the first push.
    java: [
      'echo "genproj generates a Java devcontainer, not a build system."',
      'echo "Add your build/test commands to .buildkite/pipeline.yml (for example: mvn -B -q verify)."',
    ],
  };

  const steps = [];

  // --- secret scan (gitguardian) -------------------------------------------
  // Runs first and gates the build, mirroring the CircleCI workflow where
  // `build` requires `ggshield-scan`.
  if (hasGitGuardian) {
    steps.push(`
  - label: ":shield: Secret scan (ggshield)"
    key: secret_scan
${_bkAgents(queue)}    plugins:
${_bkDockerPlugin(
  "gitguardian/ggshield:v1.54.0",
  ["GITGUARDIAN_API_KEY"],
  `          # The image declares no ENTRYPOINT (Cmd is "ggshield"), so the full argv
          # has to be spelled out - passing ["secret","scan","path","."] would
          # exec a binary called "secret" and exit 127.
          command: ["ggshield", "secret", "scan", "path", "."]
`,
)}`);
  }

  // --- build + test --------------------------------------------------------
  const buildUnits = releaseBuildUnits({
    language,
    commands,
    releaseTargets,
    singleTarget,
    singleArtifactPaths,
    projectBinaryName,
  });
  // A singular unit's build output is not a payload root (a wheel, a bundle):
  // the smoke gate and the release step both assemble one first, through the
  // one app-owned script. A rust build links its payload into build/<target>/,
  // which IS the root, so nothing is assembled. `validateReleaseTargets` makes
  // the mapping exact — `target` is non-rust only, `targets` is rust only — so
  // "not rust" is precisely "there is something to assemble".
  const assemblePayload = hasGithubRelease && language !== "rust";
  const assembledInputDir = assemblePayload
    ? (singleArtifactPaths[0] || "").replace(/\/\*\*$/, "")
    : "";

  // `code-quality-rust` contributes commands, not a step: the component
  // install and the lints run inside the build, exactly as the CircleCI
  // language-aware lint does. The commands are prepended to the FIRST build
  // unit - in a release matrix the first unit is the one that runs tests
  // against the host toolchain, and linting is a whole-crate check that does
  // not need repeating per target. RUST_LINT_STEP_COMMANDS (not
  // RUST_LINT_COMMANDS) is what carries the `rustup component add`: rust:1-slim
  // is the minimal profile, with neither rustfmt nor clippy.
  if (language === "rust" && caps.includes("code-quality-rust")) {
    buildUnits[0].commands = [
      ...RUST_LINT_STEP_COMMANDS,
      ...buildUnits[0].commands,
    ];
  }

  // --- frontend build (a frontend in a non-node project) -------------------
  // A Svelte app in a Rust/Python/Java project is a sub-build: the language's
  // own CI image (rust:1-slim, python:3.13-slim, eclipse-temurin:21-jdk) has no
  // node, so the frontend cannot be built inside the language's build step. It
  // gets its own step, on a node image, and every build unit waits for it -
  // which is what proves the UI builds in CI rather than discovering it at
  // image-build time. Keyed off the `frontend` contribution type, not sveltekit.
  const svelteDirectory =
    hasFrontend(context) && language !== "node"
      ? resolveSvelteDirectory(context)
      : "";
  const needsFrontendBuild = svelteDirectory !== "";
  const frontendStepKey = "frontend_build";

  if (needsFrontendBuild) {
    steps.push(`
  - label: ":svelte: Build frontend (${svelteDirectory})"
    key: ${frontendStepKey}
${hasGitGuardian ? "    depends_on:\n      - secret_scan\n" : ""}${_bkAgents(queue)}    plugins:
${_bkDockerPlugin(images.node, [])}    commands:
      - cd ${svelteDirectory}
      - ${npmActivate}
      - ${npmInstall}
      - npm run build
`);
  }

  for (const unit of buildUnits) {
    steps.push(
      renderBuildStep(unit, {
        queue,
        image,
        hasGitGuardian,
        hasGithubRelease,
        extraDependencies: needsFrontendBuild ? [frontendStepKey] : [],
      }),
    );
  }

  // --- darwin smoke gate (github-release) ----------------------------------
  // Every darwin build unit gets a step that RUNS the payload it produced: the
  // darwin host is the one host in the fleet that can execute a macOS artifact,
  // and building it there is not the same as it starting. The release depends on
  // these (see releaseDependencies), so a payload that cannot start blocks the
  // release instead of failing on the first host that installs it. Only a
  // darwin unit is gated: no host in this fleet can execute the Linux targets.
  const darwinBuildUnits = hasGithubRelease
    ? buildUnits.filter((unit) => unit.target && isDarwinTarget(unit.target))
    : [];
  for (const unit of darwinBuildUnits) {
    steps.push(renderSmokeStep(unit, { assemblePayload }));
  }

  // Every step that consumes the build's output depends on all of its steps,
  // not just one: with targets declared the build is a matrix, and a release
  // that depended on a single target's step would attach whatever that one
  // produced and call the release complete.
  const buildDependencies = `    depends_on:
${buildUnits.map((unit) => `      - ${unit.key}`).join("\n")}
`;

  // The release additionally depends on each darwin smoke gate, so the release
  // is not published until the payload has been run. Only the release takes
  // these extra edges: the deploy steps consume the build, not the release
  // payload, and must not wait on a macOS smoke test to deploy.
  const releaseDependencies = `    depends_on:
${[
  ...buildUnits.map((unit) => unit.key),
  ...darwinBuildUnits.map((unit) => smokeStepKey(unit.target)),
]
  .map((key) => `      - ${key}`)
  .join("\n")}
`;

  // --- Lighthouse (lighthouse-ci) ------------------------------------------
  // A release-quality gate, so main-only by default - matching CircleCI's job
  // filter, and incidentally skipping dependabot/** branches.
  if (hasLighthouse) {
    steps.push(`
  - label: ":chrome: Lighthouse CI"
    key: lighthouse
${buildDependencies}${branchGating ? '    if: build.branch == "main"\n' : ""}${_bkAgents(queue)}    plugins:
${_bkDockerPlugin(playwrightImage, ["CHROME_PATH"])}    # CHROME_PATH must be listed as a NAME in the plugin's environment: above.
    # A step-level env: value never enters the container.
    env:
      CHROME_PATH: ${chromiumPath}
    commands:
      - ${npmActivate}
      - ${npmInstall}
      - npm run build --if-present
      # The generated config is .lighthouse.cjs, which is not one of lhci's
      # default filenames, so it is passed explicitly.
      - npm install -g @lhci/cli && lhci autorun --config .lighthouse.cjs
`);
  }

  // --- Cloudflare deploy (cloudflare-wrangler) -----------------------------
  if (hasWrangler) {
    const wranglerConfig = context.configuration?.["cloudflare-wrangler"] || {};
    const isRustWorker = wranglerConfig.workerType === "rust";
    const dopplerTarget = resolveDopplerTarget(context);
    const dopplerConfig = dopplerTarget.config || "dev";

    const installDoppler = hasDoppler
      ? `      - |
${dopplerCliInstallCommands("        ")}      - |
        # sync-doppler-secrets.sh needs jq and exits without it ("jq is not
        # installed or not in PATH"); the failure lands AFTER a successful
        # wrangler deploy, which reads as a deploy failure. Install it first,
        # once, before anything else.
        if ! command -v jq >/dev/null 2>&1; then
          apt-get update && apt-get install -y --no-install-recommends jq
        fi
      - |
        # Resolve the Cloudflare credentials from Doppler rather than the
        # agent's environment hook, so no per-repo credential sits there.
        # Exporting at this point persists for the rest of the step (the docker
        # plugin runs every command in one shell), so nothing has to be listed
        # in the plugin's environment:.
        export CLOUDFLARE_API_TOKEN="$$(doppler secrets get CLOUDFLARE_API_TOKEN --project common --config ${dopplerConfig} --plain)"
        export CLOUDFLARE_ACCOUNT_ID="$$(doppler secrets get CLOUDFLARE_ACCOUNT_ID --project common --config ${dopplerConfig} --plain)"
`
      : "";
    const setupWrangler = hasDoppler
      ? `      - ./scripts/setup-wrangler-config.sh "${dopplerConfig}"
`
      : "";
    const syncSecrets = (cloudflareEnv) =>
      hasDoppler
        ? `      - ./scripts/sync-doppler-secrets.sh --project ${dopplerTarget.project} --config ${dopplerConfig} --env ${cloudflareEnv}
`
        : "";
    const buildStep = isRustWorker
      ? `      - |
        # A Rust worker is built by cargo. Rust is installed into the container
        # per run rather than baked into the image - rustup is about a gigabyte,
        # and the image is shared with the build step, so the cost lands on
        # deploy time instead of on every job.
        if ! command -v cargo >/dev/null 2>&1; then
          curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
          . "$$HOME/.cargo/env"
        fi
        (cd worker && cargo build --release)
`
      : `      - npm run build --if-present
`;
    // A Rust worker is deployed from inside worker/ - that is where its
    // wrangler config lives, and CircleCI did the same (`cd worker` before
    // wrangler). Running wrangler from the repo root makes it fall back to
    // auto-detection and fail with "Could not detect a directory containing
    // static files".
    const deployCommand = (cloudflareEnv) => {
      // A Rust worker is deployed from inside worker/, which is where its
      // wrangler config lives - CircleCI did the same (`cd worker`). From the
      // repo root wrangler falls back to auto-detection and fails with
      // "Could not detect a directory containing static files", after a
      // successful build, which reads as a build failure.
      const envFlag =
        cloudflareEnv === "default" ? "" : ` --env ${cloudflareEnv}`;
      return isRustWorker
        ? `      - (cd worker && npx --yes wrangler deploy${envFlag})\n`
        : `      - npx --yes wrangler deploy${envFlag}\n`;
    };

    // With doppler the credentials are resolved inside the container, so only
    // DOPPLER_TOKEN needs forwarding; without it they have to come from the
    // agent environment, which the generated README spells out.
    const deployPlugins = _bkDockerPlugin(image, [
      ...(hasDoppler ? [] : ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]),
      ...(hasDoppler ? ["DOPPLER_TOKEN"] : []),
    ]);

    steps.push(`
  - label: ":rocket: Deploy (production)"
    key: deploy
${buildDependencies}    if: build.branch == "main"
${_bkAgents(queue)}    plugins:
${deployPlugins}    commands:
      - ${npmActivate}
      - ${npmInstall}
${installDoppler}${setupWrangler}${buildStep}${deployCommand("default")}${syncSecrets("default")}`);

    // Branch gating: a preview on every branch is wasteful, and a main-only
    // preview is redundant with the production deploy. Opt out with
    // buildkite.branchGating = false (same default as CircleCI).
    if (!branchGating) {
      steps.push(`
  - label: ":rocket: Deploy preview"
    key: deploy_preview
${buildDependencies}    if: build.branch != "main" && build.branch !~ /^dependabot\\//
${_bkAgents(queue)}    plugins:
${_bkDockerPlugin(image, [
  ...(hasDoppler ? [] : ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]),
  ...(hasDoppler ? ["DOPPLER_TOKEN"] : []),
])}    commands:
      - ${npmActivate}
      - ${npmInstall}
${installDoppler}${setupWrangler}${buildStep}      - npx --yes wrangler deploy --env preview
${syncSecrets("preview")}`);
    }
  }

  // --- container image publish (docker-container) --------------------------
  // Runs on the AGENT, not in a container: it needs a Docker daemon, and the
  // agent already has one (it is what runs every other step). This mirrors
  // CircleCI's setup_remote_docker + docker_layer_caching.
  if (hasDockerContainer) {
    const dcConfig = context.configuration?.["docker-container"] || {};
    const registryNamespace =
      context.registryNamespace || dcConfig.registryNamespace || "OWNER";
    const projectName = context.projectName || context.name || "my-project";
    const imageRef = `ghcr.io/${registryNamespace}/${projectName}`;
    const cacheRef = `${imageRef}:buildcache`;
    const buildPlatforms =
      dcConfig.armBuilds === true ? "linux/amd64,linux/arm64" : "linux/amd64";

    // The registry credential has one of two sources, chosen by whether the
    // doppler capability is selected - the same gate the cloudflare-wrangler
    // deploy step uses. `docker-container` deliberately does NOT declare
    // doppler as a hard dependency: hasGoose is `includes("doppler")`, so that
    // would drag goose (the binary, the wrapper, the Doppler context pin, the
    // SSH git-auth setup, the README section) into every container project -
    // including the ones that select no CI at all and never emit this step.
    //   - With doppler, GHCR_UPDATE_TOKEN is resolved at run time with the
    //     agent's DOPPLER_TOKEN - the same channel the secret scan uses. This
    //     is preferred because a write:packages token in the agent's
    //     environment hook would be readable by every job on the fleet.
    //   - Without it, the credentials come from the agent environment by name,
    //     the same GHCR_USERNAME/GHCR_TOKEN contract the CircleCI context
    //     supplies. Both branches are real channels - unlike the release step's
    //     GH_TOKEN branch, which its doppler dependency makes unreachable.
    const dockerCredentialCommands = hasDoppler
      ? `        # Resolved at run time, never stored in the repository and never in the
        # agent's environment hook, where every job on the fleet could read it.
        GHCR_USERNAME=${registryNamespace}
        GHCR_TOKEN="$$(curl -fsS -H "Authorization: Bearer $$DOPPLER_TOKEN" "https://api.doppler.com/v3/configs/config/secret?project=common&config=prd&name=GHCR_UPDATE_TOKEN" | sed -n 's/.*"raw"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p')"
        if [ -z "$$GHCR_TOKEN" ]; then
          echo "GHCR_UPDATE_TOKEN is missing from Doppler (common/prd) - cannot publish." >&2
          exit 1
        fi`
      : `        # No doppler capability: the registry credentials come from the agent's
        # \`environment\` hook, where they are set by name.
        if [ -z "$$GHCR_USERNAME" ] || [ -z "$$GHCR_TOKEN" ]; then
          echo "GHCR_USERNAME/GHCR_TOKEN are not set on the agent - cannot publish." >&2
          exit 1
        fi`;

    // --- container smoke gate ---------------------------------------------
    // "CI green and the image dead" is the failure this exists to catch: the
    // publish step only ever proved the image BUILT. roost shipped a `rust:1-slim`
    // runtime running a stub that printed one line and exited while every step
    // passed. This step builds the image, RUNS it, and polls the image's own
    // HEALTHCHECK until it reports healthy - a container that exits instead of
    // serving is a failure too, not just an unhealthy one. It runs on EVERY
    // branch (not just main), so a broken image fails the pull request rather
    // than the deploy, and publish depends on it (see below), so an image that
    // cannot serve never reaches GHCR.
    //
    // It applies wherever genproj can expect the image to serve its own
    // healthcheck:
    //   - a node primary (genproj scaffolds the SvelteKit/node server); or
    //   - a non-node primary WITH a frontend (genproj now scaffolds a serving
    //     harness for it - see servingHarnessSpec - so the image serves the
    //     default /healthz out of the box); or
    //   - a declared command/entrypoint (the user owns the entry point).
    // A non-node project with NO frontend still gets no gate: its placeholder
    // binary makes no promise, so a health-gate there would be red by default.
    // No healthcheck at all means there is nothing to poll.
    const smokeHealthcheck =
      typeof dcConfig.healthcheck === "string"
        ? dcConfig.healthcheck.trim()
        : "";
    const smokeLanguage = resolveProjectLanguage(context);
    const smokeServesByDefault =
      smokeLanguage === "node" || servingHarnessSpec(context) !== null;
    // A node project defaults to http:/health and a non-node frontend project
    // to http:/healthz (see the Dockerfile emitter), so no declared
    // healthcheck still means there IS one; `none` opts out.
    const smokeHasHealthcheck =
      smokeHealthcheck !== "none" &&
      (smokeHealthcheck !== "" || smokeServesByDefault);
    const smokeDeclaresEntrypoint =
      (Array.isArray(dcConfig.command) && dcConfig.command.length > 0) ||
      (Array.isArray(dcConfig.entrypoint) && dcConfig.entrypoint.length > 0);
    const emitsSmokeGate =
      smokeHasHealthcheck && (smokeServesByDefault || smokeDeclaresEntrypoint);
    const smokeTimeoutChecks = 30;
    if (emitsSmokeGate)
      steps.push(`
  - label: ":male-doctor: Smoke test image (starts and serves HTTP)"
    key: docker_smoke
${buildDependencies}${_bkAgents(queue)}    env:
      SMOKE_IMAGE: ${projectName}-smoke
    commands:
      - >-
        docker build -t "$$SMOKE_IMAGE:$$BUILDKITE_COMMIT" .
      - |
        set -euo pipefail
        CONTAINER="$$SMOKE_IMAGE-$$BUILDKITE_JOB_ID"
        trap 'docker rm -f "$$CONTAINER" >/dev/null 2>&1 || true' EXIT
        docker run -d --name "$$CONTAINER" "$$SMOKE_IMAGE:$$BUILDKITE_COMMIT" >/dev/null
        # Poll the DECLARED healthcheck. A container that exits (the old rust
        # stub restart-looped) is a failure, so running is checked as well as
        # health: "not running" is reported with its logs, never mistaken for a
        # slow start.
        for i in $$(seq 1 ${smokeTimeoutChecks}); do
          RUNNING="$$(docker inspect -f '{{.State.Running}}' "$$CONTAINER" 2>/dev/null || echo false)"
          HEALTH="$$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$$CONTAINER" 2>/dev/null || echo unknown)"
          echo "attempt $$i: running=$$RUNNING health=$$HEALTH"
          if [ "$$HEALTH" = "healthy" ]; then
            echo "image starts and serves HTTP (healthcheck passed)"
            exit 0
          fi
          if [ "$$RUNNING" != "true" ]; then
            echo "container is not running - it exited instead of serving:" >&2
            docker logs "$$CONTAINER" >&2 || true
            exit 1
          fi
          sleep 2
        done
        echo "container never became healthy:" >&2
        docker logs "$$CONTAINER" >&2 || true
        exit 1
`);

    steps.push(`
  - label: ":docker: Build and publish image (GHCR)"
    key: docker_publish
${buildDependencies}${emitsSmokeGate ? "      - docker_smoke\n" : ""}    if: build.branch == "main"
${_bkAgents(queue)}    env:
      IMAGE: ${imageRef}
      CACHE_REF: ${cacheRef}
    commands:
      - |
${dockerCredentialCommands}
        # One shell on purpose: Buildkite runs each command in its own shell, so
        # the credential below would be gone by the next one, and an exit 0 in a
        # separate command would not stop the commands after it.
        #
        # No \`login\` subcommand, and no per-job DOCKER_CONFIG. Both were tried and
        # both failed on the build host: the macOS CLI falls back to the
        # osxkeychain helper even with no credsStore configured, so two builds of
        # one commit still wrote the same keychain item and the loser died with
        # "The specified item already exists in the keychain. (-25299)"; and
        # DOCKER_CONFIG is also the root for cli-plugins, so redirecting it hides
        # \`docker buildx\` entirely (the next command died with "unknown flag:
        # --bootstrap", parsed by the root docker parser).
        # DOCKER_AUTH_CONFIG carries the same credential with no helper writing
        # anything, so there is no shared state left to race. See
        # specs/015-genproj-docker-publish-idempotent.
        export DOCKER_AUTH_CONFIG='{"auths":{"ghcr.io":{"auth":"'"$$(printf '%s:%s' "$$GHCR_USERNAME" "$$GHCR_TOKEN" | base64)"'"}}}'
        BUILDX_BUILDER_NAME="bk-$$BUILDKITE_PIPELINE_SLUG-$$BUILDKITE_JOB_ID"
        trap 'docker buildx rm "$$BUILDX_BUILDER_NAME" >/dev/null 2>&1 || true' EXIT
        # Skip if this commit is already published: the release step's ls-remote
        # guard, for an image. Only a positive answer skips - if the registry
        # cannot be reached the push still runs, because "could not ask" must
        # never read as "already published".
        if docker buildx imagetools inspect "$$IMAGE:$$BUILDKITE_COMMIT" >/dev/null 2>&1; then
          echo "$$IMAGE:$$BUILDKITE_COMMIT is already in the registry - skipping the build."
          exit 0
        fi
        docker buildx create --bootstrap --name "$$BUILDX_BUILDER_NAME" >/dev/null
        docker buildx build --builder "$$BUILDX_BUILDER_NAME" --platform ${buildPlatforms} \\
          --cache-from type=registry,ref=$$CACHE_REF \\
          --cache-to type=registry,ref=$$CACHE_REF,mode=max \\
          -t $$IMAGE:$$BUILDKITE_COMMIT -t $$IMAGE:latest --push .
`);
  }

  // --- release (github-release) --------------------------------------------
  // The tag is created HERE, by CI, after the build step passed on this exact
  // commit - so a release can only exist for code that was validated in the
  // same build. Same shape as the deploy step: depends_on build, main only.
  if (hasGithubRelease) {
    // The tag prefix is fixed at `v` and is not configurable: it is written and
    // read only by this step, so a project-specific prefix buys nothing that a
    // declared choice would not already say. Adopting a repo that already has a
    // differently-prefixed tag series is the one case it would have served;
    // that project can re-tag instead of carrying a knob every other project
    // would never touch.
    // The release flags are fixed: notes always come from the merged pull
    // requests in the release (`--generate-notes`), the release is always
    // published rather than left as a draft or flagged pre-release, and
    // `--verify-tag` makes a missing tag an error instead of publishing a
    // release anchored to nothing. These were configuration parameters; they
    // were removed because those defaults suit the projects genproj generates.
    // Re-expose them if a project ever needs a draft or a pre-release.
    const releaseFlags = "--generate-notes --verify-tag";
    // The release step runs in its own container, so the build output is not
    // there - but it does not have to be rebuilt either. The build step
    // uploaded what it compiled and tested, and this step fetches those exact
    // bytes back: one build per commit, and the release attaches what the tests
    // actually ran against rather than a second compile of the same tree.
    //
    // A miss is reported as "notes only" rather than failing the release: an
    // artifact path that matches nothing is the normal case for a project whose
    // build outputs somewhere other than the default, and the release itself is
    // still worth publishing.
    const releaseArtifacts = releaseArtifactPaths.length
      ? `      - |
${releaseArtifactFetchCommands(releaseArtifactPaths, "        ")}`
      : `      - |
        # This language has no default artifact paths, so there is nothing to
        # fetch. Add artifact_paths to the build step and a fetch here to ship
        # files with the release.
        echo "No artifact paths configured - the release will carry notes only."
`;
    // The generated language images ship the toolchain, not the GitHub CLI, and
    // `gh release create` is how the release is published, so it is installed
    // on demand. The official apt repository is used rather than a pinned
    // tarball because it is the one source that keeps working as the image
    // moves.
    const installGh = `      - |
        if ! command -v gh >/dev/null 2>&1; then
          apt-get update
          apt-get install -y --no-install-recommends curl ca-certificates gnupg
          curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
          chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
          echo "deb [arch=$$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
          apt-get update
          apt-get install -y --no-install-recommends gh
        fi
`;
    const releaseToken = hasDoppler
      ? `      - |
${dopplerCliInstallCommands("        ")}      - |
        # Resolved at run time, never stored in the repository and never in the
        # agent's environment hook, where every job on the fleet could read it.
        export GH_TOKEN="$$(doppler secrets get GITHUB_RELEASE_TOKEN --project common --config prd --plain)"
        if [ -z "$$GH_TOKEN" ]; then
          echo "GITHUB_RELEASE_TOKEN is missing from Doppler (common/prd) - cannot release." >&2
          exit 1
        fi
`
      : `      - |
        # No doppler capability: the token has to come from the agent
        # environment, the same fleet-side contract the deploy step uses for
        # CLOUDFLARE_*. It needs Contents: read and write on this repository.
        #
        # github-release now declares doppler as a dependency, so a resolved
        # selection never reaches this branch. It is kept as a defensive
        # fallback for callers that bypass dependency resolution rather than
        # deleted, because removing it would turn a token problem into a
        # generation error for them.
        if [ -z "$$GH_TOKEN" ]; then
          echo "GH_TOKEN is not set on the agent - cannot create a tag or a release." >&2
          exit 1
        fi
`;

    // The artifact fetch reads this build through the agent API, so the step
    // needs the token that authorises it and the id of the build it names. They
    // are forwarded by name like every other env var a step needs - a step-level
    // `env:` value would not reach the container.
    const releaseEnv = [
      ...(hasDoppler ? ["DOPPLER_TOKEN"] : ["GH_TOKEN"]),
      ...(releaseArtifactPaths.length
        ? ["BUILDKITE_AGENT_ACCESS_TOKEN", "BUILDKITE_BUILD_ID"]
        : []),
    ];

    // Assemble the payload root from the bytes the build step uploaded, using
    // the same app-owned script and output root the smoke gate used, so the
    // tarball packs the tree the gate executed. Empty for a rust matrix, whose
    // per-target build already produced its root.
    const releaseAssemble = assemblePayload
      ? `        # The build output is a release INPUT (a wheel, a bundle), not a
        # payload root: assemble it with the same script the smoke gate calls,
        # into the same root, so what ships is what the gate ran. The version is
        # the release tag resolved above.
        bash scripts/build-payload.sh "$$VERSION" ${RELEASE_PAYLOAD_ROOT} ${assembledInputDir}
`
      : "";

    steps.push(`
  - label: ":bookmark: Release"
    key: release
${releaseDependencies}    if: build.branch == "main"
${_bkAgents(queue)}    plugins:
${_bkDockerPlugin(image, releaseEnv)}    commands:
${installGh}${releaseToken}      - |
        # The version is a patch bump of the newest existing tag, so there is no
        # version file to keep in sync and no bookkeeping to forget.
        git fetch --quiet --force --tags
        LATEST="$$(git tag --list 'v*' --sort=-v:refname | head -1)"
        if [ -z "$$LATEST" ]; then
          VERSION="0.1.0"
        else
          VERSION="$$(echo "$$LATEST" | sed -e 's/^v//' | awk -F. '{printf "%d.%d.%d", $$1, $$2, $$3 + 1}')"
        fi
        TAG="v$$VERSION"
        # Retried or re-run builds must not fail on a tag that already exists.
        if git ls-remote --exit-code --tags origin "refs/tags/$$TAG" >/dev/null 2>&1; then
          echo "$$TAG already exists on origin - nothing to release."
          exit 0
        fi
        echo "$$VERSION" > .release-version
        echo "$$TAG" > .release-tag
      - |
        # The tag is pushed with the release token explicitly, so this does not
        # depend on whatever credentials the agent happened to clone with. The
        # helper keeps the token out of the remote URL, where it would end up in
        # logs and in .git/config.
        TAG="$$(cat .release-tag)"
        git config user.name "genproj-release"
        git config user.email "genproj-release@users.noreply.github.com"
        git config --local credential.helper '!f() { echo username=x-access-token; echo password="$$GH_TOKEN"; }; f'
        git tag -a "$$TAG" -m "Release $$TAG"
        git push origin "refs/tags/$$TAG"
${releaseArtifacts}      - |
        VERSION="$$(cat .release-version)"
        TAG="$$(cat .release-tag)"
${releaseAssemble}        if [ -f scripts/release-artifacts.sh ]; then
          bash scripts/release-artifacts.sh "$$VERSION"
        else
          echo "No scripts/release-artifacts.sh - releasing notes only."
        fi
        # Uploaded in the create call so the release is never briefly visible
        # without its assets - a launcher reading releases/latest/download/...
        # must not race the upload.
        if [ -n "$$(ls -A release)" ]; then
          gh release create "$$TAG" --title "$$TAG" ${releaseFlags} release/*
        else
          gh release create "$$TAG" --title "$$TAG" ${releaseFlags}
        fi`);
  }

  return {
    buildkiteQueue: queue,
    buildkiteImage: image,
    buildkiteLanguage: language,
    // Each block starts with a newline so they concatenate cleanly; the
    // leading one is dropped because the template already ends its `steps:`
    // line. (Prettier strips a blank line there, and the generated project
    // lints itself with `prettier --check`.)
    buildkiteSteps: steps.join("").replace(/^\n/, ""),
  };
}

/**
 * Builds the template data for the generated project's release documents —
 * `RELEASING.md` and `.github/release.yml`.
 *
 * There is no GitHub Actions workflow: the release is a Buildkite step (see
 * `getBuildkiteTemplateData`), so Buildkite stays the only validator and the
 * tag is only ever created for a commit that passed build and test in the same
 * build. The tag prefix is fixed at `v`; the notes and publish behaviour is
 * fixed too, so nothing here is configurable.
 *
 * @param {Object} context - Template context (capabilities, configuration)
 * @returns {Object} GitHub Release template data
 */
function getGithubReleaseTemplateData(context) {
  const config = context.configuration?.["github-release"] || {};
  const targets = Array.isArray(config.targets) ? config.targets : [];
  // A single, genuinely platform-specific artifact: `dist/` is packed under this
  // label rather than under the universal key. Empty means the payload is not
  // architecture-specific and `any` is the honest label. See
  // validateReleaseTargets for why this and `targets` are mutually exclusive.
  const singleTarget =
    typeof config.target === "string" ? config.target.trim() : "";
  return {
    githubReleaseTargets: targets,
    // The per-target loop in release-artifacts.sh iterates this list, so it is
    // rendered as a shell word list (empty when no targets are declared).
    githubReleaseTargetsJoined: targets.join(" "),
    // The key `dist/` is packed under: the declared single-artifact label when
    // there is one, otherwise the universal key (see target-labels.js
    // UNIVERSAL_TARGET) for a payload that is not architecture-specific.
    githubReleaseDistTarget: singleTarget || UNIVERSAL_TARGET,
    // The universal key, kept for the readme and any template that has to name
    // the fallback itself rather than the label in force.
    githubReleaseUniversalTarget: UNIVERSAL_TARGET,
    // Notes are always generated from the release's merged pull requests and
    // classified by .github/release.yml; that is not configurable.
    githubReleaseNotesSource:
      "Generated by GitHub from the pull requests in the release, classified by `.github/release.yml` (`--generate-notes`).",
  };
}

/**
 * The template data for the launcher, `scripts/fetch-launch.sh`.
 *
 * The launcher is a shell script, so the one thing that would otherwise be
 * duplicated - the `uname` -> candidate-label table - is *rendered* here from
 * `target-labels.js`, the same module the pipeline builds its targets from. A
 * shell script cannot import it, but it can be generated from it, which is the
 * structural version of the same guarantee: one table, two readers.
 *
 * @param {Object} context - Template context (capabilities, configuration)
 * @returns {Object} Launcher template data
 */
function getFetchLaunchTemplateData(context) {
  const projectName = context.projectName || context.name || "my-project";
  const owner = context.registryNamespace || "<owner>";
  // These three were configuration knobs until nothing had ever varied them:
  // the launcher is always `bin/<project name>`, the prefix is always the
  // project's directory, and the env file is always the one XDG config path
  // beside the XDG data directory the launcher installs into. A knob every
  // project leaves at the default is only a surface that can be set wrong, so
  // they are derived here instead of published, and can be re-added when a
  // project needs one.
  const launcherName = projectName;
  const prefix = projectName;
  // The env file is sourced (with set -a) before the payload starts, so
  // host-local configuration reaches an app fetched from GitHub. Sourcing it
  // is optional, so a host that has never created the file behaves exactly as
  // before.
  const envFile = `$HOME/.config/${projectName}/env`;
  const candidates = Object.entries(UNAME_CANDIDATES)
    .flatMap(([osName, arches]) =>
      Object.entries(arches).map(
        ([machine, labels]) =>
          `    ${osName}/${machine}) echo "${[...labels, UNIVERSAL_TARGET].join(" ")}" ;;`,
      ),
    )
    .join("\n");

  return {
    fetchLaunchLauncherName: launcherName,
    fetchLaunchPrefix: prefix,
    fetchLaunchEnvFile: envFile,
    fetchLaunchEnvFileDescription: `\`${envFile}\``,
    fetchLaunchManifestUrl: `https://github.com/${owner}/${projectName}/releases/latest/download/manifest.json`,
    // The launcher is published as a release asset beside the payloads (see
    // scripts/release-artifacts.sh) and advertised in the manifest, so the cold
    // start is the same file every later run maintains.
    fetchLaunchLauncherUrl: `https://github.com/${owner}/${projectName}/releases/latest/download/fetch-launch.sh`,
    fetchLaunchCandidates: candidates,
    fetchLaunchUniversalTarget: UNIVERSAL_TARGET,
  };
}

/**
 * The template data for `scripts/agent-dev.sh` — the container's own a2a-goose
 * agent.
 *
 * The agent is named `<repo>-dev` and registered under that name, so a start
 * reclaims a stale row by name rather than adding a second agent. The values
 * here are the ones the shell template cannot derive for itself: the fixed
 * names, the workspace path, and the release repo the launcher fetches from.
 *
 * Nothing here is configurable. The `-dev` suffix and the card address are
 * fixed/runtime concerns, and the LiteLLM base URL is deployment-specific, so
 * the rendered script reads it from Doppler (`LITELLM_BASE_URL`) at start time
 * rather than baking one in at generation time.
 *
 * @param {Object} context - Generation context (configuration, projectName, name)
 * @returns {Object} Template data for scripts/agent-dev.sh
 */
function getContainerAgentTemplateData(context) {
  const projectName = context.projectName || context.name || "my-project";
  const agentName = `${projectName}-dev`;
  const workspacePath = `/workspaces/${projectName}`;
  const repoSlug = "nickbrett1/a2a-goose";

  // The snippet a reader pastes into .devcontainer/post-start-setup.sh to have
  // the agent come up with the container. It is idempotent and fails open, so
  // `|| true` is the whole of the error handling.
  const postStartHook = [
    `if [ -x "${workspacePath}/scripts/agent-dev.sh" ]; then`,
    `  "${workspacePath}/scripts/agent-dev.sh" start >/dev/null 2>&1 || true`,
    `fi`,
  ].join("\n");

  return {
    containerAgentProjectName: projectName,
    containerAgentName: agentName,
    containerAgentWorkspacePath: workspacePath,
    containerAgentRepoSlug: repoSlug,
    containerAgentPostStartHook: postStartHook,
  };
}

function getDependabotTemplateData(context) {
  const config = context.configuration?.dependabot || {};
  const interval = config.updateSchedule || "weekly";
  // Grouped updates are the default (opt out with
  // dependabot.groupUpdates = false): one pipeline per dependency is the
  // expensive shape on self-hosted CI.
  const groups = (isNpm = false) =>
    config.groupUpdates === false ? "" : _dependabotGroups(isNpm);

  const updates = [
    `
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "${interval}"
    rebase-strategy: "auto"${groups()}`,
  ];

  // Always add GitHub Actions

  if (context.capabilities.includes("devcontainer-node")) {
    updates.push(`
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "${interval}"
    rebase-strategy: "auto"${groups(true)}`);
  }

  if (context.capabilities.some((c) => c.startsWith("devcontainer-python"))) {
    updates.push(`
  - package-ecosystem: "pip"
    directory: "/"
    schedule:
      interval: "${interval}"
    rebase-strategy: "auto"${groups()}`);
  }

  // Java support
  if (context.capabilities.some((c) => c.startsWith("devcontainer-java"))) {
    updates.push(`
  - package-ecosystem: "maven"
    directory: "/"
    schedule:
      interval: "${interval}"
    rebase-strategy: "auto"${groups()}`);
  }

  // Rust support (devcontainer-rust or cloudflare-wrangler with workerType: rust)
  const hasRustDevcontainer = context.capabilities.some((c) =>
    c.startsWith("devcontainer-rust"),
  );
  const hasRustWorker =
    context.capabilities.includes("cloudflare-wrangler") &&
    context.configuration?.["cloudflare-wrangler"]?.workerType === "rust";
  if (hasRustDevcontainer || hasRustWorker) {
    const directory = hasRustWorker ? "/worker" : "/";
    updates.push(`
  - package-ecosystem: "cargo"
    directory: "${directory}"
    schedule:
      interval: "${interval}"
    rebase-strategy: "auto"${groups()}`);
  }

  return {
    dependabotUpdates: updates.join(""),
  };
}

export { getGooseMcpConfig, assertNoGooseEnvVarReferences };

export function getCapabilityTemplateData(capabilityId, context) {
  const dataGenerators = {
    "coding-agents": getCodingAgentsTemplateData,
    sonarcloud: getSonarCloudTemplateData,
    circleci: getCircleCiTemplateData,
    buildkite: getBuildkiteTemplateData,
    "github-release": getGithubReleaseTemplateData,
    "fetch-launch": getFetchLaunchTemplateData,
    "container-agent": getContainerAgentTemplateData,
    dependabot: getDependabotTemplateData,
    micropython: (ctx) => {
      // Defaults are applied here (not in collectSingleTemplateFile, which
      // passes the raw config) so a project that never opened the capability's
      // config form still renders a working glob and package list.
      const cfg = ctx.configuration?.micropython || {};
      const packages =
        Array.isArray(cfg.packages) && cfg.packages.length > 0
          ? cfg.packages
          : ["mpremote"];
      return {
        micropythonDeviceGlob: cfg.deviceGlob || "/dev/tty.usbmodem*",
        micropythonPackages: packages.join(" "),
      };
    },
    "docker-container": getDockerContainerTemplateData,
    doppler: (ctx) => {
      const target = resolveDopplerTarget(ctx);
      return { dopplerProject: target.project, dopplerConfig: target.config };
    },
  };

  const generator = dataGenerators[capabilityId];
  return generator ? generator(context) : {};
}

export function applyDefaults(capability, config) {
  const finalConfig = { ...config };
  if (capability?.configurationSchema?.properties) {
    for (const [key, property] of Object.entries(
      capability.configurationSchema.properties,
    )) {
      if (finalConfig[key] === undefined && property.default !== undefined) {
        finalConfig[key] = property.default;
      }
    }
  }
  return finalConfig;
}
