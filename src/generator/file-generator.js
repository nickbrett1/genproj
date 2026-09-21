import { templateFiles } from "./templates.generated.js";
import { capabilityTemplates } from "./capability-templates.js";
const devcontainerJavaDockerfile =
  templateFiles["devcontainer-java-dockerfile.template"];
const devcontainerJavaJson = templateFiles["devcontainer-java-json.template"];
const devcontainerNodeDockerfile =
  templateFiles["devcontainer-node-dockerfile.template"];
const devcontainerNodeJson = templateFiles["devcontainer-node-json.template"];
const devcontainerP10kZshFull =
  templateFiles["devcontainer-p10k-zsh-full.template"];
const devcontainerP10kZsh = templateFiles["devcontainer-p10k-zsh.template"];
const devcontainerPostCreateSetupSh =
  templateFiles["devcontainer-post-create-setup-sh.template"];
const devcontainerPostStartSetupSh =
  templateFiles["devcontainer-post-start-setup-sh.template"];
const devcontainerPythonDockerfile =
  templateFiles["devcontainer-python-dockerfile.template"];
const devcontainerPythonJson =
  templateFiles["devcontainer-python-json.template"];
const devcontainerRustDockerfile =
  templateFiles["devcontainer-rust-dockerfile.template"];
const devcontainerRustJson = templateFiles["devcontainer-rust-json.template"];
const devcontainerZshrcFull = templateFiles["devcontainer-zshrc-full.template"];
const devcontainerZshrcGooseWt =
  templateFiles["devcontainer-zshrc-goose-wt.template"];
const devcontainerZshrc = templateFiles["devcontainer-zshrc.template"];
const devcontainerTmuxConf = templateFiles["devcontainer-tmux-conf.template"];
const dopplerYaml = templateFiles["doppler-yaml.template"];
const playwrightConfig = templateFiles["playwright-config.template"];
const lighthouseCiConfig = templateFiles["lighthouse-ci-config.template"];
const circleCiConfig = templateFiles["circleci-config.template"];
const buildkitePipeline = templateFiles["buildkite-pipeline.template"];
const buildkiteReadme = templateFiles["buildkite-readme.template"];
const githubReleaseNotes = templateFiles["github-release-notes.template"];
const githubReleaseReadme = templateFiles["github-release-readme.template"];
const githubReleaseArtifacts =
  templateFiles["github-release-artifacts.template"];
const githubReleaseSmokeLaunch =
  templateFiles["github-release-smoke-launch.template"];
const githubReleaseBuildPayload =
  templateFiles["scripts-build-payload.sh.template"];
const dockerfileTemplate = templateFiles["dockerfile.template"];
const dockerignoreTemplate = templateFiles["dockerignore.template"];
const dockerComposeTemplate = templateFiles["docker-compose.template"];
const deployReadmeTemplate = templateFiles["deploy-readme.template"];
const homepageServicesTemplate = templateFiles["homepage-services.template"];
const envExampleTemplate = templateFiles["env-example.template"];
const sonarProjectProperties = templateFiles[".sonarcloud.properties.template"];
const mcpConfigJson = templateFiles["mcp-config-json.template"];
const mcpSseProxyJs = templateFiles["mcp-sse-proxy-js.template"];
const mcpStreamableHttpProxyJs =
  templateFiles["mcp-streamable-http-proxy-js.template"];
const packageJsonTemplate = templateFiles["package-json.template"];
const wranglerJsonc = templateFiles["wrangler.jsonc.template"];
const wranglerTemplateJsonc = templateFiles["wrangler.template.jsonc.template"];
const scriptsFetchLaunchSh = templateFiles["scripts-fetch-launch.sh.template"];
const fetchLaunchReadme = templateFiles["fetch-launch-readme.template"];
const scriptsCloudLoginSh = templateFiles["scripts-cloud-login.sh.template"];
const scriptsRunWranglerDevelopmentSh =
  templateFiles["scripts-run-wrangler-dev-sh.template"];
const scriptsSetupWranglerConfigSh =
  templateFiles["scripts-setup-wrangler-config.sh.template"];
const scriptsSyncDopplerSecretsSh =
  templateFiles["scripts-sync-doppler-secrets-sh.template"];
const scriptsAgentDevSh = templateFiles["scripts-agent-dev.sh.template"];
const eslintConfigJs = templateFiles["eslint-config-js.template"];
const gitignoreTemplate = templateFiles["gitignore.template"];
const dependabotConfig = templateFiles["dependabot.yml.template"];
const dependabotAutoMerge = templateFiles["dependabot-auto-merge.yml.template"];
const vscodeTasksJson = templateFiles["vscode-tasks-json.template"];
const vscodeSettingsJson = templateFiles["vscode-settings-json.template"];
const cloudflareWorkerIndexJs =
  templateFiles["cloudflare-worker-index-js.template"];
const svelteAppHtml = templateFiles["svelte-app-html.template"];
const sveltePageSvelte = templateFiles["svelte-page-svelte.template"];
const svelteConfigJs = templateFiles["svelte-config-js.template"];
const svelteViteConfigJs = templateFiles["svelte-vite-config-js.template"];
const svelteIndexHtml = templateFiles["svelte-index-html.template"];
const svelteMainJs = templateFiles["svelte-main-js.template"];
const svelteAppSvelte = templateFiles["svelte-app-svelte.template"];
const svelteFrontendConfigJs =
  templateFiles["svelte-frontend-config-js.template"];
const svelteFrontendViteConfigJs =
  templateFiles["svelte-frontend-vite-config-js.template"];
const sveltePackageJson = templateFiles["svelte-package-json.template"];
const docsifyIndex = templateFiles["docsify-index.template"];
const docsifyReadme = templateFiles["docsify-readme.template"];
const devcontainerServeDocumentsCjs =
  templateFiles["devcontainer-serve-docs-cjs.template"];
const scriptsFindBoardSh = templateFiles["scripts-find-board-sh.template"];
const devcontainerPostCreateMicropythonSh =
  templateFiles["devcontainer-post-create-micropython-sh.template"];
// webapp/src/lib/utils/file-generator.js

import { capabilities } from "../catalog/index.js";
import {
  getCapabilityTemplateData,
  applyDefaults,
  resolveProjectLanguage,
  cargoPackageName,
  primaryDevcontainerCapabilityId,
  resolveDopplerTarget,
  toPythonPackageName,
  toDistributionName,
  getGooseMcpConfig,
  assertNoGooseEnvVarReferences,
  isMicropython,
  ruffCheckCommand,
  resolveMicropythonChip,
  resolveSvelteDirectory,
  resolveSvelteOutputDirectory,
  hasFrontend,
  frontendCapabilityId,
  capabilityProvides,
  canonicalCapabilityOrder,
  servingHarnessSpec,
} from "./capability-template-utils.js";
import {
  validateFetchLaunch,
  validatePrimaryLanguage,
  validateReleaseTargets,
  validateRequiredAny,
} from "./project-validation.js";

/**
 * The directory prefix (`web/`) that Svelte-owned files are emitted under, or
 * `""` when the app owns the repository root (the node-primary case). Derived
 * from {@link resolveSvelteDirectory} so the scaffold path, the Dockerfile copy
 * and the CI build all agree on one location.
 * @param {Object} context - Generation context
 * @returns {string} A trailing-slash prefix, or ""
 */
function sveltePrefix(context) {
  const directory = resolveSvelteDirectory(context);
  return directory ? `${directory}/` : "";
}

// 2.2: health endpoint emitted for docker-container SvelteKit projects.
// Returns 200 {"status":"ok"} (a JSON object, which Homepage's customapi widget
// requires - and whose `status` field the generated widget mapping reads) so the
// container HEALTHCHECK and Homepage widget work without any additional tooling.
export const HEALTH_ROUTE_SOURCE = `// Health check endpoint used by the container HEALTHCHECK and Homepage widget.
// The body is JSON, not a bare "ok": Homepage's \`customapi\` widget parses it
// as JSON, so a plain-text reply makes the dashboard tile error.
export function GET() {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
`;

export const AGY_DEV_ALIAS = `# A robust function to run Antigravity with Doppler, ensuring no stale SonarQube containers exist.
# Secrets are loaded from the 'common' project first, then the current project's secrets layer on
# top (project-specific secrets take precedence over common ones).
agy-dev() {
  # Only check for Docker containers if Docker is installed
  if command -v docker &> /dev/null; then
    # Define the name of the container to check for
    local container_name="sonarqube-mcp-server"

    # Find the container ID using Docker's filter. The -q flag means "quiet" (ID only).
    local container_id=$(docker ps -a -q --filter "name=\${container_name}")

    # Check if the container_id variable is not empty
    if [ -n "$container_id" ]; then
      echo "Found stale container '\${container_name}' ($container_id). Removing it..."
      # Force remove the container. The -f flag stops it if it's running.
      docker rm -f "$container_id"
    fi
  fi

  echo "Starting Antigravity with Doppler (common + {{dopplerProject}})..."
  # Load common secrets first, then layer project-specific secrets on top.
  # --forward-signals ensures SIGINT/SIGTERM are correctly passed through to agy.
  doppler run --project common --config dev -- doppler run --forward-signals --project {{dopplerProject}} --config dev -- agy "$@"
}`;

export const GIT_SAFE_DIR_SCRIPT = `
echo "INFO: Configuring git safe directory..."
git config --global --add safe.directory /workspaces/{{projectName}}`;

export const GIT_GITHUB_AUTH_SETUP_SCRIPT = `
echo "INFO: Configuring GitHub auth over SSH (no PAT)..."
# genproj-github-auth (SSH-first): GitHub remotes authenticate via an SSH key
# supplied by the host bind-mount (~/.ssh) or the forwarded SSH agent. No PAT
# is ever written to ~/.gitconfig or remote URLs. Defaults to SSH; fails loud
# with guidance if no working key/agent is found. Idempotent: re-runs must not
# duplicate or clobber the existing rewrite.

# --- 1. Make a usable key for the container user ---------------------------
# The host ~/.ssh is bind-mounted at $HOME/.ssh. Those files keep the host uid
# (macOS 501), which OpenSSH (running as the container uid, typically 1000)
# refuses to use. We never chown the mount (that mutates the host file).
# Preferred: forward the SSH agent (zero keys on disk). Fallback: copy the
# mounted key into a container-owned dir with mode 600.
KEY_COPIED=""
if [ -n "\${SSH_AUTH_SOCK:-}" ] && command -v ssh-add &> /dev/null && ssh-add -l >/dev/null 2>&1; then
    echo "INFO: GitHub auth via forwarded SSH agent (\${SSH_AUTH_SOCK})."
else
    mkdir -p "$HOME/.genproj-ssh" && chmod 700 "$HOME/.genproj-ssh"
    for KEY in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_rsa"; do
        if [ -r "$KEY" ]; then
            DEST="$HOME/.genproj-ssh/$(basename "$KEY")"
            cp "$KEY" "$DEST"
            chmod 600 "$DEST"
            KEY_COPIED="$DEST"
            echo "INFO: Copied host-mounted key $KEY into $DEST."
            break
        fi
    done
fi

# --- 2. Point git's ssh at the copied key (if any) -------------------------
# Persisted in ~/.gitconfig (no secret involved), so it survives re-runs.
if [ -n "$KEY_COPIED" ]; then
    git config --global core.sshCommand "ssh -i $KEY_COPIED -o IdentitiesOnly=yes"
fi

# --- 3. Idempotent SSH insteadOf rewrite for github.com ---------------------
if git config --global --get-regexp '^url\\.git@github\\.com:.*\\.insteadof' >/dev/null 2>&1; then
    echo "INFO: GitHub SSH rewrite already configured; leaving in place."
elif ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -T git@github.com 2>&1 | grep -qi "successfully authenticated"; then
    git config --global url."git@github.com:".insteadOf "https://github.com/"
    echo "INFO: GitHub remotes now use SSH (git@github.com:)."
else
    echo "WARN: No working SSH key/agent found for github.com."
    echo "      Add an SSH public key at https://github.com/settings/keys,"
    echo "      load it on the host (ssh-add --apple-use-keychain), and"
    echo "      rebuild/re-run this setup. HTTPS push/pull will use the"
    echo "      default credential helper until then."
fi
`;

export const GOOSE_ALIAS = `# A robust function to run goose with Doppler, ensuring all secrets are available.
# Secrets are loaded from the 'common' project first, then the 'goose' project's secrets layer on
# top (project-specific secrets take precedence over common ones).
# Overrides the bare \`goose\` binary (which can't work standalone: it needs Doppler secrets).
goose() {
  echo "Starting goose with Doppler (common + goose)..."
  # Doppler auth pre-flight: fail with actionable guidance instead of the cryptic
  # "Doppler Error: you must provide a token" that 'doppler run' emits when the
  # container has no Doppler auth (fresh devcontainer / codespace).
  if ! command -v doppler &> /dev/null; then
    echo "❌ Doppler CLI not found - goose needs Doppler secrets to start."
    echo "   Finish the devcontainer post-create setup (it installs the CLI), then try again."
    return 127
  fi
  if ! doppler whoami &> /dev/null 2>&1; then
    echo "❌ Not authenticated with Doppler - goose needs Doppler secrets to start."
    echo "   Run: bash scripts/cloud_login.sh   (interactive browser login)"
    echo "   Or set a service token:  export DOPPLER_TOKEN=dp.st.<token>"
    return 1
  fi
  # Load common secrets first, then layer goose project secrets on top.
  # Uses 'prd' config for the goose project to pick up LITELLM endpoint env vars.
  # --forward-signals ensures SIGINT/SIGTERM are correctly passed through to goose.
  # Routes through _wt_ensure so goose runs in this shell's feature worktree.
  _wt_ensure doppler run --project common --config dev -- doppler run --forward-signals --project goose --config prd -- goose "$@"
}`;

/**
 * Doppler setup block for .devcontainer/post-create-setup.sh
 *
 * - ensures ~/.doppler perms and the CLI is on PATH (round-5 fallback install)
 * - genproj-doppler-context-pin (memo Gi8CN7XqpH6CxFAc2YUJsK): Doppler's
 *   precedence is env > doppler.yaml > ~/.doppler. Ambient
 *   DOPPLER_PROJECT/DOPPLER_CONFIG/DOPPLER_ENVIRONMENT from the session that
 *   launches the devcontainer (e.g. an agent runtime) leak in and silently
 *   redirect every `doppler` command at the wrong project. Pin this repo's
 *   doppler.yaml context in ~/.bashrc + ~/.zshrc so EVERY shell — including
 *   agent-spawned ones that never re-run post-create — resolves the right
 *   project. Must run AFTER the repo .zshrc copy in the template, otherwise
 *   the cp clobbers the appended block.
 * - verifies the resolved project loudly at setup time (never silent).
 */
export function generateDopplerSetupScript(context = {}) {
  // Doppler scaling memo (memos/doppler-scaling): repos default to the
  // shared `common` project (no new project created); projectStrategy: 'new'
  // opts into a dedicated per-app project. The context pin must match the
  // repo's doppler.yaml, so it follows the resolved target.
  const { project: projectName, config } = resolveDopplerTarget(context);

  const rcBlock = `# genproj-doppler-context-pin: this repo's doppler.yaml context wins over ambient env
export DOPPLER_PROJECT=${projectName}
export DOPPLER_CONFIG=${config}
unset DOPPLER_ENVIRONMENT 2>/dev/null || true
`;

  return `echo "INFO: Ensuring doppler directory permissions..."
mkdir -p "$USER_HOME_DIR/.doppler"
sudo chown -R "$CURRENT_USER:$CURRENT_USER" "$USER_HOME_DIR/.doppler"
# Round-5 (memo genproj-fixes-round5): guarantee the CLI is on PATH. The
# Dockerfile installs it for fresh projects, but a regenerated project whose
# Dockerfile was preserved (round-3 idempotent overwrite) needs the fallback.
# (A devcontainer feature was tried first but ghcr.io/devcontainers-contrib
# features are no longer reliably pullable — 'denied'.)
if ! command -v doppler &> /dev/null; then
    echo "INFO: Installing Doppler CLI (fallback)..."
    (curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh || wget -t 3 -qO- https://cli.doppler.com/install.sh) | sudo sh
fi
# genproj-doppler-context-pin (memo Gi8CN7XqpH6CxFAc2YUJsK): ambient
# DOPPLER_PROJECT/DOPPLER_CONFIG/DOPPLER_ENVIRONMENT from the launching session
# override doppler.yaml (env > yaml) and silently point every 'doppler' command
# at the wrong project. Pin the repo context in ~/.bashrc + ~/.zshrc so new
# shells (including agent-spawned ones) inherit it. The marker keeps the
# append idempotent across post-create re-runs.
DOPPLER_RC_MARKER='# genproj-doppler-context-pin'
if ! grep -qF "$DOPPLER_RC_MARKER" "$HOME/.bashrc" 2>/dev/null; then
    cat >> "$HOME/.bashrc" <<'EOF'
${rcBlock}
EOF
    echo "INFO: Pinned doppler context (${projectName}/${config}) in ~/.bashrc"
fi
if ! grep -qF "$DOPPLER_RC_MARKER" "$HOME/.zshrc" 2>/dev/null; then
    cat >> "$HOME/.zshrc" <<'EOF'
${rcBlock}
EOF
    echo "INFO: Pinned doppler context (${projectName}/${config}) in ~/.zshrc"
fi
# Apply to this shell too, then verify resolution is never silently wrong.
export DOPPLER_PROJECT=${projectName}
export DOPPLER_CONFIG=${config}
unset DOPPLER_ENVIRONMENT 2>/dev/null || true
if command -v doppler &> /dev/null && doppler whoami &> /dev/null 2>&1; then
    RESOLVED_PROJECT="$(doppler run -- printenv DOPPLER_PROJECT 2>/dev/null | tail -n 1)"
    if [ -n "$RESOLVED_PROJECT" ] && [ "$RESOLVED_PROJECT" != "${projectName}" ]; then
        echo "WARNING: 'doppler run' resolves project '$RESOLVED_PROJECT', but doppler.yaml"
        echo "         declares '${projectName}'. An ambient DOPPLER_* export is overriding"
        echo "         the repo context. Run: unset DOPPLER_PROJECT DOPPLER_CONFIG DOPPLER_ENVIRONMENT"
        echo "         then 'doppler setup --no-interactive --project ${projectName} --config ${config}'."
    elif [ -z "$RESOLVED_PROJECT" ]; then
        echo "WARNING: could not resolve the doppler project via 'doppler run'. If"
        echo "         'doppler projects get ${projectName}' 404s, create it and run"
        echo "         'doppler setup --no-interactive --project ${projectName} --config ${config}'."
    else
        echo "INFO: doppler context verified: ${projectName}/${config}"
    fi
fi
`;
}

/**
 * Generates the goose setup script for post-create-setup.sh.
 *
 * Migration (memo goose-mcp-groups-migration §2/§4/§5 + handoff-goose-devcontainer-genproj):
 * generated devcontainers NO LONGER bind-mount the host ~/.config/goose (see
 * getDevcontainerJsonExtras). Instead genproj WRITES an **extensions-only**
 * `$HOME/.config/goose/config.yaml` when none exists: a single auth-off
 * `mcphub-dev` streamable_http extension (MCPHub `dev` group) plus only the
 * genuinely-local/remote non-hub exceptions (xcode-native, svelte). No
 * `provider:` block is emitted — the provider resolves from the Doppler env at
 * runtime (GOOSE_ALIAS runs goose under `doppler run`). Recipes are still
 * bootstrapped (recipes/ dir is additive).
 *
 * An existing config.yaml is MERGED into, never replaced: each managed
 * extension that is missing is inserted under the existing top-level
 * `extensions:` key, and the user's own entries and top-level settings are
 * left byte-for-byte alone. A config that exists *without* an `extensions:`
 * section — exactly what goose writes for itself
 * (`GOOSE_TELEMETRY_ENABLED: true`) the first time it runs — gets the managed
 * section added, so the project's extensions are installed even when goose
 * beat this script to the file. The only case genproj refuses to touch is an
 * `extensions:` section laid out with an indent other than 2 spaces (or an
 * inline `extensions: {...}`), where inserting a 2-space block would produce
 * invalid YAML: there it prints the block for the user to merge by hand.
 * See the comment on the write for why the merge (rather than write-if-absent)
 * is not hypothetical.
 *
 * @returns {string} The setup script content
 */
export function generateGooseSetupScript(context = {}) {
  const gooseMcp = getGooseMcpConfig(context);
  const fragments = [
    { key: "mcphub-dev", block: gooseMcp.mcphubDevGooseConfig },
    // sonarqube is kept as an exception (doppler-wrapped stdio): the MCPHub
    // `dev` group does NOT carry sonarqube, so a sonarcloud project must still
    // get its own extension or the tool would be silently lost.
    { key: "sonarqube", block: gooseMcp.sonarQubeGooseConfig },
    { key: "xcode-native", block: gooseMcp.xcodeNativeGooseConfig },
    { key: "svelte", block: gooseMcp.svelteGooseConfig },
  ].filter((f) => f.block);

  // Regression guard (genproj-goose-env-refs): goose does not expand
  // ${VAR}/$VAR in stdio extension env maps — the literal text would be used
  // as the token (→ MCP 401). Fail generation loudly rather than shipping a
  // broken config. Only the YAML blocks are scanned; the shell scaffolding
  // below legitimately uses $HOME/${key} etc.
  for (const f of fragments) {
    assertNoGooseEnvVarReferences(f.block, f.key);
  }

  // Full extensions-only config body (indented under top-level `extensions:`).
  // mcphub-dev is the default project toolset; exceptions keep their own key.
  const extensionBody = fragments
    .map((f) => f.block)
    .join("\n")
    .replace(/^\n/, "");
  const configYaml = `extensions:
${extensionBody}\n`;

  // The heredocs are quoted (`'GOOSECFGEOF'`) so nothing is shell-expanded; the
  // whole config is produced here in JS so the YAML is flush-left and byte-exact.
  // Provider intentionally omitted (Doppler env).
  //
  // This is NOT "write-if-absent" any more. goose creates a default
  // `~/.config/goose/config.yaml` (telemetry only) the first time it runs, and
  // in a generated container that can happen before this script reaches here:
  // post-create is long, the container is usable the moment it is up, and a
  // person running `goose` in a terminal while it finishes wins the race. The
  // old `if [ -f "$CONFIG" ]; then keep` then skipped the project config
  // forever — measured on a2a-goose, 2026-09-20: `goose` ran at 02:08:07, the
  // 30-byte telemetry config was born at 02:08:16, this block ran after the
  // git-auth step (~02:08:30) and found it, so the container had no
  // `mcphub-dev` and no way to get one. So, in order:
  //   - absent                         -> write the whole extensions-only config;
  //   - exists, every managed key there-> already ours, leave it (idempotent);
  //   - exists, no `extensions:`       -> goose's own default; append the section;
  //   - exists with `extensions:`      -> MERGE: insert only the missing keys
  //                                       directly under it, byte-for-byte
  //                                       preserving the user's own entries;
  //   - `extensions:` odd (inline, or an indent other than 2 spaces) -> print
  //                                       the block; do not risk invalid YAML.
  // Inserting into a section is safe because every managed fragment is a
  // self-contained `  <key>:\n    ...` chunk with no keys in common with a
  // normal config; nothing existing is ever rewritten or removed.
  const managedKeys = fragments.map((f) => f.key).join(" ");
  const gooseConfigWrite = `
CONFIG="$HOME/.config/goose/config.yaml"
mkdir -p "$HOME/.config/goose"

# The managed fragments, written once into a scratch file. The merge below
# picks the subset the config is missing. A fragment starts at '  <key>:' —
# exactly two spaces, the child indent under a top-level \`extensions:\`.
MANAGED_BODY="$(mktemp)"
cat > "$MANAGED_BODY" <<'GOOSECFGBODYEOF'
${extensionBody}
GOOSECFGBODYEOF

if [ ! -f "$CONFIG" ]; then
    echo "INFO: No goose config found - writing project goose config (extensions only; provider resolves from Doppler env at runtime)."
    cat > "$CONFIG" <<'GOOSECFGEOF'
${configYaml}GOOSECFGEOF
    echo "INFO: Wrote project goose config (MCPHub dev group + local/remote exceptions)."
else
    MISSING=""
    for KEY in ${managedKeys}; do
        grep -q "^[[:space:]]*$KEY:" "$CONFIG" || MISSING="$MISSING $KEY"
    done

    MISSING_BODY="$(mktemp)"
    awk -v missing=" $MISSING " '
        /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
            k = $0
            sub(/^ +/, "", k)
            sub(/:.*/, "", k)
            keep = (index(missing, " " k " ") > 0)
        }
        keep { print }
    ' "$MANAGED_BODY" > "$MISSING_BODY"

    if [ -z "$MISSING" ] || [ ! -s "$MISSING_BODY" ]; then
        echo "INFO: Project goose extensions already present in $CONFIG - leaving it untouched."
    elif grep -q '^extensions:' "$CONFIG" && ! grep -q '^extensions:[[:space:]]*$' "$CONFIG"; then
        echo "WARN: $CONFIG declares 'extensions:' inline; genproj will not merge into that form."
        echo "WARN: add the entry below by hand:"
        sed 's/^/WARN:   /' "$MISSING_BODY"
    elif ! grep -q '^extensions:[[:space:]]*$' "$CONFIG"; then
        echo "INFO: $CONFIG exists without an extensions section (goose's own default) - adding the project extensions."
        # Nothing to merge with, so a fresh section is safe and idempotent:
        # the next run finds every managed key already present and stops here.
        printf '\\n' >> "$CONFIG"
        {
            printf 'extensions:\\n'
            cat "$MISSING_BODY"
        } >> "$CONFIG"
        echo "INFO: Added project goose extensions to $CONFIG."
    else
        # Merge under the existing top-level extensions: key. The indentation
        # of its first child tells us whether a 2-space block can be spliced in.
        # No child (empty/EOF) or 0 spaces (null section) are fine — our block
        # becomes the section's content; 4+ spaces would need re-indenting, so
        # that (and only that) is left to the user.
        CHILD_INDENT="$(awk '
            /^extensions:[[:space:]]*$/ { found = 1; next }
            found && (/^[[:space:]]*$/ || /^[[:space:]]*#/) { next }
            found { match($0, /^ */); print RLENGTH; exit }
        ' "$CONFIG")"
        if [ -n "$CHILD_INDENT" ] && [ "$CHILD_INDENT" != "2" ]; then
            echo "WARN: $CONFIG has an extensions: section indented by $CHILD_INDENT spaces (not 2)."
            echo "WARN: add the entry below by hand so the YAML stays valid:"
            sed 's/^/WARN:   /' "$MISSING_BODY"
        else
            MERGED="$(mktemp)"
            awk -v body="$MISSING_BODY" '
                /^extensions:[[:space:]]*$/ && !done {
                    print
                    while ((getline line < body) > 0) print line
                    close(body)
                    done = 1
                    next
                }
                { print }
            ' "$CONFIG" > "$MERGED"
            cat "$MERGED" > "$CONFIG"
            rm -f "$MERGED"
            echo "INFO: Merged project goose extensions into the existing extensions: section of $CONFIG (added:$MISSING)."
        fi
    fi
    rm -f "$MISSING_BODY"
fi
rm -f "$MANAGED_BODY"
`;

  return `
echo "INFO: Setting up goose configuration and MCP servers..."
${gooseConfigWrite}
echo "INFO: Ensuring goose recipes are available (spec-first development process)..."
RECIPES_DIR="$HOME/.config/goose/recipes"
if [ -d "$RECIPES_DIR/.git" ]; then
    (cd "$RECIPES_DIR" && git pull --ff-only --quiet) \
        || echo "WARN: Could not update goose-recipes (offline or conflict); keeping existing copy."
else
    mkdir -p "$HOME/.config/goose"
    git clone --quiet https://github.com/nickbrett1/goose-recipes.git "$RECIPES_DIR" \
        || echo "WARN: Could not clone goose-recipes; recipes will be unavailable."
fi

echo "INFO: goose configuration complete."
`;
}

export const AGY_SETUP_SCRIPT = String.raw`
echo "INFO: Installing Antigravity CLI and Specify CLI..."
if ! command -v npm &> /dev/null; then
    echo "npm not found. Installing nodejs and npm..."
    sudo apt-get update
    sudo apt-get install -y nodejs npm
fi
sudo npm install -g @specifyapp/cli
curl -fsSL https://antigravity.google/cli/install.sh | bash
echo "INFO: Antigravity CLI and Specify CLI installation complete."

echo "INFO: Initializing Antigravity CLI global settings..."
mkdir -p "$USER_HOME_DIR/.agy"
printf '{\n  "selectedAuthType": "oauth-personal",\n  "general": {\n    "sessionRetention": {\n      "enabled": true,\n      "maxAge": "30d",\n      "warningAcknowledged": true\n    }\n  },\n  "ide": {\n    "hasSeenNudge": true,\n    "enabled": true\n  }\n}\n' > "$USER_HOME_DIR/.agy/settings.json"
sudo chown -R "$CURRENT_USER:$CURRENT_USER" "$USER_HOME_DIR/.agy"`;

export const PLAYWRIGHT_SETUP_SCRIPT = `
echo "INFO: Installing Playwright and its Chromium dependencies..."
npx --yes playwright install --with-deps chromium
echo "INFO: Playwright Chromium installation complete."`;

export const PYTHON_SETUP_SCRIPT = `
# Setup python virtual environment and install dependencies
# (memo: genproj python devcontainer .venv PATH). postCreate runs with the
# workspace as CWD, but cd explicitly so this also works when invoked from
# elsewhere (e.g. a manual re-run after the container restarted in $HOME).
cd "/workspaces/{{projectName}}" 2>/dev/null || true

if [ ! -d ".venv" ]; then
    echo "INFO: Creating Python virtual environment (.venv)..."
    python3 -m venv .venv
fi

if [ -f "requirements.txt" ]; then
    echo "INFO: Installing dependencies from requirements.txt..."
    .venv/bin/pip install -r requirements.txt
elif [ -f "pyproject.toml" ]; then
    echo "INFO: Installing dependencies from pyproject.toml (dev extras)..."
    .venv/bin/pip install -e ".[dev]"
fi

# genproj-python-venv-path: expose .venv/bin on PATH for shells that do NOT
# inherit devcontainer.json remoteEnv (VS Code terminals get PATH from
# remoteEnv; ssh / 'bash -lc' / tmux panes started outside VS Code do not).
# The marker comment keeps this idempotent across post-create re-runs.
VENV_RC_MARKER='# genproj-python-venv-path'
if ! grep -qF "$VENV_RC_MARKER" "$HOME/.bashrc" 2>/dev/null; then
    cat >> "$HOME/.bashrc" <<'EOF'
# genproj-python-venv-path: prefer project .venv
if [ -d "/workspaces/{{projectName}}/.venv/bin" ]; then
    export PATH="/workspaces/{{projectName}}/.venv/bin:$PATH"
fi
EOF
    echo "INFO: Added .venv PATH hook to ~/.bashrc"
fi
if ! grep -qF "$VENV_RC_MARKER" "$HOME/.zshrc" 2>/dev/null; then
    cat >> "$HOME/.zshrc" <<'EOF'
# genproj-python-venv-path: prefer project .venv
if [ -d "/workspaces/{{projectName}}/.venv/bin" ]; then
    export PATH="/workspaces/{{projectName}}/.venv/bin:$PATH"
fi
EOF
    echo "INFO: Added .venv PATH hook to ~/.zshrc"
fi
`;

export const NODE_SETUP_SCRIPT = `
# Setup node dependencies and expose node_modules/.bin on PATH
# (memo: genproj node devcontainer .venv PATH — same class of bug as python
# .venv). postCreate runs with the workspace as CWD, but cd explicitly so
# this also works when invoked from elsewhere.
cd "/workspaces/{{projectName}}" 2>/dev/null || true

if [ -f "package.json" ]; then
    # genproj-npm-pin: activate the npm pinned in package.json. npm 10 bundled
    # with Node <24 crashes installing vitest-4 projects ('edgesOut'), and
    # packageManager/corepack alone does NOT switch npm (corepack only shims
    # yarn/pnpm) - so install the pinned version globally, mirroring CI.
    PINNED_NPM="$(node -p "try{require('./package.json').packageManager}catch(e){''}" 2>/dev/null || true)"
    if [ -n "$PINNED_NPM" ]; then
        VERSION="\${PINNED_NPM#npm@}"
        CURRENT="$(npm --version 2>/dev/null || echo '')"
        if [ "$VERSION" != "$CURRENT" ]; then
            echo "INFO: Activating pinned \${PINNED_NPM} (image npm: \${CURRENT:-unknown})..."
            (npm install -g "npm@\${VERSION}" 2>/dev/null || sudo npm install -g "npm@\${VERSION}") || echo "WARN: Could not activate pinned npm \${VERSION}; continuing with $(npm --version 2>/dev/null)"
        fi
    fi
    echo "INFO: Installing dependencies with npm install..."
    npm install
fi

# genproj-node-bin-path: expose node_modules/.bin on PATH for shells that do
# NOT inherit devcontainer.json remoteEnv (VS Code terminals get PATH from
# remoteEnv; ssh / 'bash -lc' / tmux panes started outside VS Code do not).
# The marker comment keeps this idempotent across post-create re-runs.
NODE_BIN_MARKER='# genproj-node-bin-path'
if ! grep -qF "$NODE_BIN_MARKER" "$HOME/.bashrc" 2>/dev/null; then
    cat >> "$HOME/.bashrc" <<'EOF'
# genproj-node-bin-path: prefer project node_modules/.bin
if [ -d "/workspaces/{{projectName}}/node_modules/.bin" ]; then
    export PATH="/workspaces/{{projectName}}/node_modules/.bin:$PATH"
fi
EOF
    echo "INFO: Added node_modules/.bin PATH hook to ~/.bashrc"
fi
if ! grep -qF "$NODE_BIN_MARKER" "$HOME/.zshrc" 2>/dev/null; then
    cat >> "$HOME/.zshrc" <<'EOF'
# genproj-node-bin-path: prefer project node_modules/.bin
if [ -d "/workspaces/{{projectName}}/node_modules/.bin" ]; then
    export PATH="/workspaces/{{projectName}}/node_modules/.bin:$PATH"
fi
EOF
    echo "INFO: Added node_modules/.bin PATH hook to ~/.zshrc"
fi
`;

export const DOPPLER_LOGIN_SCRIPT = `
# Doppler login/setup
if command -v doppler &> /dev/null; then
  if doppler whoami &> /dev/null 2>&1; then
    echo "✅ Already logged in to Doppler."
  else
    echo "INFO: Logging into Doppler (browser flow)..."
    echo "      If a browser does not open, copy the URL and auth code printed above into"
    echo "      your browser to complete the login, then return here."
    if doppler login --no-check-version --yes; then
      echo "✅ Doppler login successful."
      if doppler setup --no-interactive --project {{dopplerProject}} --config dev; then
        echo "✅ Doppler project {{dopplerProject}}/dev configured."
      else
        echo "WARN: doppler setup failed for {{dopplerProject}}/dev - the project may not"
        echo "      exist yet. Create it at https://dashboard.doppler.com, then run:"
        echo "      doppler setup --no-interactive --project {{dopplerProject}} --config dev"
      fi
    else
      echo "❌ Doppler login did not complete. Re-run this script (or 'doppler login'),"
      echo "   or authenticate with a service token:  export DOPPLER_TOKEN=dp.st.<token>"
    fi
  fi
else
  echo "⚠️  Doppler CLI not found. Skipping Doppler login - run 'goose' after the"
  echo "    devcontainer post-create setup finishes, or install the CLI manually."
fi`;

export const WRANGLER_LOGIN_SCRIPT = String.raw`
echo
# Cloudflare Wrangler login
# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
  echo "Wrangler CLI not found. Installing globally with npm..."
  npm install -g wrangler
fi

# 1. Check if already logged in via Doppler API Token (Highly recommended for multi-container)
if doppler run --project {{dopplerProject}} --config dev -- env | grep -q "CLOUDFLARE_API_TOKEN"; then
  echo "✅ Found CLOUDFLARE_API_TOKEN in Doppler. Using token for authentication."
  # Verify connectivity
  if ! doppler run --project {{dopplerProject}} --config dev -- npx wrangler whoami 2>&1 | grep -q "You are not authenticated"; then
    echo "✅ Successfully authenticated via Doppler token. Skipping interactive login."
    exit 0
  else
    echo "⚠️ CLOUDFLARE_API_TOKEN found in Doppler but 'wrangler whoami' failed. Proceeding to interactive login..."
  fi
fi

# 2. Check if already logged in via OAuth session
if ! npx wrangler whoami 2>&1 | grep -q "You are not authenticated"; then
  echo "✅ Already logged in via OAuth session."
  exit 0
fi

WRANGLER_CALLBACK_PORT=${"${WRANGLER_CALLBACK_PORT:-8976}"}

# 3. Check for port conflicts inside the container
if ss -tuln | grep -q ":8976 "; then
  CONFLICT_PID=$(lsof -t -i:8976)
  echo "❌ Error: the wrangler OAuth callback port is already in use inside this container (PID: $CONFLICT_PID)."
  echo "   If this is a stale 'socat' process, you can kill it with: kill $CONFLICT_PID"
  exit 1
fi

# If we are using a non-standard port, we need to bridge the gap from 8976
if [ "$WRANGLER_CALLBACK_PORT" != "8976" ]; then
  echo "INFO: Using non-standard OAuth callback port. Bridging from the default..."
  socat TCP-LISTEN:8976,fork,reuseaddr TCP:localhost:$WRANGLER_CALLBACK_PORT &
  SOCAT_PID=$!
  trap "kill $SOCAT_PID 2>/dev/null || true" EXIT
fi

# NOTE: do not print the callback host:port here. VS Code's terminal-output port
# scanner matches a host:port literal and forwards it, binding the host side on
# every interface. The port is declared in the devcontainer's forwardPorts
# instead, so it is forwarded (loopback-only) without a terminal literal - see
# README "Port forwarding".
echo "📢 Cloudflare OAuth opens a browser and redirects the login back into this container."
echo "   The callback port is declared in .devcontainer/devcontainer.json (forwardPorts),"
echo "   so VS Code forwards it automatically; no manual Ports-tab entry is needed."
echo

script -q -c "npx wrangler login --browser=false --callback-host=0.0.0.0 --callback-port=${"$WRANGLER_CALLBACK_PORT"} | stdbuf -oL sed 's/0\\.0\\.0\\.0/localhost/g'" /dev/null`;

export const SETUP_WRANGLER_SCRIPT = `
echo
# Setup Wrangler configuration with environment variables
echo "Setting up Wrangler configuration..."
doppler run --project {{dopplerProject}} --config dev -- ./scripts/setup-wrangler-config.sh dev`;

export const DOPPLER_INSTALL_SCRIPT = String.raw`curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' | gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" | tee /etc/apt/sources.list.d/doppler-cli.list`;

// uv + spec-kit travel together. `spec-kit` is a Python program, and uv is the
// only thing that installs it (uv fetches its own CPython 3.11 and keeps it out
// of PATH). Nothing else in the devcontainer consumes uv, so both fragments are
// injected iff `spec-kit` is selected — see `uvInstallation` / `specKitInstallation`.
//
// These are two injection points and cannot be merged into one placeholder:
// uv itself is installed as root on the apt RUN, while `uv tool install` runs
// later as the non-root user inside the goose/tooling RUN.
export const UV_INSTALL_FRAGMENT = ` \\\n    && curl -LsSf https://astral.sh/uv/install.sh | env CARGO_HOME=/usr/local UV_INSTALL_DIR=/usr/local/bin sh`;
export const SPEC_KIT_INSTALL_FRAGMENT = `&& uv tool install --python 3.11 git+https://github.com/github/spec-kit.git \\\n    `;

/**
 * The two Dockerfile injection points owned by `spec-kit`, resolved together.
 *
 * Deliberately a helper: the caller is a large function already at its
 * cognitive-complexity ceiling, and two more ternaries in it trip the rule.
 * Both values are empty when the capability is not selected — uv has no other
 * consumer in the devcontainer.
 */
export function specKitInstallationFragments(capabilities) {
  return capabilities.includes("spec-kit")
    ? {
        uvInstallation: UV_INSTALL_FRAGMENT,
        specKitInstallation: SPEC_KIT_INSTALL_FRAGMENT,
      }
    : { uvInstallation: "", specKitInstallation: "" };
}

/**
 * Whether the generated devcontainer carries goose at all.
 *
 * `doppler` is the predicate rather than `coding-agents`, because the only
 * supported way to run goose in a generated devcontainer is the {@link
 * GOOSE_ALIAS} wrapper, which runs it under `doppler run`: goose takes its
 * provider from the `LITELLM_*` env of the `goose` Doppler project, and a bare
 * binary dies with `error: No provider configured` (spec 012). Every capability
 * that wants goose resolves doppler along with it — `coding-agents` and
 * `container-agent` declare it outright, `xcode-development` inherits it
 * through `coding-agents`, and `circleci` declares it for its MCP tokens — so
 * this one lookup means "goose can actually run here", with no capability list
 * to go stale as the catalog grows.
 *
 * @param {string[]} capabilities Resolved capability IDs.
 * @returns {boolean} True when goose is installed, wrapped and configured.
 */
export function hasGoose(capabilities) {
  return capabilities.includes("doppler");
}

/**
 * The Dockerfile fragment owned by goose: install the release binary as a
 * standalone RUN, injected iff {@link hasGoose}.
 *
 * Deliberately a whole `RUN` rather than a mid-chain fragment: it has no
 * natural successor in the devcontainer RUN (it ended that instruction), and a
 * fragment spliced into a `\`-continued chain cannot be empty without leaving
 * the chain dangling.
 */
export const GOOSE_INSTALL_FRAGMENT = `RUN GOOSE_ARCH="$(uname -m | sed 's/arm64/aarch64/')" \\
    && GOOSE_TAG="$(curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 https://api.github.com/repos/aaif-goose/goose/releases/latest | sed -n 's/.*"tag_name": "\\([^"]*\\)".*/\\1/p')" \\
    && if [ -z "$GOOSE_TAG" ]; then echo "WARN: could not resolve latest goose tag; falling back to 'stable' release"; GOOSE_TAG=stable; fi \\
    && GOOSE_URL="https://github.com/aaif-goose/goose/releases/download/\${GOOSE_TAG}/goose-\${GOOSE_ARCH}-unknown-linux-gnu.tar.bz2" \\
    && echo "Downloading goose \${GOOSE_TAG} (\${GOOSE_ARCH})..." \\
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 -o /tmp/goose.tar.bz2 "$GOOSE_URL" \\
    && mkdir -p /tmp/goose-extract \\
    && tar -xjf /tmp/goose.tar.bz2 -C /tmp/goose-extract \\
    && install -m 0755 /tmp/goose-extract/goose "$HOME/.local/bin/goose" \\
    && "$HOME/.local/bin/goose" --version \\
    && rm -rf /tmp/goose.tar.bz2 /tmp/goose-extract`;

/**
 * The `{{gooseInstall}}` value for the devcontainer Dockerfiles: the goose
 * install RUN when goose is present, an empty line otherwise.
 *
 * A helper rather than an inline ternary because the callers are large
 * functions already at their cognitive-complexity ceilings (same reason
 * {@link specKitInstallationFragments} exists).
 *
 * @param {string[]} capabilities Resolved capability IDs.
 * @returns {string} The Dockerfile fragment, or "".
 */
export function gooseInstallFragment(capabilities) {
  return hasGoose(capabilities) ? GOOSE_INSTALL_FRAGMENT : "";
}

/**
 * The `{{gooseUpdate}}` block for `.devcontainer/post-start-setup.sh`, injected
 * iff {@link hasGoose}.
 *
 * Without the capability gate this ran in every devcontainer and printed
 * `WARN: goose not found, skipping update` on every start of a repo that has no
 * goose — a warning about a command the repo never offered.
 */
export const GOOSE_UPDATE_SCRIPT = `
echo "INFO: Checking goose version..."
if command -v goose >/dev/null 2>&1; then
    goose update || echo "WARN: goose update failed, keeping current version"
fi
`;

/**
 * The goose worktree zshrc block (`.devcontainer/.zshrc` tail), appended iff
 * {@link hasGoose}: `goose` runs in this shell's feature worktree, plus the
 * `wt audit` / `wt remove` helpers for the worktrees it creates.
 *
 * It lives in its own template because it is conditionally appended rather
 * than substituted into a placeholder, and it must stay *after* the
 * `{{gooseAlias}}` definition it depends on. With no goose there are no goose
 * sessions, so there is nothing to bind a worktree to.
 *
 * @param {TemplateEngine} templateEngine Initialised engine.
 * @param {string[]} capabilities Resolved capability IDs.
 * @returns {string} The block, or "".
 */
export function gooseWorktreeZshrc(templateEngine, capabilities) {
  return hasGoose(capabilities)
    ? templateEngine.generateFile("devcontainer-zshrc-goose-wt", {})
    : "";
}

/**
 * The `runArgs` grant owned by `micropython`, selected by `deviceAccess`.
 *
 * There is deliberately no pinned-`--device` branch: Docker never expands a
 * glob in `--device` (F8), and a concrete path makes the container refuse to
 * start when the board is absent (T4a). `cgroup-rule` is the bench-verified
 * default (T3/T5); `privileged` is the escape hatch and is broader on every
 * axis. See the capability spec, section 5.
 */
export function micropythonRunArgs(config = {}) {
  switch (config.deviceAccess) {
    case "privileged":
      return ["--privileged"];
    case "cgroup-rule":
    default:
      // 'c *:* rmw' is the only major-agnostic spelling: OrbStack assigns a
      // dynamic major (236 on the bench, NOT the classic 188), and the grammar
      // takes a single integer or '*' -- never a range or list (F10). The
      // cgroup rule alone does not create the node, so the host /dev is bound
      // over the container's.
      return ["--device-cgroup-rule=c *:* rmw", "--volume=/dev:/dev"];
  }
}

/**
 * The Dockerfile fragment owned by `micropython`: add the container user to the
 * `dialout` group, because the forwarded node is root:dialout 0660 (F5).
 * Visibility is not access -- without this every open() is EPERM.
 *
 * A helper rather than an inline ternary so the callers stay under their
 * cognitive-complexity ceilings.
 */
export function micropythonInstallationFragment(capabilities, context) {
  if (!capabilities.includes("micropython")) return "";
  const user = resolveProjectLanguage(context) === "node" ? "node" : "vscode";
  return ` \\\n    && groupadd -f dialout \\\n    && usermod -aG dialout ${user}`;
}

const templateImports = {
  "devcontainer-java-dockerfile": devcontainerJavaDockerfile,
  "devcontainer-java-json": devcontainerJavaJson,
  "devcontainer-node-dockerfile": devcontainerNodeDockerfile,
  "devcontainer-node-json": devcontainerNodeJson,
  "devcontainer-p10k-zsh-full": devcontainerP10kZshFull,
  "devcontainer-p10k-zsh": devcontainerP10kZsh,
  "devcontainer-post-create-setup-sh": devcontainerPostCreateSetupSh,
  "devcontainer-post-start-setup-sh": devcontainerPostStartSetupSh,
  "devcontainer-python-dockerfile": devcontainerPythonDockerfile,
  "devcontainer-python-json": devcontainerPythonJson,
  "devcontainer-rust-dockerfile": devcontainerRustDockerfile,
  "devcontainer-rust-json": devcontainerRustJson,
  "devcontainer-zshrc-full": devcontainerZshrcFull,
  "devcontainer-zshrc-goose-wt": devcontainerZshrcGooseWt,
  "devcontainer-zshrc": devcontainerZshrc,
  "devcontainer-tmux-conf": devcontainerTmuxConf,
  "playwright-config": playwrightConfig,
  "lighthouse-ci-config": lighthouseCiConfig,
  "circleci-config": circleCiConfig,
  "buildkite-pipeline": buildkitePipeline,
  "buildkite-readme": buildkiteReadme,
  "github-release-notes": githubReleaseNotes,
  "github-release-readme": githubReleaseReadme,
  "github-release-artifacts": githubReleaseArtifacts,
  "github-release-smoke-launch": githubReleaseSmokeLaunch,
  "github-release-build-payload": githubReleaseBuildPayload,
  dockerfile: dockerfileTemplate,
  dockerignore: dockerignoreTemplate,
  "docker-compose": dockerComposeTemplate,
  "deploy-readme": deployReadmeTemplate,
  "homepage-services": homepageServicesTemplate,
  "env-example": envExampleTemplate,
  ".sonarcloud.properties": sonarProjectProperties,
  "eslint-config-js": eslintConfigJs,
  "doppler-yaml": dopplerYaml,
  "mcp-config-json": mcpConfigJson,
  "mcp-sse-proxy-js": mcpSseProxyJs,
  "mcp-streamable-http-proxy-js": mcpStreamableHttpProxyJs,
  "package-json": packageJsonTemplate,
  "wrangler-jsonc": wranglerJsonc,
  "wrangler-template-jsonc": wranglerTemplateJsonc,
  "scripts-cloud-login-sh": scriptsCloudLoginSh,
  "scripts-fetch-launch-sh": scriptsFetchLaunchSh,
  "fetch-launch-readme": fetchLaunchReadme,
  "scripts-run-wrangler-dev-sh": scriptsRunWranglerDevelopmentSh,
  "scripts-setup-wrangler-config-sh": scriptsSetupWranglerConfigSh,
  "scripts-sync-doppler-secrets-sh": scriptsSyncDopplerSecretsSh,
  "scripts-agent-dev-sh": scriptsAgentDevSh,

  gitignore: gitignoreTemplate,
  "dependabot-config": dependabotConfig,
  "dependabot-auto-merge": dependabotAutoMerge,
  "vscode-tasks-json": vscodeTasksJson,
  "vscode-settings-json": vscodeSettingsJson,
  "cloudflare-worker-index-js": cloudflareWorkerIndexJs,
  "svelte-app-html": svelteAppHtml,
  "svelte-page-svelte": sveltePageSvelte,
  "svelte-config-js": svelteConfigJs,
  "svelte-vite-config-js": svelteViteConfigJs,
  "svelte-index-html": svelteIndexHtml,
  "svelte-main-js": svelteMainJs,
  "svelte-app-svelte": svelteAppSvelte,
  "svelte-frontend-config-js": svelteFrontendConfigJs,
  "svelte-frontend-vite-config-js": svelteFrontendViteConfigJs,
  "svelte-package-json": sveltePackageJson,
  "docsify-index": docsifyIndex,
  "docsify-readme": docsifyReadme,
  "devcontainer-serve-docs-cjs": devcontainerServeDocumentsCjs,
  "scripts-find-board-sh": scriptsFindBoardSh,
  "devcontainer-post-create-micropython-sh":
    devcontainerPostCreateMicropythonSh,
};

export class TemplateEngine {
  constructor() {
    this.templates = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return true;
    }
    try {
      // Load raw template strings
      for (const [templateId, templateString] of Object.entries(
        templateImports,
      )) {
        this.templates.set(templateId, templateString);
      }

      this.initialized = true;
      return true;
    } catch (error) {
      console.error("Failed to initialize TemplateEngine:", error);
      return false;
    }
  }

  getTemplate(name) {
    const template = this.templates.get(name);
    return template || null;
  }

  compileTemplate(templateString, data) {
    let content = templateString;
    const regex = /{{([^{}]+)}}/g;

    content = content.replaceAll(regex, (match, key) => {
      const trimmedKey = key.trim();
      if (Object.hasOwn(data, trimmedKey)) {
        // eslint-disable-next-line security/detect-object-injection
        return data[trimmedKey];
      }

      const keys = trimmedKey.split(".");
      let value = data;
      for (const k of keys) {
        if (value && typeof value === "object" && Object.hasOwn(value, k)) {
          // eslint-disable-next-line security/detect-object-injection
          value = value[k];
        } else {
          return match;
        }
      }
      return value;
    });

    return content;
  }

  generateFile(templateId, data) {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }
    return this.compileTemplate(template, data);
  }

  generateFiles(fileRequests) {
    const results = [];
    for (const [index, request] of fileRequests.entries()) {
      try {
        // If content is already pre-generated, use it directly
        // This is for merged devcontainer files
        const content =
          request.content ??
          this.generateFile(request.templateId, { ...request.data, index });
        results.push({ ...request, success: true, content });
      } catch (error) {
        results.push({ ...request, success: false, error: error.message });
      }
    }
    return results;
  }
}

function collectSingleTemplateFile(
  templateEngine,
  context,
  capabilityId,
  capability,
  template,
) {
  // A template may opt out of a project entirely (e.g. the payload assembler is
  // seeded only where there is something to assemble). `when` is opt-in: a
  // descriptor without it is emitted exactly as before.
  if (typeof template.when === "function" && !template.when(context)) {
    return;
  }
  try {
    const extraData = getCapabilityTemplateData(capabilityId, {
      capabilities: context.capabilities,
      configuration: context.configuration,
      projectName: context.projectName || context.name || "my-project",
      registryNamespace: context.registryNamespace,
    });

    // Special handling for SvelteKit config adapter. The adapter follows the
    // primary language: a node-primary project's SvelteKit app IS the server
    // (adapter-node), while any other primary language builds STATIC assets
    // (adapter-static) that the language's own server serves. Cloudflare wins
    // where it applies (it conflicts with docker-container).
    let adapterPackage = "@sveltejs/adapter-auto";
    let adapterComment =
      "// adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.\n" +
      "    // If your environment is not supported or you settled on a specific environment, switch out the adapter.\n" +
      "    // See https://kit.svelte.dev/docs/adapters for more information about adapters.";

    if (
      capabilityId === "sveltekit" &&
      context.capabilities.includes("cloudflare-wrangler")
    ) {
      adapterPackage = "@sveltejs/adapter-cloudflare";
      adapterComment =
        "// adapter-cloudflare is configured for Wrangler deployment\n" +
        "    // See https://kit.svelte.dev/docs/adapter-cloudflare for more information.";
    } else if (
      capabilityId === "sveltekit" &&
      resolveProjectLanguage(context) !== "node"
    ) {
      adapterPackage = "@sveltejs/adapter-static";
      adapterComment =
        `// adapter-static: the SvelteKit app builds to static assets that the\n` +
        `    // ${resolveProjectLanguage(context)} server serves. It is not a Node server.\n` +
        "    // See https://kit.svelte.dev/docs/adapter-static for more information.";
    } else if (
      capabilityId === "sveltekit" &&
      context.capabilities.includes("docker-container")
    ) {
      adapterPackage = "@sveltejs/adapter-node";
      adapterComment =
        "// adapter-node outputs a standalone Node server (build/index.js) for the Docker container\n" +
        "    // See https://kit.svelte.dev/docs/adapter-node for more information.";
    }

    // eslint-disable-next-line security/detect-object-injection
    const capabilityConfig = context.configuration?.[capabilityId] || {};

    const content = templateEngine.generateFile(template.templateId, {
      ...context,
      ...extraData,
      projectName: context.projectName || context.name || "my-project",
      capabilityConfig,
      capability,
      adapterPackage,
      adapterComment,
    });
    // A frontend app in a non-node project lives in its own directory (see
    // resolveSvelteDirectory), so its files are emitted under that prefix
    // rather than the repository root. A node project is unaffected ("").
    // Keyed off the `frontend` contribution type, not the sveltekit id.
    const isFrontendCapability = capabilityProvides(capability, "frontend");
    const filePath = isFrontendCapability
      ? `${sveltePrefix(context)}${template.filePath}`
      : template.filePath;
    return {
      filePath,
      content: /\.ya?ml$/i.test(filePath)
        ? normalizeYamlBlankLines(content)
        : content,
    };
  } catch (error) {
    console.warn(
      `⚠️ Failed to process template ${template.templateId}:`,
      error,
    );
    return;
  }
}

// Helper to collect files for non-dev-container capabilities
export function collectNonDevelopmentContainerFiles(
  templateEngine,
  context,
  otherCapabilities,
) {
  const collected = [];

  for (const capabilityId of canonicalCapabilityOrder(otherCapabilities)) {
    const capability = capabilities.find((c) => c.id === capabilityId);
    // `capability.templates` is only present when a caller injects it (tests);
    // the real catalog keeps template wiring in `capability-templates.js`.
    const templates =
      capability?.templates ?? capabilityTemplates[capabilityId];
    if (capability && templates) {
      for (const template of templates) {
        const file = collectSingleTemplateFile(
          templateEngine,
          context,
          capabilityId,
          capability,
          template,
        );
        if (file) {
          collected.push(file);
        }
      }
    }
  }

  // Explicit last-wins precedence: when two capabilities emit the same path
  // (svelte base → sveltekit override), the later capability in the canonical
  // order owns the file's contents. A `Map` keeps the first-seen position but
  // stores the last-seen value, so the output order stays stable.
  return [...new Map(collected.map((file) => [file.filePath, file])).values()];
}

function addExtensionsFromContainerJson(allExtensions, json) {
  if (json.customizations?.vscode?.extensions) {
    for (const extension of json.customizations.vscode.extensions) {
      allExtensions.add(extension);
    }
  }
}

function addExtensionsFromCapabilities(allExtensions, capabilityIds) {
  for (const capabilityId of capabilityIds) {
    const capability = capabilities.find((c) => c.id === capabilityId);
    if (capability && capability.vscodeExtensions) {
      for (const extension of capability.vscodeExtensions)
        allExtensions.add(extension);
    }
  }
}

/**
 * Computes the devcontainer.json mounts + forwardPorts from the SELECTED
 * capabilities only (memo §2.9 / audit §4.5): the tailscale state volume is
 * always kept (dev-network bootstrap, do-not-regress), wrangler/doppler/gemini
 * volumes only when those capabilities are selected, and the kitchen-sink
 * forwardPorts are dropped (docsify adds its own below).
 * @param {Object} context - Generation context
 * @returns {{devcontainerMounts: string, devcontainerForwardPorts: string}} Template data
 */
export function getDevcontainerJsonExtras(context) {
  const isNode = context.capabilities.includes("devcontainer-node");
  const home = isNode ? "/home/node" : "/home/vscode";
  const projectName = context.projectName || context.name || "my-project";

  const mounts = [
    `source=${projectName}-tailscale-state,target=/var/lib/tailscale,type=volume`,
  ];
  if (context.capabilities.includes("cloudflare-wrangler")) {
    mounts.push(
      `source=${projectName}-wrangler-config,target=${home}/.wrangler,type=volume`,
    );
  }
  if (context.capabilities.includes("doppler")) {
    // Round-5 (memo genproj-fixes-round5): bind the host ~/.doppler into the
    // container so `doppler setup`/auth survives rebuilds and the host's
    // Doppler login is shared (mirrors the ${localEnv:HOME}/.config/goose
    // bind-mount). Previously a named volume — the CLI auth never persisted.
    mounts.push(
      `source=\${localEnv:HOME}/.doppler,target=${home}/.doppler,type=bind`,
    );
  }
  if (context.capabilities.includes("coding-agents")) {
    mounts.push(
      `source=gemini-cli-settings,target=${home}/.gemini,type=volume`,
    );
  }
  // genproj-ssh-auth (memo "Fix genproj to scaffold SSH-based GitHub auth"):
  // bind the host ~/.ssh into the container so GitHub auth works over SSH
  // (git@github.com:) with no PAT embedded in git config / remote URLs. The
  // post-create setup copies the key into a container-owned dir (never
  // chowns the mount) or uses a forwarded SSH agent.
  // This is a live bind mount, not a copy: host `~/.ssh/config` aliases and
  // host key authorization ARE the container's, so `ssh <alias>` in a
  // container resolves host machine state — fix aliases and authorize keys on
  // the host, never per project (README §The host `~/.ssh` mount). One caveat
  // this mount imposes on the host: `~/.ssh/config` must be 644, because the
  // container uid (1000) must be able to read a file that may keep the host
  // uid (501) — see tests/generator/devcontainer-generation.test.js.
  mounts.push(`source=\${localEnv:HOME}/.ssh,target=${home}/.ssh,type=bind`);
  // Migration (goose-mcp-groups-migration §2 / handoff-goose-devcontainer-genproj):
  // MCPHub is now the goose data plane, so the host ~/.config/goose is NO
  // LONGER bind-mounted into generated devcontainers. genproj instead WRITES
  // an extensions-only config.yaml (MCPHub `dev` group + local/remote
  // exceptions) in generateGooseSetupScript(); the provider resolves from the
  // Doppler env at runtime. No bind mount for goose here.

  // Declared forwardPorts, never terminal-scraped ones (memo "stop stale VS Code
  // port forwards"): VS Code auto-forwards ports scraped out of terminal output
  // and binds the host side on every interface; with `remote.localPortHost:
  // "localhost"` (see vscode-settings-json.template) a *declared* forward binds
  // loopback-only. The Cloudflare OAuth callback (the one genuine host->container
  // port in a generated project) is declared here instead of being printed as a
  // `localhost:8976` literal in the post-create output, which is what the output
  // scraper keyed on.
  const forwardPorts = [];
  if (context.capabilities.includes("cloudflare-wrangler")) {
    // Cloudflare's OAuth redirect is hard-coded to the host's port 8976; wrangler
    // listens for it inside the container (WRANGLER_LOGIN_SCRIPT), so it has to
    // be forwarded to reach the browser on the host.
    forwardPorts.push(8976);
  }

  return {
    devcontainerMounts: mounts.map((m) => `"${m}"`).join(",\n    "),
    devcontainerForwardPorts: JSON.stringify(forwardPorts),
  };
}

function processAdditionalDevelopmentContainer(
  capabilityId,
  context,
  templateEngine,
  mergedJson,
  allExtensions,
) {
  const capability = capabilities.find((c) => c.id === capabilityId);

  const capabilityConfig = applyDefaults(
    capability,
    context.configuration?.[capabilityId] || {},
  );

  const otherJsonContent = templateEngine.generateFile(
    `devcontainer-${capabilityId.split("-")[1]}-json`,
    {
      ...context,
      projectName: context.projectName || context.name || "my-project",
      capabilityConfig: capabilityConfig,
      capability: capability,
      ...getDevcontainerJsonExtras(context),
    },
  );
  const otherJson = JSON.parse(otherJsonContent);

  if (otherJson.features) {
    mergedJson.features = {
      ...mergedJson.features,
      ...otherJson.features,
    };
  }

  addExtensionsFromContainerJson(allExtensions, otherJson);
}

function generateAndMergeDevcontainerJson(
  templateEngine,
  context,
  developmentContainerCapabilities,
) {
  // The base follows the primary language, not "first selected": otherwise the
  // base JSON (remoteUser, features, remoteEnv PATH) and CI can disagree,
  // order-dependently (memo D8). A declared-but-absent devcontainer for the
  // primary language is legal and intentional - language rust with only
  // devcontainer-python selected means a rust base image and no python tooling.
  const baseDevelopmentContainerId = primaryDevcontainerCapabilityId(context);
  const baseCapability = capabilities.find(
    (c) => c.id === baseDevelopmentContainerId,
  );

  const baseCapabilityConfig = applyDefaults(
    baseCapability,
    // eslint-disable-next-line security/detect-object-injection
    context.configuration?.[baseDevelopmentContainerId] || {},
  );

  // Process devcontainer.json merging
  const baseJsonContent = templateEngine.generateFile(
    `devcontainer-${baseDevelopmentContainerId.split("-")[1]}-json`,
    {
      ...context,
      projectName: context.projectName || context.name || "my-project",
      capabilityConfig: baseCapabilityConfig,
      capability: baseCapability,
      ...getDevcontainerJsonExtras(context),
    },
  );
  let mergedDevelopmentContainerJson = JSON.parse(baseJsonContent);

  const allExtensions = new Set();
  // Always include the tmux-integrated and mermaid-preview extensions
  allExtensions.add("pcassidy75.tmux-integrated");
  allExtensions.add("vsc-mermaid.mermaid-preview");

  // 1. From base JSON
  addExtensionsFromContainerJson(allExtensions, mergedDevelopmentContainerJson);

  // 2. From all capabilities (project configuration)
  addExtensionsFromCapabilities(allExtensions, context.capabilities);

  // 3. From other devcontainer JSONs (merged ones) - the selected
  // devcontainers other than the primary-language base are toolboxes, merged
  // in for their features and extensions.
  for (const capabilityId of developmentContainerCapabilities) {
    if (capabilityId === baseDevelopmentContainerId) continue;
    processAdditionalDevelopmentContainer(
      capabilityId,
      context,
      templateEngine,
      mergedDevelopmentContainerJson,
      allExtensions,
    );
  }

  if (allExtensions.size > 0) {
    if (!mergedDevelopmentContainerJson.customizations) {
      mergedDevelopmentContainerJson.customizations = {};
    }
    if (!mergedDevelopmentContainerJson.customizations.vscode) {
      mergedDevelopmentContainerJson.customizations.vscode = {};
    }
    mergedDevelopmentContainerJson.customizations.vscode.extensions = [
      ...allExtensions,
    ];
  }

  if (context.capabilities.includes("docsify")) {
    if (!mergedDevelopmentContainerJson.forwardPorts) {
      mergedDevelopmentContainerJson.forwardPorts = [];
    }
    if (!mergedDevelopmentContainerJson.forwardPorts.includes(3000)) {
      mergedDevelopmentContainerJson.forwardPorts.unshift(3000);
    }
  }

  // container-agent: the agent must be given time to deregister on `docker
  // stop`. devcontainer.json has no `stop_grace_period` key - that is a
  // compose-only setting - the equivalent for a `docker run`-based container is
  // docker's own `--stop-timeout`, which the devcontainer CLI passes through
  // `runArgs`. A measured goose child shutdown is ~8s, so the 30s here is
  // headroom, not a timeout anyone should be waiting on.
  //
  // Appended rather than set: runArgs already carries the tailnet flags, and
  // the merge target (see mergeDevcontainerJson) unions the list, so adding
  // this to an existing devcontainer is a regeneration, not a hand-edit.
  if (context.capabilities.includes("container-agent")) {
    const runArgs = Array.isArray(mergedDevelopmentContainerJson.runArgs)
      ? [...mergedDevelopmentContainerJson.runArgs]
      : [];
    for (const arg of ["--stop-timeout", "30"]) {
      if (!runArgs.includes(arg)) runArgs.push(arg);
    }
    mergedDevelopmentContainerJson.runArgs = runArgs;
  }

  // micropython: the USB passthrough grant. The device-cgroup-rule widens
  // access but does not create the node; the /dev bind is what makes it
  // appear. Appended (and deduped) rather than set, so the tailnet flags the
  // base already carries survive.
  if (context.capabilities.includes("micropython")) {
    const micropythonCapability = capabilities.find(
      (c) => c.id === "micropython",
    );
    const micropythonConfig = applyDefaults(
      micropythonCapability,
      context.configuration?.micropython || {},
    );
    const runArgs = Array.isArray(mergedDevelopmentContainerJson.runArgs)
      ? [...mergedDevelopmentContainerJson.runArgs]
      : [];
    for (const arg of micropythonRunArgs(micropythonConfig)) {
      if (!runArgs.includes(arg)) runArgs.push(arg);
    }
    mergedDevelopmentContainerJson.runArgs = runArgs;
  }

  return {
    filePath: ".devcontainer/devcontainer.json",
    content: `${JSON.stringify(mergedDevelopmentContainerJson, undefined, 2)}\n`,
  };
}

// Helper to generate and merge devcontainer files
export function generateMergedDevelopmentContainerFiles(
  templateEngine,
  context,
  developmentContainerCapabilities,
) {
  const files = [];

  if (developmentContainerCapabilities.length === 0) return files;

  // The Dockerfile base follows the primary language (memo D8), matching the
  // base JSON that generateAndMergeDevcontainerJson selects.
  const baseDevelopmentContainerId = primaryDevcontainerCapabilityId(context);
  const baseCapability = capabilities.find(
    (c) => c.id === baseDevelopmentContainerId,
  );

  const baseCapabilityConfig = applyDefaults(
    baseCapability,
    // eslint-disable-next-line security/detect-object-injection
    context.configuration?.[baseDevelopmentContainerId] || {},
  );

  // Process Dockerfile (the base one)
  const dockerfileContent = templateEngine.generateFile(
    `devcontainer-${baseDevelopmentContainerId.split("-")[1]}-dockerfile`,
    {
      ...context,
      capabilityConfig: baseCapabilityConfig,
      capability: baseCapability,
      // uv + spec-kit are one unit: `spec-kit` is a Python program and uv is
      // the only thing that installs it, so both exist iff the capability is
      // selected. Splitting them would leave uv orphaned in every project.
      ...specKitInstallationFragments(context.capabilities),
      micropythonInstallation: micropythonInstallationFragment(
        context.capabilities,
        context,
      ),
      dopplerInstallation: context.capabilities.includes("doppler")
        ? ` \\\n    && ${DOPPLER_INSTALL_SCRIPT} \\\n    && apt-get update && apt-get install -y doppler`
        : "",
      docsifyInstallation: context.capabilities.includes("docsify")
        ? " \\\n    && npm install -g docsify-cli"
        : "",
      // goose is installed only where it can run (spec 012) — see hasGoose.
      gooseInstall: gooseInstallFragment(context.capabilities),
    },
  );

  files.push(
    generateAndMergeDevcontainerJson(
      templateEngine,
      context,
      developmentContainerCapabilities,
    ),
    {
      filePath: ".devcontainer/Dockerfile",
      content: dockerfileContent,
    },
    {
      filePath: ".devcontainer/.zshrc",
      content:
        templateEngine.generateFile("devcontainer-zshrc-full", {
          ...context,
          projectName: context.projectName || context.name || "my-project",
          agyDevAlias: context.capabilities.includes("doppler")
            ? AGY_DEV_ALIAS.replaceAll(
                "{{dopplerProject}}",
                () => resolveDopplerTarget(context).project,
              )
            : "",
          gooseAlias: hasGoose(context.capabilities) ? GOOSE_ALIAS : "",
        }) + gooseWorktreeZshrc(templateEngine, context.capabilities),
    },
    {
      filePath: ".devcontainer/.p10k.zsh",
      content: templateEngine.generateFile(
        "devcontainer-p10k-zsh-full",
        context,
      ),
    },
    {
      filePath: ".devcontainer/.tmux.conf",
      content: templateEngine.generateFile("devcontainer-tmux-conf", {
        ...context,
        projectName: context.projectName || context.name || "my-project",
      }),
    },
    {
      filePath: ".devcontainer/post-start-setup.sh",
      content: templateEngine.generateFile("devcontainer-post-start-setup-sh", {
        ...context,
        // The container's own agent (memo "The container's own agent") comes up
        // here, not in post-create: an agent that only exists after a rebuild is
        // missing for the whole session it was meant to serve. `agent-dev.sh
        // start` is idempotent and fails open, so the devcontainer still comes
        // up when the network (or Doppler) does not.
        containerAgentService: context.capabilities.includes("container-agent")
          ? `echo "INFO: Checking the container agent..."
if [ -x "/workspaces/${context.projectName || context.name || "my-project"}/scripts/agent-dev.sh" ]; then
    "/workspaces/${context.projectName || context.name || "my-project"}/scripts/agent-dev.sh" start || true
else
    echo "WARN: scripts/agent-dev.sh not found, skipping the container agent"
fi
`
          : "",
        // goose updates itself on start, but only where goose exists (spec 012).
        gooseUpdate: hasGoose(context.capabilities) ? GOOSE_UPDATE_SCRIPT : "",
        docsifyService: context.capabilities.includes("docsify")
          ? `\n# Start documentation server\n# Ensure symlink for specs exists in docs folder for the documentation server\nif [ ! -L /workspaces/${context.projectName || context.name || "my-project"}/docs/specs ] && [ ! -e /workspaces/${context.projectName || context.name || "my-project"}/docs/specs ]; then\n    echo "INFO: Creating specs symlink in docs folder..."\n    ln -s ../specs /workspaces/${context.projectName || context.name || "my-project"}/docs/specs\nfi\n\necho "INFO: Checking documentation server status..."\nif ! pgrep -f 'serve-docs.cjs' >/dev/null; then\n    echo "INFO: Documentation server not running. Starting custom Node server..."\n    if [ -f "/workspaces/${context.projectName || context.name || "my-project"}/.devcontainer/serve-docs.cjs" ]; then\n        sudo start-stop-daemon --start --background --oknodo --pidfile /var/run/serve-docs.pid --make-pidfile --chuid $(id -un):$(id -gn) --exec "/usr/local/bin/node" -- /workspaces/${context.projectName || context.name || "my-project"}/.devcontainer/serve-docs.cjs\n    else\n        echo "WARNING: serve-docs.cjs not found, skipping startup."\n    fi\nfi\n`
          : "",
      }),
    },
    {
      filePath: ".devcontainer/post-create-setup.sh",
      content: templateEngine.generateFile(
        "devcontainer-post-create-setup-sh",
        {
          ...context,
          // The template addresses the workspace as /workspaces/{{projectName}},
          // so the placeholder must always resolve (callers are not required to
          // pass projectName — e.g. previews and tests pass `name` or nothing).
          projectName: context.projectName || context.name || "my-project",
          // 2.9: the devcontainer setup script only contains tooling for
          // SELECTED capabilities — no kitchen-sink leftovers.
          wranglerSetup: context.capabilities.includes("cloudflare-wrangler")
            ? `echo "INFO: Ensuring wrangler directory permissions..."\nmkdir -p "$USER_HOME_DIR/.wrangler"\nsudo chown -R "$CURRENT_USER:$CURRENT_USER" "$USER_HOME_DIR/.wrangler"\n`
            : "",
          dopplerSetup: context.capabilities.includes("doppler")
            ? generateDopplerSetupScript(context)
            : "",
          geminiSetup: context.capabilities.includes("coding-agents")
            ? `echo "INFO: Ensuring gemini directory permissions..."\nmkdir -p "$USER_HOME_DIR/.gemini"\nsudo chown -R "$CURRENT_USER:$CURRENT_USER" "$USER_HOME_DIR/.gemini"\n`
            : "",
          pythonSetup: context.capabilities.some((c) =>
            c.startsWith("devcontainer-python"),
          )
            ? PYTHON_SETUP_SCRIPT.replaceAll(
                "{{projectName}}",
                () => context.projectName || context.name || "my-project",
              )
            : "",
          nodeSetup: context.capabilities.some((c) =>
            c.startsWith("devcontainer-node"),
          )
            ? NODE_SETUP_SCRIPT.replaceAll(
                "{{projectName}}",
                () => context.projectName || context.name || "my-project",
              )
            : "",
          micropythonSetup: context.capabilities.includes("micropython")
            ? `echo "INFO: Setting up MicroPython board toolchain..."
(cd /workspaces/${context.projectName || context.name || "my-project"} && bash .devcontainer/post-create-micropython.sh) || echo "WARN: MicroPython setup reported problems; the devcontainer is still usable."
`
            : "",
          gitSafeDirectory: GIT_SAFE_DIR_SCRIPT.replaceAll(
            "{{projectName}}",
            () => context.projectName || context.name || "my-project",
          ),
          gitGithubAuthSetup: context.capabilities.includes("doppler")
            ? GIT_GITHUB_AUTH_SETUP_SCRIPT
            : "",
          agySetup: context.capabilities.includes("coding-agents")
            ? AGY_SETUP_SCRIPT
            : "",
          // goose setup (recipes + project-selected MCP extensions) is written
          // iff goose exists at all: an extensions-only config for a binary
          // that is not installed (or cannot resolve a provider) is inert, and
          // sonarcloud/sveltekit/circleci contribute their MCP extension only
          // when the repo they land in actually has goose — see hasGoose.
          gooseSetup: hasGoose(context.capabilities)
            ? generateGooseSetupScript(context)
            : "",
          playwrightSetup: context.capabilities.includes("playwright")
            ? PLAYWRIGHT_SETUP_SCRIPT
            : "",
          gitHooksSetup:
            context.capabilities.includes("code-quality") ||
            context.capabilities.includes("code-quality-python") ||
            context.capabilities.includes("devcontainer-node")
              ? `echo "INFO: Installing git pre-commit hooks (lint-staged)..."\n(cd /workspaces/${context.projectName || context.name || "my-project"} && npx --yes simple-git-hooks) || echo "WARN: Run 'npx simple-git-hooks' to install hooks manually."`
              : "",
          specdagSetup: context.capabilities.includes("spec-kit")
            ? `echo "INFO: Installing specdag globally..."\nnpm install -g @japorto100/specdag\n`
            : "",
          socatSetup: context.capabilities.includes("coding-agents")
            ? `if ! pgrep -f "socat TCP-LISTEN:9222" > /dev/null; then\n    echo "Setup bridget to access Chrome DevTools Protocol over a secure tunnel..."\n    sudo start-stop-daemon --start --background --pidfile /var/run/socat-9222.pid --make-pidfile --chuid $(id -un):$(id -gn) --exec /usr/bin/socat -- TCP-LISTEN:9222,fork,bind=127.0.0.1 TCP:host.docker.internal:9222\nfi\n`
            : "",
          cloudLoginSetup:
            context.capabilities.includes("doppler") ||
            context.capabilities.includes("cloudflare-wrangler") ||
            context.capabilities.includes("google-cloud")
              ? `echo -e "\\nINFO: Custom container setup script finished."\necho -e "\\n⚠️  To complete cloud login, run:"\necho "    cd /workspaces/${context.projectName || context.name || "my-project"} && bash scripts/cloud_login.sh"`
              : 'echo "INFO: Custom container setup script finished."',
        },
      ),
    },
  );

  return files;
}

function _getFrameworkConfig(context) {
  const hasSvelteKit = context.capabilities.includes("sveltekit");
  const hasSvelte = hasFrontend(context);
  const hasWrangler = context.capabilities.includes("cloudflare-wrangler");
  const hasDocker = context.capabilities.includes("docker-container");
  const language = resolveProjectLanguage(context);
  let scripts =
    ',\n    "test": "echo \\"Error: no test specified\\" && exit 1",\n    "build": "echo \'No build step required\'"';
  let devDependencies = "";
  let typeField = "commonjs";
  let overrides = "";

  if (hasSvelteKit) {
    typeField = "module";
    // Dependency versions mirror the FTN webapp's known-good set. In
    // particular vitest must be >=4.x to pair with vite 8 / the svelte 5
    // plugin (vitest 2.x with vite 7 broke component/route imports).
    overrides =
      ',\n  "overrides": {\n    "cookie": "^1.0.2",\n    "@sveltejs/vite-plugin-svelte": "^7.3.0",\n    "vite": "^8.2.2"\n  }';
    scripts =
      ',\n    "test": "echo \\"Error: no test specified\\" && exit 1",\n    "dev": "vite dev",\n    "build": "vite build",\n    "preview": "vite preview --host 127.0.0.1",\n    "check": "svelte-kit sync && svelte-check",\n    "check:watch": "svelte-kit sync && svelte-check --watch"';
    devDependencies +=
      '"@sveltejs/kit": "^2.70.3",\n    "@sveltejs/vite-plugin-svelte": "^7.3.0",\n    "svelte": "^5.53.8",\n    "svelte-check": "^4.1.1",\n    "typescript": "^5.7.2",\n    "vite": "^8.2.2"';

    if (hasWrangler) {
      scripts += ',\n    "deploy": "wrangler deploy"';
      devDependencies +=
        ',\n    "@sveltejs/adapter-cloudflare": "^7.2.4",\n    "wrangler": "^4.56.0"';
    } else if (language !== "node") {
      // Non-node primary: the frontend is static assets the language's server
      // serves, so the SvelteKit build uses adapter-static rather than a Node
      // server. This is what lets a rust/python/java project keep node out of
      // its runtime image.
      devDependencies += ',\n    "@sveltejs/adapter-static": "^3.0.8"';
    } else if (hasDocker) {
      devDependencies += ',\n    "@sveltejs/adapter-node": "^5.4.2"';
    } else {
      devDependencies += ',\n    "@sveltejs/adapter-auto": "^3.0.0"';
    }
  } else if (hasSvelte) {
    // Plain Svelte 5 + Vite, built to static assets. No adapter and no server:
    // the primary language's server serves the output.
    typeField = "module";
    overrides =
      ',\n  "overrides": {\n    "@sveltejs/vite-plugin-svelte": "^7.3.0",\n    "vite": "^8.2.2"\n  }';
    scripts =
      ',\n    "test": "echo \\"Error: no test specified\\" && exit 1",\n    "dev": "vite",\n    "build": "vite build",\n    "preview": "vite preview --host 127.0.0.1"';
    devDependencies +=
      '"@sveltejs/vite-plugin-svelte": "^7.3.0",\n    "svelte": "^5.53.8",\n    "vite": "^8.2.2"';
    if (hasWrangler) {
      // Plain Svelte + Wrangler is not the SvelteKit/Cloudflare path: the
      // worker entry point stays the generic one, but the deploy command and
      // dependency are added so the manifest is consistent.
      scripts += ',\n    "deploy": "wrangler deploy"';
      devDependencies += ',\n    "wrangler": "^4.56.0"';
    }
  } else if (hasWrangler) {
    scripts += ',\n    "deploy": "wrangler deploy"';
    devDependencies += '"wrangler": "^3.57.0"';
    typeField = "module";
  }

  return { typeField, scripts, devDependencies, overrides };
}

function _addNodeDevcontainerConfig(context, config) {
  if (context.capabilities.includes("devcontainer-node")) {
    config.typeField = "module";
    if (!config.devDependencies.includes('"vitest"')) {
      config.devDependencies += config.devDependencies
        ? ',\n    "vitest": "^4.1.10"'
        : '"vitest": "^4.1.10"';
    }
    // Coverage provider is required whenever vitest is present: generated
    // projects get the same coverage gate as the FTN webapp
    // (thresholds in vite.config.js, enforced by `vitest --coverage` in CI).
    if (!config.devDependencies.includes('"@vitest/coverage-v8"')) {
      config.devDependencies += config.devDependencies
        ? ',\n    "@vitest/coverage-v8": "^4.1.11"'
        : '"@vitest/coverage-v8": "^4.1.11"';
    }
    // Replace the placeholder test script with the real vitest runner. The
    // placeholder is injected into every generated package.json up-front, so
    // we must REPLACE it here rather than append (appending produced a
    // duplicate "test" key, which broke JSON consumers).
    config.scripts = config.scripts.replace(
      ',\n    "test": "echo \\"Error: no test specified\\" && exit 1"',
      ',\n    "test": "vitest --coverage",\n    "test:once": "npx vitest run --changed"',
    );

    // SvelteKit projects ship a component smoke test (renders the home page
    // + exercises the health route) so the enforced coverage gate is
    // satisfiable on a fresh project. Component tests need a DOM environment
    // and jest-dom matchers, so pull in @testing-library/svelte (plus its
    // vite plugin), jsdom and jest-dom.
    if (context.capabilities.includes("sveltekit")) {
      const svelteTestDeps = [
        '"@testing-library/svelte": "^5.2.0"',
        '"@testing-library/jest-dom": "^6.6.0"',
        '"jsdom": "^25.0.1"',
      ];
      for (const dep of svelteTestDeps) {
        if (!config.devDependencies.includes(dep.split(":")[0])) {
          config.devDependencies += config.devDependencies
            ? ",\n    " + dep
            : dep;
        }
      }
    }
  }
}

const CODE_QUALITY_DEV_DEPS = [
  '"@eslint/js": "^10.0.1"',
  '"eslint": "^10.8.0"',
  '"eslint-config-prettier": "^10.1.8"',
  '"eslint-plugin-sonarjs": "^4.2.0"',
  '"eslint-plugin-security": "^4.0.1"',
  '"globals": "^17.0.0"',
  '"prettier": "^3.9.6"',
  '"simple-git-hooks": "^2.13.1"',
  '"lint-staged": "^16.4.0"',
];

function _addCodeQualityConfig(context, config) {
  if (!context.capabilities.includes("code-quality")) {
    return;
  }
  const missing = CODE_QUALITY_DEV_DEPS.filter(
    (dep) => !config.devDependencies.includes(dep.split(":")[0]),
  );
  if (missing.length > 0) {
    config.devDependencies +=
      (config.devDependencies ? ",\n    " : "") + missing.join(",\n    ");
  }
  if (!config.scripts.includes('"lint"')) {
    config.scripts += ',\n    "lint": "prettier --check . && eslint ."';
  }
}

/**
 * The git-hook tooling (`simple-git-hooks` + `lint-staged`) arrives only with
 * the `code-quality` capability, so the entries that reference it must not be
 * emitted otherwise: a `prepare` script pointing at an uninstalled binary makes
 * `npm install` fail outright, which took a generated project's CI down before
 * anything else could run.
 * @param {Object} context - Generation context
 * @returns {string} JSON fragment with a trailing comma, or empty
 */
export function buildGitHooksBlock(context) {
  if (!context.capabilities.includes("code-quality")) {
    return "";
  }
  return (
    '  "simple-git-hooks": {\n' +
    '    "pre-commit": "npx lint-staged"\n' +
    "  },\n" +
    '  "lint-staged": {\n' +
    '    "**/*.{js,ts,svelte,json,css,html,md}": "prettier --write --ignore-unknown",\n' +
    '    "**/*.{js,ts,svelte}": "eslint --fix"\n' +
    "  },\n"
  );
}

/**
 * Builds the `scripts` body. `config.scripts` is a fragment that *starts* with a
 * comma, because the template used to hardcode `prepare` as the first entry;
 * now the first entry depends on whether the hook tooling is present, so the
 * separator is decided here.
 * @param {Object} context - Generation context
 * @param {string} scriptsFragment - Comma-led scripts fragment
 * @returns {string} JSON body for the scripts object
 */
export function buildScriptsBlock(context, scriptsFragment) {
  if (context.capabilities.includes("code-quality")) {
    return `"prepare": "simple-git-hooks"${scriptsFragment}`;
  }
  return scriptsFragment.replace(/^\s*,\s*/, "");
}

export function generatePackageJson(templateEngine, context) {
  const config = _getFrameworkConfig(context);
  _addNodeDevcontainerConfig(context, config);
  _addCodeQualityConfig(context, config);

  if (
    context.capabilities.includes("devcontainer-node") ||
    context.capabilities.includes("cloudflare-wrangler")
  ) {
    const content = templateEngine.generateFile("package-json", {
      ...context,
      scriptsBlock: buildScriptsBlock(context, config.scripts),
      hooksBlock: buildGitHooksBlock(context),
      devDependencies: config.devDependencies,
      dependencies: "",
      typeField: config.typeField,
      overrides: config.overrides,
      // Pin a working npm for projects that depend on vitest 4 (injected by
      // devcontainer-node). npm 10's arborist crashes on a fresh install of
      // those projects ('Cannot read properties of null reading edgesOut'),
      // so lock to npm 11 and enforce it via engine-strict (see .npmrc).
      // NOTE: packageManager alone does NOT switch a user's npm (corepack
      // only shims yarn/pnpm) - the devcontainer/CI must ALSO install it.
      npmPins: context.capabilities.includes("devcontainer-node")
        ? `  "packageManager": "npm@11.19.1",\n  "engines": {\n    "npm": ">=11 <12"\n  },\n`
        : "",
      projectName: context.projectName || context.name || "my-project",
    });
    return {
      filePath: "package.json",
      content,
    };
  }
}

/**
 * Generates a project .npmrc enforcing the pinned npm version for Node
 * projects that run a fresh install in a devcontainer (devcontainer-node).
 * Combined with the packageManager/engines pin this prevents the npm 10
 * arborist 'edgesOut' crash on vitest-4 projects. Returns null for projects
 * that don't need it.
 */
export function generateNpmrcFile(context) {
  if (!context.capabilities.includes("devcontainer-node")) {
    return null;
  }
  return {
    filePath: ".npmrc",
    // engine-strict makes npm refuse to install under a mismatched npm
    // (e.g. the npm 10 bundled with Node 22), failing fast with a clear
    // EBADENGINE instead of silently crashing mid-resolution.
    content: "engine-strict=true\n",
  };
}

/**
 * Generates the Python project scaffold for a devcontainer-python project:
 * a standard src-layout pyproject.toml plus minimal src/<pkg>/ and tests/
 * skeletons (memo §2.3). Returns an array of file objects; an empty array when
 * no Python devcontainer is selected.
 *
 * For a MicroPython target the deliverable is firmware, not a host package, so
 * delegation goes to {@link generateMicropythonFirmwareFiles}: the firmware
 * layout (root + `lib/`) and a pyproject whose ruff config covers it. See that
 * function for why.
 *
 * Fixes over the previous scaffold:
 * - real description (no "Generated by Project Generation Tool").
 * - pytest/ruff move to `[project.optional-dependencies] dev` (dev extras,
 *   not runtime deps) -> `pip install -e ".[dev]"` works in CI + devcontainer.
 * - `[tool.setuptools.packages.find] where = ["src"]` (src layout).
 * - standard `testpaths = ["tests"]` with `test_*.py` (no nonstandard
 *   `python_files = "*.test.py"`).
 * - scaffolds src/<pkg>/__init__.py + __main__.py and tests/test_smoke.py so
 *   `python -m <pkg>`, ruff and pytest all work with zero hand edits.
 */
export function generatePyProjectToml(context) {
  const hasPython = context.capabilities.some((c) =>
    c.startsWith("devcontainer-python"),
  );
  if (!hasPython) return [];

  // MicroPython firmware lives at the root and in lib/, and the language is the
  // board's, not the container's. A src-layout host package is the wrong shape
  // on every axis here, so it gets its own scaffold rather than a mutated one.
  if (isMicropython(context)) {
    return generateMicropythonFirmwareFiles(context);
  }

  const hasDagster = context.capabilities.includes("dagster");
  const projectName = context.projectName || context.name || "my-project";
  const distName = toDistributionName(projectName);
  const pkgName = toPythonPackageName(projectName);
  const description = (
    context.description || `A ${projectName} project generated with genproj`
  ).replace(/"/g, '\\"');

  // Round-2 fix 2: `pythonDependencies` (docker-container config) are the
  // app's runtime deps — the generator can't guess them, so they are
  // config-driven like aptPackages/envVars. Emitted into [project]
  // dependencies; dev tools (pytest, ruff) stay in the dev extra.
  const pythonDependencies = Array.isArray(
    context.configuration?.["docker-container"]?.pythonDependencies,
  )
    ? context.configuration["docker-container"].pythonDependencies
    : [];

  const deps = [...pythonDependencies];
  if (hasDagster) {
    deps.push("dagster", "dagster-webserver");
  }
  const dependencies =
    deps.length > 0
      ? "[\n" +
        deps.map((d) => `    "${String(d).replace(/"/g, '\\"')}"`).join(",\n") +
        "\n]"
      : "[]";

  const pyproject = `[project]
name = "${distName}"
version = "0.1.0"
description = "${description}"
readme = "README.md"
requires-python = ">=3.11"
dependencies = ${dependencies}

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "ruff>=0.4"
]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
src = ["src", "tests"]
`;

  const initPy = `"""${projectName} package."""

__version__ = "0.1.0"
`;

  const mainPy = `"""Default module entry point (python -m ${pkgName}).

Override the container command via the genproj docker-container "command"
configuration option (or "entrypoint") when your application needs a custom
entry point.
"""

import sys


def main() -> int:
    print(f"{__package__} is installed and importable.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;

  const smokeTest = `"""Smoke test: the src-layout package installs and imports cleanly."""


def test_package_imports():
    import ${pkgName}

    assert ${pkgName}.__version__
`;

  // Round-3 fix (memo genproj-fixes-round3): when docker-container is
  // configured with a custom `command` or `entrypoint`, the app provides its
  // own entry point — do NOT emit the scaffold `__main__.py`. Regenerating a
  // project whose app had taken over `__main__.py` previously clobbered the
  // real entrypoint with this placeholder (silent breakage: `python -m <pkg>`
  // printed "installed and importable" and exited, killing the MCP stdio
  // server behind mcpo). Fresh projects without a custom command/entrypoint
  // keep the placeholder.
  const dockerConfig = context.configuration?.["docker-container"] || {};
  const hasCustomEntrypoint =
    (Array.isArray(dockerConfig.command) && dockerConfig.command.length > 0) ||
    (Array.isArray(dockerConfig.entrypoint) &&
      dockerConfig.entrypoint.length > 0);

  // A non-node frontend project gets the serving harness in `__main__.py`
  // instead of the "installed and importable" placeholder (see
  // servingHarnessSpec). A custom entry point still wins: the app owns its
  // entry point, so no scaffold (placeholder or harness) is emitted.
  const harness = servingHarnessSpec(context);
  const entryPoint =
    harness && !hasCustomEntrypoint
      ? buildPythonServingHarness(harness)
      : mainPy;

  return [
    { filePath: "pyproject.toml", content: pyproject },
    { filePath: `src/${pkgName}/__init__.py`, content: initPy },
    ...(hasCustomEntrypoint
      ? []
      : [{ filePath: `src/${pkgName}/__main__.py`, content: entryPoint }]),
    { filePath: "tests/test_smoke.py", content: smokeTest },
  ];
}

/**
 * The Python half of the serving harness (see `servingHarnessSpec`).
 *
 * It is the smallest server that honours the container contract the generated
 * Dockerfile declares - binds the exposed port, answers the healthcheck, serves
 * the built frontend, 404s everything else - and it uses the **standard
 * library only** (`http.server`). That keeps the generated project's runtime
 * dependencies at zero and means there is nothing to resolve at build time.
 * The wire protocol and business endpoints are the developer's to add.
 *
 * @param {{port: number, staticDirectory: string, healthPath: string}} harness
 * @returns {string} The `__main__.py` source
 */
export function buildPythonServingHarness(harness) {
  return `"""Serving harness (generated by genproj).

Binds 0.0.0.0:${harness.port}, answers GET ${harness.healthPath} with 200 and a
JSON body ({"status": "ok"}), and serves the built frontend from
${harness.staticDirectory}. This is the *harness* genproj guarantees: the
container comes up, serves the UI, and passes its own HEALTHCHECK. The wire
protocol and business endpoints are yours - replace this module with your
application.

Standard library only, so the generated project keeps zero runtime
dependencies.
"""

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_PORT = ${harness.port}
HEALTH_PATH = "${harness.healthPath}"
# JSON, not a bare "ok": Homepage's \`customapi\` widget parses the health body
# as JSON, so a plain-text reply makes the dashboard tile error.
HEALTH_BODY = b'{"status": "ok"}'
STATIC_DIR = Path("${harness.staticDirectory}")


class Handler(SimpleHTTPRequestHandler):
    """Serve STATIC_DIR, with the health path answered by hand."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self):
        if self.path.split("?", 1)[0] == HEALTH_PATH:
            body = HEALTH_BODY
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        """Keep the default one-line-per-request stderr logging quiet."""


def main() -> int:
    port = int(os.environ.get("PORT", DEFAULT_PORT))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"serving {STATIC_DIR} on http://0.0.0.0:{port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

/**
 * Generates the MicroPython firmware scaffold: a root-level entry point and
 * config, a `lib/` for importable modules, and a pyproject.toml shaped for
 * linting firmware rather than for building a host package.
 *
 * Why the layout is root + `lib/`: the on-device importer resolves modules
 * from the filesystem root and from `lib/` (which is on the board's
 * `sys.path`). Nothing is ever imported from `src/`, so the src-layout
 * scaffold the host-package path emits would leave 100% of the firmware
 * unlinted while `ruff check src tests` reported green on an empty tree.
 *
 * Why `pip install -e ".[dev]"` still works: the devcontainer's post-create
 * hook uses that command to install the lint tooling (ruff ships in the dev
 * extra). The project has no packages to install — `[tool.setuptools]` is
 * pinned to `packages = []` — so the editable install succeeds and installs
 * only the tools, without pretending the firmware is an installable package.
 *
 * Why the lint target is `py37`: the board runs MicroPython 1.19.1, roughly
 * CPython 3.4, but ruff's lowest `target-version` is `py37`. `py37` is the
 * floor, not a match — it rejects 3.8+ syntax but still accepts 3.5–3.7
 * constructs the board may not parse. The README's "Linting firmware" section
 * states that residual gap rather than hiding it behind a value that looks
 * right.
 *
 * @param {Object} context - Generation context
 * @returns {Object[]} File objects for the firmware scaffold
 */
export function generateMicropythonFirmwareFiles(context) {
  const projectName = context.projectName || context.name || "my-project";
  const distName = toDistributionName(projectName);
  const description = (
    context.description || `A ${projectName} project generated with genproj`
  ).replace(/"/g, '\\"');
  const board = context.configuration?.micropython?.board || "other";
  const chip = resolveMicropythonChip(context);

  const pyproject = `[project]
name = "${distName}"
version = "0.1.0"
description = "${description}"
readme = "README.md"
dependencies = []

[project.optional-dependencies]
dev = [
    "ruff>=0.4"
]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

# This is firmware, not a host package: MicroPython resolves modules from the
# filesystem root and lib/. The setuptools config exists only so the
# devcontainer's \`pip install -e ".[dev]"\` installs the lint tooling; it
# deliberately packages nothing.
[tool.setuptools]
packages = []

[tool.ruff]
# ruff lints the whole repository (run \`ruff check .\`), so firmware at the
# root (main.py, config.py) and in lib/ is covered. \`src\` is only ruff's
# first-party import resolver, not the set of files it checks.
src = [".", "lib"]

# The board runs MicroPython 1.19.1 (roughly CPython 3.4). py37 is ruff's
# lowest supported target, so it is the floor, NOT a match: it rejects 3.8+
# syntax (walrus, positional-only params, match) but still accepts 3.5-3.7
# constructs (f-strings, async/await, variable annotations) that this board
# may not parse. See the README section "Linting firmware".
target-version = "py37"
`;

  const mainPy = `"""Firmware entry point.

MicroPython runs this file on boot. Imports resolve from the filesystem root
and from lib/, so reusable modules live in lib/ and are imported by their
module name (see lib/example.py).
"""

import config
from example import describe_board


def main():
    print(describe_board(config.BOARD))


if __name__ == "__main__":
    main()
`;

  const configPy = `"""Board configuration.

Keep tunables here rather than hard-coding them across modules.
"""

# Board this firmware targets (see the README for how it is driven).
BOARD = "${board}"

# RP2 silicon variant this build is for (rp2040 | rp2350 | unknown). Selected
# with the BOARD but on a separate axis: the MicroPython .uf2 is chosen by
# chip, and one product can ship with more than one variant (a Galactic
# Unicorn has been sold as both an RP2040 and a Pico 2 W / RP2350 carrier).
# Confirm it from the board's own banner, never from the USB PID.
CHIP = "${chip}"
`;

  const libExample = `"""Example firmware module.

Anything importable from firmware lives in lib/, which is on the board's
import path. Keep hardware access (machine, neopixel, ...) inside functions so
the module stays importable for linting and host-side tests.
"""


def describe_board(board):
    return "board: " + board
`;

  return [
    { filePath: "pyproject.toml", content: pyproject },
    { filePath: "main.py", content: mainPy },
    { filePath: "config.py", content: configPy },
    { filePath: "lib/example.py", content: libExample },
  ];
}

/**
 * Generates the root README.md (memo §2.5). Language-aware quickstart: pip
 * install -e ".[dev]" + pytest/ruff for Python, npm install + dev for Node.
 * Points to deploy/README.md when docker-container is selected.
 * @param {Object} context - Generation context
 * @returns {Object} README file object
 */
/**
 * Whether `capabilityId` depends on `dependencyId` directly or transitively.
 * @param {string} capabilityId
 * @param {string} dependencyId
 * @param {Set<string>} [seen]
 * @returns {boolean}
 */
function dependsOnCapability(capabilityId, dependencyId, seen = new Set()) {
  if (seen.has(capabilityId)) return false;
  seen.add(capabilityId);
  const capability = capabilities.find((c) => c.id === capabilityId);
  for (const dependency of capability?.dependencies ?? []) {
    if (dependency === dependencyId) return true;
    if (dependsOnCapability(dependency, dependencyId, seen)) return true;
  }
  return false;
}

export function generateReadmeFile(context) {
  const projectName = context.projectName || context.name || "my-project";
  const description =
    context.description || `A ${projectName} project generated with genproj`;
  const hasDocker = context.capabilities.includes("docker-container");
  const language = resolveProjectLanguage(context);
  // D3: Ruff runs in CI only when a CI capability was actually selected. The
  // rendered capability copy says so only then, so the README never promises a
  // pipeline the repo does not have.
  const hasCiCapability = context.capabilities.some((id) =>
    ["circleci", "buildkite"].includes(id),
  );

  // A capability that a selected superset both *provides the same contribution
  // as* and *depends on* is implied by that superset, so it is not listed as a
  // separate choice (SvelteKit provides `frontend` and depends on `svelte`, so a
  // SvelteKit project does not read as two frameworks). Narrow by design: it
  // only suppresses a dependency that is itself a contribution of the dependent.
  const listedCapabilities = (context.capabilities || []).filter((id) => {
    const provided = new Set(
      (capabilities.find((c) => c.id === id)?.provides ?? []).map(
        (entry) => entry.type,
      ),
    );
    if (provided.size === 0) return true;
    const subsumed = context.capabilities.some((otherId) => {
      if (otherId === id) return false;
      const shares = (
        capabilities.find((c) => c.id === otherId)?.provides ?? []
      ).some((entry) => provided.has(entry.type));
      return shares && dependsOnCapability(otherId, id);
    });
    return !subsumed;
  });

  const capabilitiesSection =
    listedCapabilities.length > 0
      ? `## Capabilities

This project includes the following capabilities:

${listedCapabilities
  .map((id) => {
    const cap = capabilities.find((c) => c.id === id);
    if (!cap) return `- ${id}`;
    const ciNote =
      id === "code-quality-python" && hasCiCapability
        ? " The generated CI pipeline also runs `ruff check`."
        : "";
    return `- **${cap.name}**: ${cap.description}${ciNote}`;
  })
  .join("\n")}
`
      : "";

  const pythonQuickstart = `## Setup

1. Clone the repository
2. Create a virtualenv and install the package with dev extras:

   \`\`\`bash
   python3 -m venv .venv
   . .venv/bin/activate
   pip install -e ".[dev]"
   \`\`\`

3. Run the checks:

   \`\`\`bash
   ruff check src tests
   pytest -v
   \`\`\`
`;

  // A MicroPython project's source runs on the board, not the host: there is
  // no installable package to `pip install`, and no host interpreter that can
  // import hardware modules, so the host-package quickstart would be wrong on
  // every line. Name the firmware commands instead.
  const micropythonQuickstart = `## Setup

1. Clone the repository and open it in the devcontainer — the MicroPython
   toolchain lives inside it (there is no host-side install to keep in sync).
2. Run the linter over the firmware:

   \`\`\`bash
   ruff check .
   \`\`\`

Firmware runs on the board, not on the host, so there is no host test step —
see "MicroPython board" for flashing and running it.
`;

  const rustQuickstart = `## Setup

1. Clone the repository
2. Build and run the checks:

   \`\`\`bash
   cargo build
   cargo test
   \`\`\`
`;

  // genproj generates a Java devcontainer and no build system, so there is no
  // build or test command to name here - say that rather than the node
  // quickstart, which would be wrong in every line.
  const javaQuickstart = `## Setup

1. Clone the repository
2. Add your build system (\`pom.xml\` or \`build.gradle\`) and its build/test
   commands - genproj generates a Java devcontainer, not a build system.
`;

  const nodeQuickstart = `## Setup

1. Clone the repository
2. Install dependencies:

   \`\`\`bash
   npm install
   \`\`\`

3. Run the dev server:

   \`\`\`bash
   npm run dev
   \`\`\`
`;

  const quickstarts = {
    python: pythonQuickstart,
    rust: rustQuickstart,
    java: javaQuickstart,
  };
  const quickstart = isMicropython(context)
    ? micropythonQuickstart
    : Object.hasOwn(quickstarts, language)
      ? // eslint-disable-next-line security/detect-object-injection
        quickstarts[language]
      : nodeQuickstart;

  // Name the CI provider that actually publishes the image. Buildkite wins
  // when both are selected, mirroring the deploy runbook, so a
  // buildkite-selected README never points at a CircleCI pipeline. With no CI
  // capability the image is built by hand, and the runbook says so.
  const ciProviderLabel = context.capabilities.includes("buildkite")
    ? "Buildkite"
    : context.capabilities.includes("circleci")
      ? "CircleCI"
      : "docker buildx";
  const deploySection = hasDocker
    ? `## Deployment

See \`deploy/README.md\` for the deployment runbook (${ciProviderLabel} -> GHCR ->
Watchtower -> Docker host). Deploy with:

\`\`\`bash
docker compose up -d
\`\`\`
`
    : "";

  // Round-5 (memo genproj-fixes-round5): document the one-time doppler setup
  // (the CLI is installed in the devcontainer; first use must link it).
  // Round-7 (memo Gi8CN7XqpH6CxFAc2YUJsK): document env>yaml precedence and
  // manual provisioning so a wrong-project resolution is never a mystery.
  // Doppler scaling memo (memos/doppler-scaling): repos default to the shared
  // `common` project; projectStrategy: 'new' opts into a dedicated project.
  const dopplerSection = context.capabilities.includes("doppler")
    ? (() => {
        const { project: dopplerProject, strategy } =
          resolveDopplerTarget(context);
        const provisioning =
          strategy === "new"
            ? `This project uses Doppler for secrets in its own \`${dopplerProject}\` project.
First use (links the project and \`dev\` config):

\`\`\`bash
doppler setup --project ${dopplerProject} --config dev
\`\`\`

If the project does not exist in your Doppler workplace yet, create it first:

\`\`\`bash
doppler projects create ${dopplerProject}
doppler configs create dev --project ${dopplerProject}
\`\`\``
            : `This project uses Doppler for secrets from the shared \`common\` project
(config \`dev\`) — no per-repo Doppler project is created. First use (links
the shared project and \`dev\` config):

\`\`\`bash
doppler setup --project common --config dev
\`\`\`

If your repo needs app-specific secrets that shouldn't live in the shared
\`common\` project, regenerate it with the doppler capability set to
\`projectStrategy: "new"\` to get a dedicated project.`;
        return `## Doppler

${provisioning}

The Doppler CLI is installed in the devcontainer — it must be on PATH for the
VS Code extension and \`doppler run\` to work. Auth is persisted via the host
\`~/.doppler\` bind-mount.

### Env-var precedence (read this if \`doppler run\` hits the wrong project)

Doppler resolves its target as **environment variables > \`doppler.yaml\` >
\`~/.doppler\` scoped config**. If your shell — or the session that launched
the devcontainer (e.g. an agent runtime) — exports \`DOPPLER_PROJECT\` /
\`DOPPLER_CONFIG\` / \`DOPPLER_ENVIRONMENT\`, those silently override this
repo's \`doppler.yaml\` and every \`doppler\` command targets the wrong
project. The devcontainer's post-create setup pins this repo's context
(\`${dopplerProject}\`/\`dev\`) in \`~/.bashrc\` and \`~/.zshrc\` and warns at
setup if resolution still mismatches. To force the correct context manually:

\`\`\`bash
unset DOPPLER_PROJECT DOPPLER_CONFIG DOPPLER_ENVIRONMENT
doppler setup --no-interactive --project ${dopplerProject} --config dev
\`\`\`
`;
      })()
    : "";

  // container-agent: the project's own agent is a thing the reader has to be
  // able to operate (start/stop/status) and to know the name of, because that
  // name is how the hub and every peer address it. The name is derived, so the
  // README states it rather than making the reader re-derive it.
  const containerAgentSection = context.capabilities.includes("container-agent")
    ? (() => {
        const agentName = `${projectName}-dev`;
        return `## The container's agent

This devcontainer brings up its own \`a2a-goose\` agent, registered in the hub as
\`${agentName}\` - one agent per repo, so a restart reclaims the same entry
instead of adding a second one. Turns are billed through the LiteLLM proxy
configured in Doppler (\`LITELLM_BASE_URL\`).

\`\`\`bash
scripts/agent-dev.sh start    # write secrets + config, fetch the launcher, run it
scripts/agent-dev.sh status   # running or not, the card URL, the log tail
scripts/agent-dev.sh stop     # SIGTERM, wait for a clean deregister, confirm gone
\`\`\`

\`start\` runs from the devcontainer's post-start hook, so the agent is normally
already up when you arrive. It fails open: with no network on a first start it
prints why it did not start and leaves the project usable. Secrets come from
Doppler into \`~/.config/a2a-goose/env\` (mode 0600) and never into the image or
\`containerEnv\`.
`;
      })()
    : "";

  // micropython: the board workflow carries three facts a reader cannot
  // rediscover cheaply -- the exact MicroPython build for the board, that
  // access is exclusive, and that the device grant is deliberately broad. The
  // grant's breadth is security-relevant, so the README states it plainly
  // rather than letting it be discovered by accident (capability spec §3e/§5).
  const micropythonSection = context.capabilities.includes("micropython")
    ? (() => {
        const micropythonConfig = context.configuration?.micropython || {};
        const board = micropythonConfig.board || "other";
        const chip = resolveMicropythonChip(context);
        // Product and chip are separate axes: the product names the hardware,
        // the chip selects the .uf2, and one product can ship with more than
        // one RP2 variant. The board line is therefore a name with no chip
        // baked in, and the chip line is derived from the `chip` axis (or the
        // Pico products' definitional chip), never from the product label.
        const boardNotes = {
          "pico-w": "This repo targets the **Raspberry Pi Pico W**.",
          "pico-2-w": "This repo targets the **Raspberry Pi Pico 2 W**.",
          "galactic-unicorn":
            "This repo targets the **Pimoroni Galactic Unicorn**. Its firmware lives at https://github.com/pimoroni/unicorn. The Galactic Unicorn has shipped with both RP2040 and RP2350 silicon, so this product name does **not** decide the chip - that is recorded separately below.",
          other: "This repo targets a MicroPython board.",
        };
        const chipNotes = {
          rp2040:
            "**Chip / build:** **RP2040** - install the **Pico W / RP2040** MicroPython build (`RPI_PICO_W`). A Pico 2 W (RP2350) build will not run on it.",
          rp2350:
            "**Chip / build:** **RP2350** - install the **Pico 2 W / RP2350** MicroPython build. A Pico W (RP2040) build will not run on it.",
          unknown:
            "**Chip / build:** not recorded for this repo - read it from the board before choosing a `.uf2` (below). The RP2040 and RP2350 builds are **not interchangeable**.",
        };
        return `## MicroPython board

${boardNotes[board] || boardNotes.other}

${chipNotes[chip] || chipNotes.unknown}

### Read the chip from the board, not the cable

The RP2 variant is the one thing here that must not be guessed. It is **not**
in the product name, it is **not** implied by the USB PID - \`2e8a:0005\`
identifies the MicroPython CDC firmware class and says nothing about whether
the silicon is RP2040 or RP2350. Ask the board:

\`\`\`bash
mpremote connect "$(scripts/find-board.sh)" exec 'import os; print(os.uname().machine)'
# e.g. "Raspberry Pi Pico W with RP2040"
\`\`\`

If that line and the \`chip\` in this repo's generator configuration disagree,
believe the board. Choosing the wrong \`.uf2\` fails at flash time with no
warning that the product name was ever the cause.

The toolchain lives **inside the devcontainer** — there is no host-side install
to keep in sync. OrbStack forwards the board's CDC-ACM REPL into the Linux VM
**automatically**, so you do **not** need \`orb usb attach\` for this device. A
container, however, only sees the node when the device is granted explicitly,
which this devcontainer does.

The board keeps its macOS node name inside the container
(\`/dev/tty.usbmodem<serial>\`), which **changes with the USB port**, so never
hard-code it. Resolve it at runtime:

\`\`\`bash
mpremote connect "$(scripts/find-board.sh)" exec 'print(1+1)'   # smoke test -> 2
\`\`\`

\`scripts/find-board.sh\` enumerates candidate ports and **probes** each one (a
MicroPython REPL answers immediately) rather than guessing from a count; more
than one \`tty.usbmodem\` node can be present.

### Access is exclusive

While the container holds the port, host tools such as Thonny (or a host-side
\`mpremote\`) cannot open it, and vice versa. Close Thonny before probing from
the container. The port is released when the container stops.

### The device grant is deliberately broad

This devcontainer grants the whole character-device cgroup class
(\`--device-cgroup-rule=c *:* rmw\`) and binds the host \`/dev\` in
(\`--volume=/dev:/dev\`). That is **not** scoped to the serial port: the
container can open any host character device. Scoping it is not expressible —
OrbStack assigns the node a *dynamic* character major, and the rule grammar
accepts only a single major or \`*\`, never a range or list — so a guessed
major fails with a silent \`EPERM\` on a node that looks perfectly present. It
is still strictly narrower than \`--privileged\`; set \`deviceAccess:
"privileged"\` only if the cgroup-rule mechanism stops working on a future
OrbStack. To pin a single node by hand (and accept that the devcontainer only
opens while the board is attached), replace the two runArgs with
\`--device=/dev/tty.usbmodem<serial>\`.
`;
      })()
    : "";

  // micropython: ruff's target-version cannot reach the board's language, so
  // the README states the residual gap instead of letting a green lint read as
  // a guarantee the board can parse the code. Firmware lives at the root and
  // in lib/, so the lint command covers the whole repository.
  const micropythonLintingSection = context.capabilities.includes("micropython")
    ? `## Linting firmware

Firmware is linted with \`${ruffCheckCommand(context)}\`, which covers the
repository root (\`main.py\`, \`config.py\`) and \`lib/\`.

Ruff cannot be told to target the board's MicroPython version. This board runs
**MicroPython 1.19.1**, whose language is roughly **CPython 3.4**, but ruff's
lowest \`target-version\` is **py37** — that is what \`pyproject.toml\` sets. The
lint is therefore a **floor, not a guarantee**:

- ruff **does** reject syntax newer than py37 — the walrus operator (\`:=\`),
  positional-only \`/\` parameters, and \`match\` statements.
- ruff **does not** reject 3.5–3.7 constructs the board may not parse —
  f-strings, \`async\`/\`await\`, variable annotations, and numeric underscores.

Keep firmware inside MicroPython's supported subset: a green ruff run alone
does not prove the board will parse the code.
`
    : "";

  const content = `# ${projectName}

${description}

${capabilitiesSection}
${quickstart}
${dopplerSection}
${deploySection}
${containerAgentSection}
${micropythonSection}
${micropythonLintingSection}
## Generated by genproj

This project was generated using the genproj tool.
`;

  return {
    filePath: "README.md",
    // Empty optional sections (doppler/deploy) leave 2+ blank lines behind;
    // collapse to a single blank line so prettier --check passes.
    content: content
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+/, "")
      .replace(/\n+$/, "\n"),
  };
}

function pushWranglerFiles(
  templateEngine,
  context,
  files,
  projectName,
  compatibilityDate,
) {
  const hasDoppler = context.capabilities.includes("doppler");
  const hasSvelteKit = context.capabilities.includes("sveltekit");
  // Doppler scaling memo: the doppler project is `common` by default.
  const dopplerProject = resolveDopplerTarget(context).project;
  const wranglerConfig = context.configuration?.["cloudflare-wrangler"] || {};
  const isRustWorker = wranglerConfig.workerType === "rust";

  let mainEntryPoint = "src/index.js";
  if (hasSvelteKit) {
    mainEntryPoint = ".svelte-kit/cloudflare/_worker.js";
  } else if (isRustWorker) {
    mainEntryPoint = "build/worker/index.js";
  }

  const assetsConfig = hasSvelteKit
    ? ',\n\t"assets": {\n\t\t"binding": "ASSETS",\n\t\t"directory": ".svelte-kit/cloudflare"\n\t}'
    : "";

  const buildConfig = isRustWorker
    ? ',\n\t"build": {\n\t\t"command": "cargo install -q worker-build && worker-build --release"\n\t}'
    : "";

  files.push({
    filePath: "scripts/run-wrangler-dev.sh",
    content: templateEngine.generateFile("scripts-run-wrangler-dev-sh", {
      ...context,
      projectName,
      dopplerProject,
    }),
  });

  if (hasDoppler) {
    files.push(
      {
        filePath: "wrangler.template.jsonc",
        content: templateEngine.generateFile("wrangler-template-jsonc", {
          ...context,
          projectName,
          compatibilityDate,
          mainEntryPoint,
          assetsConfig,
          buildConfig,
        }),
      },
      {
        filePath: "scripts/setup-wrangler-config.sh",
        content: templateEngine.generateFile(
          "scripts-setup-wrangler-config-sh",
          context,
        ),
      },
    );
  } else {
    files.push({
      filePath: "wrangler.jsonc",
      content: templateEngine.generateFile("wrangler-jsonc", {
        ...context,
        projectName,
        compatibilityDate,
        mainEntryPoint,
        assetsConfig,
        buildConfig,
      }),
    });
  }
}

export function generateCloudLoginFiles(templateEngine, context) {
  const files = [];
  const hasWrangler = context.capabilities.includes("cloudflare-wrangler");
  const hasDoppler = context.capabilities.includes("doppler");
  const hasGoogleCloud = context.capabilities.includes("google-cloud");
  const hasDevcontainer = context.capabilities.some((c) =>
    c.startsWith("devcontainer-"),
  );

  if (!hasWrangler && !hasDoppler && !hasGoogleCloud && !hasDevcontainer)
    return files;

  const projectName = context.projectName || context.name || "my-project";
  const compatibilityDate = new Date().toISOString().split("T")[0];

  // Doppler scaling memo (memos/doppler-scaling): the doppler project a
  // repo points at is `common` by default (projectStrategy: 'new' opts into
  // a dedicated project). All doppler CLI references in the login/setup
  // scripts must use the RESOLVED project, not the repo name.
  const dopplerProject = resolveDopplerTarget(context).project;

  // cloud_login.sh
  const dopplerLogin = hasDoppler
    ? DOPPLER_LOGIN_SCRIPT.replaceAll(
        "{{dopplerProject}}",
        () => dopplerProject,
      )
    : "";

  const wranglerLogin = hasWrangler
    ? WRANGLER_LOGIN_SCRIPT.replaceAll(
        "{{dopplerProject}}",
        () => dopplerProject,
      )
    : "";

  const setupWrangler =
    hasDoppler && hasWrangler
      ? SETUP_WRANGLER_SCRIPT.replaceAll(
          "{{dopplerProject}}",
          () => dopplerProject,
        )
      : "";

  const googleCloudLogin = hasGoogleCloud
    ? `gcloud auth login && gcloud config set project ${projectName}`
    : "";

  const tailscaleLogin = hasDevcontainer
    ? `# Tailscale login\nif command -v tailscale &> /dev/null; then\n  if ! pgrep -x tailscaled > /dev/null; then\n    echo "INFO: Starting Tailscale daemon..."\n    sudo tailscaled --state=/var/lib/tailscale/tailscaled.state > /dev/null 2>&1 &\n    sleep 2\n  fi\n  if ! sudo tailscale status &> /dev/null; then\n    echo "INFO: Logging into Tailscale..."\n    sudo tailscale up --hostname=${projectName}\n  else\n    echo "✅ Already logged in to Tailscale."\n  fi\nfi`
    : "";

  files.push({
    filePath: "scripts/cloud_login.sh",
    content: templateEngine.generateFile("scripts-cloud-login-sh", {
      ...context,
      tailscaleLogin,
      dopplerLogin,
      wranglerLogin,
      setupWrangler,
      googleCloudLogin,
    }),
  });

  if (hasWrangler) {
    pushWranglerFiles(
      templateEngine,
      context,
      files,
      projectName,
      compatibilityDate,
    );
  }

  if (hasWrangler && hasDoppler) {
    files.push({
      filePath: "scripts/sync-doppler-secrets.sh",
      content: templateEngine.generateFile("scripts-sync-doppler-secrets-sh", {
        ...context,
        projectName,
        dopplerProject,
      }),
    });
  }

  return files;
}

export function generateGitignoreFile(templateEngine, context) {
  const hasDoppler = context.capabilities.includes("doppler");
  const hasWrangler = context.capabilities.includes("cloudflare-wrangler");
  const hasPython = context.capabilities.some((c) =>
    c.startsWith("devcontainer-python"),
  );
  const hasJava = context.capabilities.some((c) =>
    c.startsWith("devcontainer-java"),
  );
  const hasDagster = context.capabilities.includes("dagster");

  let wranglerIgnore = "";
  if (hasWrangler) {
    wranglerIgnore = "\n# Cloudflare Wrangler\n.wrangler";
    if (hasDoppler) {
      wranglerIgnore += "\nwrangler.jsonc";
    }
  }

  let pythonIgnore = hasPython
    ? "\n# Python\n__pycache__/\n*.py[cod]\n*$py.class\n.venv\nvenv/\n*.manifest\n*.egg-info/"
    : "";

  if (hasDagster) {
    pythonIgnore += "\n\n# Dagster\n.tmp_dagster*";
  }
  const javaIgnore = hasJava
    ? "\n# Java\n*.class\n*.log\n*.ctxt\n.mtj.tmp/\n*.jar\n*.war\n*.nar\n*.ear\n*.zip\n*.tar.gz\n*.rar\ntarget/"
    : "";

  const wranglerConfig = context.configuration?.["cloudflare-wrangler"] || {};
  const isRustWorker = hasWrangler && wranglerConfig.workerType === "rust";
  const hasRust =
    context.capabilities.some((c) => c.startsWith("devcontainer-rust")) ||
    isRustWorker;
  // The lockfile is deliberately NOT ignored: the generated pipeline builds
  // with `cargo build --locked`, which fails outright when Cargo.lock is
  // missing, so a repo that ignored it could never pass its own build.
  const rustIgnore = hasRust
    ? "\n# Rust\ntarget/\n**/target/\n.rustc_info.json\n**/.rustc_info.json"
    : "";

  return {
    filePath: ".gitignore",
    content: templateEngine.generateFile("gitignore", {
      ...context,
      wranglerIgnore,
      pythonIgnore,
      javaIgnore,
      rustIgnore,
    }),
  };
}

export function generatePrettierIgnoreFile() {
  // Generated infra files are machine output (or build templates) and are
  // excluded from `prettier --check` so a generated project's lint step
  // passes. `.agents/` holds MCP config + proxy scripts; the wrangler
  // template JSONC is consumed by a setup script, not hand-edited.
  return {
    filePath: ".prettierignore",
    content: `# Generated infra files (machine output) excluded from prettier --check.
.agents/
coverage/
wrangler.template.jsonc
`,
  };
}

export function generateVscodeSettingsFile(templateEngine, context) {
  const hasPython =
    Array.isArray(context.capabilities) &&
    context.capabilities.some((c) => c.startsWith("devcontainer-python"));

  const content = templateEngine.generateFile("vscode-settings-json", {
    ...context,
    projectName: context.projectName || context.name || "my-project",
  });

  let settings;
  try {
    settings = JSON.parse(content);
    if (!hasPython) {
      delete settings["python.defaultInterpreterPath"];
    }
    return {
      filePath: ".vscode/settings.json",
      content: `${JSON.stringify(settings, undefined, 2)}\n`,
    };
  } catch {
    // Fallback for tests that mock template engine to return non-JSON
    return {
      filePath: ".vscode/settings.json",
      content,
    };
  }
}

export function generateVscodeExtensionsFile() {
  const content = `${JSON.stringify(
    {
      recommendations: [
        "pcassidy75.tmux-integrated",
        "vsc-mermaid.mermaid-preview",
      ],
    },
    undefined,
    2,
  )}\n`;
  return {
    filePath: ".vscode/extensions.json",
    content,
  };
}

export function generateAgentRulesFiles() {
  const gitGuidelines = `# Git, Code Review, and Deployment Rules

- **Commit Changes**: You may run \`git commit\` to package your work. Use clear, descriptive commit messages and keep commits atomic (logical groups of related changes).
- **Push Changes**: You may run \`git push\` to push commits to the remote. Follow the repository's branch workflow (a \`fix/\`/\`feature/\` branch + PR, or pushing directly where that is the convention).
- **Checks are your safety net**: This repo runs CI/code checks, so prefer to run the relevant local checks/tests before pushing; CI validates the rest.
- **No Deployments**: Never run \`wrangler deploy\`, \`npm run deploy\`, or any other deployment command to push code to the production/default environment.
`;

  const testingGuidelines = `# Testing Guidelines

## Run Focused Tests on Changed Files Only

When running tests, always scope them to the files that have actually changed rather than running the full test suite. This keeps feedback fast and avoids noise from unrelated tests.

### How to identify changed files

Use \`git\` to find what has changed relative to the working directory:

\`\`\`bash
# Unstaged + staged changes (everything modified vs HEAD)
git diff --name-only HEAD
\`\`\`

Then map each changed source file to its corresponding test file:

| Source file      | Test file             |
| ---------------- | --------------------- |
| \`src/browser.ts\` | \`src/browser.test.ts\` |
| \`src/index.ts\`   | \`src/index.test.ts\`   |

### Running focused tests with Vitest

Pass the test file(s) directly to Vitest to limit the run:

\`\`\`bash
# Single test file
npx vitest run src/browser.test.ts

# Multiple test files
npx vitest run src/browser.test.ts src/index.test.ts

# With coverage for the specific files only
npx vitest run --coverage src/browser.test.ts
\`\`\`

### Full suite

Only run the full suite (\`npm test\`) when:

- You have changed shared utilities used by many tests, or
- You are doing a final pre-commit validation of a large change set.
`;

  return [
    { filePath: ".agents/.rules/git_guidelines.md", content: gitGuidelines },
    {
      filePath: ".agents/.rules/testing_guidelines.md",
      content: testingGuidelines,
    },
  ];
}

export function generateCargoToml(context) {
  const hasWrangler = context.capabilities.includes("cloudflare-wrangler");
  const wranglerConfig = context.configuration?.["cloudflare-wrangler"] || {};
  const isRustWorker = hasWrangler && wranglerConfig.workerType === "rust";

  if (!isRustWorker) return;

  const projectName = context.projectName || context.name || "my-project";
  const content = `[package]
name = "${projectName}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
worker = { version = "0.8.5", features = ["d1"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[profile.release]
opt-level = "s"
lto = true
`;

  return {
    filePath: "worker/Cargo.toml",
    content,
  };
}

/**
 * The minimal cargo package a generated Rust project builds and releases.
 *
 * Every other language genproj generates ships a buildable hello-world: node a
 * `package.json` plus `vite.config.js`, python a `pyproject.toml` with a
 * `__main__` and a smoke test. Rust shipped only a devcontainer, so the
 * generated pipeline's `cargo build --locked` - and the docker-container build
 * stage's `COPY Cargo.toml` - failed on the first push with
 * "could not find `Cargo.toml` in ... or any parent directory": a project that
 * looks generated and cannot build. This is the Rust half of that parity.
 *
 * The binary cargo produces is named by {@link cargoPackageName}, the same name
 * the build step copies to `build/<target>/bin/` and the Dockerfile copies onto
 * PATH, so the manifest and both consumers agree.
 *
 * `Cargo.lock` is emitted with the manifest because the pipeline builds with
 * `--locked`, for which a missing lockfile is a hard error rather than a
 * resolution - the two are one artifact, and `.gitignore` deliberately does not
 * ignore the lockfile for that reason.
 *
 * @param {Object} context - Generation context (capabilities, configuration)
 * @returns {Object[]} Cargo.toml, Cargo.lock and src/main.rs, or [] for a
 *   project whose primary language is not rust
 */
export function generateRustCrateFiles(context) {
  if (resolveProjectLanguage(context) !== "rust") return [];

  const packageName = cargoPackageName(
    context.projectName || context.name || "my-project",
  );
  const harness = servingHarnessSpec(context);

  return [
    {
      filePath: "Cargo.toml",
      content: `[package]
name = "${packageName}"
version = "0.1.0"
edition = "2021"
`,
    },
    {
      // A lockfile for a dependency-free package: nothing to resolve, so it
      // never needs updating and `--locked` always accepts it.
      filePath: "Cargo.lock",
      content: `# This file is automatically @generated by Cargo.
# It is not intended for manual editing.
version = 3

[[package]]
name = "${packageName}"
version = "0.1.0"
`,
    },
    {
      filePath: "src/main.rs",
      content: harness
        ? buildRustServingHarness(harness)
        : `fn main() {
    println!("${packageName} is running.");
}
`,
    },
  ];
}

/**
 * The Rust half of the serving harness (see `servingHarnessSpec`).
 *
 * It is the smallest server that honours the container contract the generated
 * Dockerfile declares - binds the exposed port, answers the healthcheck, serves
 * the built frontend, 404s everything else - and it uses the **standard
 * library only**. That is deliberate:
 *
 *   - The generated crate is dependency-free, so its `Cargo.lock` is a
 *     dependency-free lock that `cargo build --locked` (the generated build
 *     step) always accepts. A web framework (axum + tokio, or even bare hyper)
 *     would add a transitive graph the generator cannot emit a matching
 *     `Cargo.lock` for - the committed lock would be stale and every `--locked`
 *     build would fail before it ran.
 *   - `cargo fetch` / `cargo build --release` in the Docker build stage keep
 *     working with no network-resolved crates.
 *
 * The tradeoff is a hand-rolled HTTP/1.1 reply loop instead of a framework.
 * It is a harness, not an application: the wire protocol and business
 * endpoints are the developer's to add, at which point they can bring in
 * whatever framework they like.
 *
 * @param {{port: number, staticDirectory: string, healthPath: string}} harness
 * @returns {string} The `src/main.rs` source
 */
export function buildRustServingHarness(harness) {
  return `//! Minimal serving harness (generated by genproj).
//!
//! Binds \`0.0.0.0:${harness.port}\`, answers \`GET ${harness.healthPath}\` with
//! \`200\` and a JSON body, and serves the built frontend from
//! \`${harness.staticDirectory}\`. This is the *harness* genproj guarantees: the
//! container comes up, serves the UI, and passes its own HEALTHCHECK. The wire
//! protocol and business endpoints are yours - replace this file with your
//! application.
//!
//! Deliberately dependency-free (standard library only), so the generated
//! crate's \`Cargo.lock\` stays valid for \`cargo build --locked\`.

use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;

const DEFAULT_PORT: u16 = ${harness.port};
const HEALTH_PATH: &str = "${harness.healthPath}";
// JSON, not a bare "ok": Homepage's \`customapi\` widget parses the health body
// as JSON, so a plain-text reply makes the dashboard tile error.
const HEALTH_BODY: &str = r#"{"status": "ok"}"#;
const STATIC_DIR: &str = "${harness.staticDirectory}";

fn main() {
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    let listener = match TcpListener::bind(("0.0.0.0", port)) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("failed to bind 0.0.0.0:{port}: {error}");
            std::process::exit(1);
        }
    };
    println!("serving {STATIC_DIR} on http://0.0.0.0:{port}");
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                thread::spawn(move || {
                    if let Err(error) = handle(stream) {
                        eprintln!("request failed: {error}");
                    }
                });
            }
            Err(error) => eprintln!("accept failed: {error}"),
        }
    }
}

fn handle(mut stream: TcpStream) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }
    // Drain the remaining headers so the client finishes writing.
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 || line == "\\r\\n" || line == "\\n" {
            break;
        }
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    let path = target.split('?').next().unwrap_or("/");

    if method != "GET" && method != "HEAD" {
        return respond(
            &mut stream,
            405,
            "text/plain; charset=utf-8",
            b"method not allowed",
        );
    }
    if path == HEALTH_PATH {
        return respond(
            &mut stream,
            200,
            "application/json",
            HEALTH_BODY.as_bytes(),
        );
    }
    match static_file(path) {
        Some(file) => {
            let body = fs::read(&file)?;
            respond(&mut stream, 200, content_type(&file), &body)
        }
        None => respond(&mut stream, 404, "text/plain; charset=utf-8", b"not found"),
    }
}

/// Resolve a request path to a file under STATIC_DIR, refusing traversal.
fn static_file(path: &str) -> Option<PathBuf> {
    let relative = path.trim_start_matches('/');
    let relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };
    let root = Path::new(STATIC_DIR).canonicalize().ok()?;
    let mut candidate = root.join(relative);
    if candidate.is_dir() {
        candidate = candidate.join("index.html");
    }
    let resolved = candidate.canonicalize().ok()?;
    if resolved.starts_with(&root) && resolved.is_file() {
        Some(resolved)
    } else {
        None
    }
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn respond(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "OK",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\\r\\n\\
         Content-Type: {content_type}\\r\\n\\
         Content-Length: {}\\r\\n\\
         Connection: close\\r\\n\\r\\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}
`;
}

export function generateRustWorkerLibrary(context) {
  const hasWrangler = context.capabilities.includes("cloudflare-wrangler");
  const wranglerConfig = context.configuration?.["cloudflare-wrangler"] || {};
  const isRustWorker = hasWrangler && wranglerConfig.workerType === "rust";

  if (!isRustWorker) return;

  const content = `use worker::*;

#[event(fetch)]
pub async fn main(req: Request, env: Env, ctx: Context) -> Result<Response> {
    Response::ok("Hello, World!")
}
`;

  return {
    filePath: "worker/src/lib.rs",
    content,
  };
}

/**
 * Collapses runs of blank lines in generated YAML to a single blank line and
 * strips leading/trailing blank lines, matching what `prettier --check`
 * expects (prettier treats 2+ consecutive blank lines in YAML as a style
 * error). The CircleCI template composes sections via blank-line separators,
 * so empty optional sections can otherwise leave 2-3 blank lines behind.
 * @param {string} content - Raw generated YAML content
 * @returns {string} Normalized YAML content
 */
export function normalizeYamlBlankLines(content) {
  return content
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n");
}

export async function generateAllFiles(context) {
  // Fail before emitting anything: a project that silently resolves order-
  // dependently is worse than one that refuses to generate, and a build matrix
  // that cannot produce the artifacts it declares is worse than no matrix.
  validatePrimaryLanguage(context);
  validateReleaseTargets(context);
  validateFetchLaunch(context);
  validateRequiredAny(context);

  const templateEngine = new TemplateEngine();
  await templateEngine.initialize();

  const developmentContainerCapabilities = context.capabilities.filter((c) =>
    c.startsWith("devcontainer-"),
  );
  const otherCapabilities = context.capabilities.filter(
    (c) => !c.startsWith("devcontainer-"),
  );

  const cloudLoginFiles = generateCloudLoginFiles(templateEngine, context);

  const otherFiles = [
    generatePackageJson(templateEngine, context),
    ...generatePyProjectToml(context),
    generateCargoToml(context),
    generateRustWorkerLibrary(context),
    ...generateRustCrateFiles(context),
    generateGitignoreFile(templateEngine, context),
    generatePrettierIgnoreFile(),
    generateVscodeSettingsFile(templateEngine, context),
    generateVscodeExtensionsFile(),
    generateNpmrcFile(context),
    // 2.5: root README (language-aware quickstart).
    generateReadmeFile(context),
  ].filter(Boolean);

  let allGeneratedFiles = [
    ...collectNonDevelopmentContainerFiles(
      templateEngine,
      context,
      otherCapabilities,
    ),
    ...generateMergedDevelopmentContainerFiles(
      templateEngine,
      context,
      developmentContainerCapabilities,
    ),
    ...cloudLoginFiles,
    ...otherFiles,
    ...generateAgentRulesFiles(),
  ];

  // Svelte-in-a-non-node-project relocates the whole frontend into its own
  // directory (see sveltePrefix). Everything node/SvelteKit-owned moves with
  // it - the manifest, .npmrc, vite config and test files - so the npm install
  // in CI and the Docker frontend stage run from one root.
  const svelte = sveltePrefix(context);
  const relocate = (file) =>
    file ? { ...file, filePath: `${svelte}${file.filePath}` } : file;
  if (svelte) {
    const relocateInPlace = (suffix) => {
      allGeneratedFiles = allGeneratedFiles.map((file) =>
        file.filePath === suffix
          ? { ...file, filePath: `${svelte}${suffix}` }
          : file,
      );
    };
    for (const suffix of ["package.json", ".npmrc", "vite.config.js"]) {
      relocateInPlace(suffix);
    }
  }

  if (context.capabilities.includes("devcontainer-node")) {
    // Filter out any template-generated vite.config.js (at the root, or under
    // the Svelte directory when the frontend was relocated).
    allGeneratedFiles = allGeneratedFiles.filter(
      (f) => f.filePath !== `${svelte}vite.config.js`,
    );
    allGeneratedFiles.push(relocate(generateViteConfigFile(context)));
  }

  // Generated SvelteKit projects ship a smoke test so the coverage gate in
  // vite.config.js is satisfiable on a fresh project (otherwise vitest fails
  // with "no test files found" and 0% coverage on every first build).
  if (
    context.capabilities.includes("devcontainer-node") &&
    context.capabilities.includes("sveltekit")
  ) {
    // The /health route is generated for docker-container SvelteKit apps whose
    // primary language is node (the Node server serves it); a non-node primary
    // uses adapter-static and the language's server owns /healthz, so no
    // +server.js is emitted there. Derive its presence from the capabilities
    // rather than scanning the file list.
    const hasHealth =
      context.capabilities.includes("docker-container") &&
      context.capabilities.includes("sveltekit") &&
      resolveProjectLanguage(context) === "node";
    allGeneratedFiles.push({
      filePath: `${svelte}src/test-setup.js`,
      content: 'import "@testing-library/jest-dom/vitest";\n',
    });
    allGeneratedFiles.push({
      filePath: `${svelte}tests/smoke.test.js`,
      content: buildSveltekitSmokeTest(hasHealth),
    });
  }

  if (context.capabilities.includes("sonarcloud")) {
    const sonarCloudFile = allGeneratedFiles.find(
      (f) => f.filePath === ".sonarcloud.properties",
    );
    const sonarContent = sonarCloudFile ? sonarCloudFile.content : "";
    allGeneratedFiles.push({
      filePath: "sonar-project.properties",
      content: sonarContent,
    });
  }

  // 2.2: a docker-container SvelteKit app whose primary language is node needs
  // a /health route for the container HEALTHCHECK and the Homepage widget. A
  // non-node primary uses adapter-static: a +server.js route cannot be
  // prerendered, and the language's own server owns /healthz (see the generated
  // frontend README), so none is emitted.
  if (
    context.capabilities.includes("sveltekit") &&
    context.capabilities.includes("docker-container") &&
    resolveProjectLanguage(context) === "node"
  ) {
    allGeneratedFiles.push({
      filePath: `${svelte}src/routes/health/+server.js`,
      content: HEALTH_ROUTE_SOURCE,
    });
  }

  // adapter-static needs every route prerenderable, and it has no fallback
  // page by default. A root layout that prerenders everything turns the app
  // into the static bundle the language's server serves (and keeps the build
  // from erroring on a non-prerenderable route).
  if (
    context.capabilities.includes("sveltekit") &&
    resolveProjectLanguage(context) !== "node"
  ) {
    allGeneratedFiles.push({
      filePath: `${svelte}src/routes/+layout.js`,
      content:
        "// adapter-static: every route is rendered to static assets at build\n" +
        "// time; the primary language's server serves them. See README.md.\n" +
        "export const prerender = true;\n",
    });
  }

  // A relocated frontend gets a README stating the contract: where the built
  // assets land, and that the primary language's server serves them and owns
  // /healthz. Without it the seam is invisible and the first person to wire up
  // the serving path has to reverse-engineer it from the Dockerfile.
  if (hasFrontend(context) && svelte) {
    allGeneratedFiles.push({
      filePath: `${svelte}README.md`,
      content: buildSvelteFrontendReadme(context),
    });
  }

  // Deterministic last-wins dedupe over the whole file set. Capability
  // templates are collected first (already deduped among themselves), then the
  // project-level generated files (package.json, vite.config.js, README, ...)
  // — which supersede any capability's base copy of the same path. A capability
  // that emits a file another generator also owns (svelte's base package.json /
  // vite.config.js) therefore records the base without ever clobbering the
  // authoritative producer. A `Map` keeps the first-seen position and the
  // last-seen value, so output order is stable.
  allGeneratedFiles = [
    ...new Map(allGeneratedFiles.map((file) => [file.filePath, file])).values(),
  ];

  return allGeneratedFiles;
}

/**
 * Documents the frontend sub-build seam: where the Svelte build output lands
 * and how the primary-language build consumes it. The Rust/Python/Java binary
 * decides *how* to consume it (embed with `rust-embed` / `include_dir!`, or
 * serve from disk) - genproj generates the build, not the embed mechanism.
 * @param {Object} context - Generation context
 * @returns {string} The README source
 */
export function buildSvelteFrontendReadme(context) {
  const language = resolveProjectLanguage(context);
  const directory = resolveSvelteDirectory(context);
  const outputDirectory = resolveSvelteOutputDirectory(context);
  const frontendCapability = frontendCapabilityId(context);
  const framework =
    frontendCapability === "sveltekit"
      ? "SvelteKit (adapter-static)"
      : "Svelte";
  const harness = servingHarnessSpec(context);
  const entryPointFile =
    language === "rust" ? "src/main.rs" : `src/<pkg>/__main__.py`;
  const servingParagraph = harness
    ? `genproj scaffolds a **minimal serving harness** as the \`${language}\`
entry point (\`${entryPointFile}\`): it binds \`0.0.0.0\` on the container port
(${harness.port} unless \`docker-container.exposePort\` says otherwise), serves
\`${directory}/${outputDirectory}\`, answers the declared healthcheck path with
200, and 404s everything else. That is what makes the container come up and pass
its own \`HEALTHCHECK\` - the harness half of the project.

The **domain half is yours**: the wire protocol, the business endpoints, and
anything you want the server to do beyond serving the UI. Replace the harness
(and its standard-library-only constraint) with your application whenever you
are ready.`
    : `genproj does not scaffold a server for this language yet, so the
\`${language}\` app owns the entry point: implement the static file route and the
healthcheck path yourself. The built assets are already copied into the image.`;
  return `# Frontend (${framework})

This directory holds the project's Svelte app. It is a **sub-build**: the
project's primary language is \`${language}\`, and this app is built to **static
assets** that the \`${language}\` server serves. There is no adapter and no server
of its own here — a plain Vite build, or SvelteKit's \`adapter-static\`.

## Where the build output lands

\`npm run build\` writes the static assets to \`${directory}/${outputDirectory}\`.

## Who serves it

The **\`${language}\` server is the web server**. There is **no Node runtime** in
the image: the frontend is built here and its \`${directory}/${outputDirectory}\`
output is copied into the image by the Dockerfile.

${servingParagraph}

## How it is built

- **CI** builds this directory in its own \`.buildkite/pipeline.yml\` step (on a
  Node image), before the \`${language}\` build, so a broken frontend fails CI
  rather than being discovered at image-build time.
- **Docker** builds it in a \`frontend\` stage in the root \`Dockerfile\` and copies
  \`${directory}/${outputDirectory}\` into the \`${language}\` build stage and the
  runtime image.

## Working on it locally

\`\`\`sh
cd ${directory}
npm install
npm run dev
\`\`\`
`;
}

/**
 * Builds the smoke test shipped with generated SvelteKit projects. It renders
 * the home page and (when present) exercises the /health route, giving the
 * generated project real tests to satisfy the coverage gate.
 * @param {boolean} hasHealth - Whether a src/routes/health/+server.js is generated
 * @returns {string} The smoke test source
 */
export function buildSveltekitSmokeTest(hasHealth) {
  // Must be Prettier-clean on generation (double quotes, 2-space indent), since
  // the CircleCI lint step runs `prettier --check .`.
  //
  // Renders the generated home page (covers its component code so the
  // enforced coverage gate passes) and, when present, exercises the /health
  // route. Requires the jsdom environment + svelteTesting() plugin from
  // vite.config.js and the jest-dom matchers in src/test-setup.js.
  const healthImport = hasHealth
    ? 'import { GET } from "../src/routes/health/+server.js";\n'
    : "";
  const healthTest = hasHealth
    ? `
  it("health endpoint returns ok", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });`
    : "";
  return `import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import Page from "../src/routes/+page.svelte";
${healthImport}
describe("generated app smoke test", () => {
  it("renders the home page with the initial counter", () => {
    render(Page);
    expect(screen.getByText("Welcome to SvelteKit")).toBeInTheDocument();
    expect(screen.getByRole("button").textContent).toContain("0");
  });
  it("increments the counter on click", () => {
    render(Page);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(btn.textContent).toContain("1");
  });${healthTest}
});
`;
}

export function generateViteConfigFile(context) {
  const hasSvelteKit = context.capabilities.includes("sveltekit");
  const hasSvelte = hasFrontend(context) && !hasSvelteKit;

  // Coverage is reported (lcov feeds SonarCloud) and thresholds ARE enforced:
  // generated SvelteKit projects ship a smoke test that satisfies them (see
  // buildSveltekitSmokeTest). Branches stays at 50 because a placeholder
  // counter page inherently caps there; statements/functions/lines are gated
  // at 80. Users don't have to remember to re-enable the gate.
  const coverageConfig = `    coverage: {
      reporter: ["lcov", "text"],
      thresholds: {
        statements: 80,
        branches: 50,
        functions: 80,
        lines: 80,
      },
    },`;

  const testConfigSvelte = `  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test-setup.js"],
    reporter: ["default", "junit"],
    outputFile: {
      junit: "./reports/junit.xml",
    },
${coverageConfig}
  },`;

  // `passWithNoTests` is set for the vanilla config only. A bare Node scaffold
  // generates no test files at all (unlike SvelteKit, which ships a smoke test),
  // and vitest exits 1 with "No test files found" - so a freshly generated
  // project's first CI run was red for having nothing to test yet. The SvelteKit
  // variant keeps the strict gate, because it does have a test.
  const testConfigVanilla = `  test: {
    passWithNoTests: true,
    reporter: ["default"],
${coverageConfig}
  },`;

  let content;

  if (hasSvelteKit) {
    content = `import { sveltekit } from "@sveltejs/kit/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit(), svelteTesting()],
${testConfigSvelte}
});
`;
  } else if (hasSvelte) {
    // Plain Svelte + Vite. No component smoke test is generated for a bare
    // Svelte app, so the test config tolerates no test files (mirrors the bare
    // Node scaffold) while keeping the coverage gate for when tests are added.
    content = `import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
${testConfigVanilla}
});
`;
  } else {
    content = `import { defineConfig } from "vitest/config";

export default defineConfig({
${testConfigVanilla}
});
`;
  }

  return {
    filePath: "vite.config.js",
    content,
  };
}
