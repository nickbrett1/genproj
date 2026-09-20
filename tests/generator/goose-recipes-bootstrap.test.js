import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  generateGooseSetupScript,
  generateAllFiles,
  TemplateEngine,
} from "../../src/generator/file-generator.js";

/**
 * Runs the config-writing half of a generated goose setup script against a
 * throwaway HOME. Everything from the `CONFIG=` assignment up to (not
 * including) the recipes bootstrap is the block under test; the recipes clone
 * is deliberately left out so the test needs no network.
 *
 * @param {string} script The generated setup script text.
 * @param {string} home Dashed temp dir to use as $HOME.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} The run.
 */
function runConfigWrite(script, home) {
  const start = script.indexOf('CONFIG="$HOME/.config/goose/config.yaml"');
  const end = script.indexOf('echo "INFO: Ensuring goose recipes');
  const block = script.slice(start, end);
  return spawnSync("bash", ["-c", block], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
}

/**
 * Seeds a throwaway $HOME with a goose `config.yaml` and runs the generated
 * config-writing block against it.
 *
 * @param {string} script The generated setup script text.
 * @param {string|null} initial Contents to seed the config with (null = no file).
 * @returns {{configPath: string, output: string, written: string}} Result.
 */
function runWithConfig(script, initial) {
  const home = mkdtempSync(join(tmpdir(), "goose-home-"));
  mkdirSync(join(home, ".config", "goose"), { recursive: true });
  const configPath = join(home, ".config", "goose", "config.yaml");
  if (initial !== null) writeFileSync(configPath, initial);
  const run = runConfigWrite(script, home);
  expect(run.status).toBe(0);
  return {
    configPath,
    output: run.stdout + run.stderr,
    written: readFileSync(configPath, "utf8"),
  };
}

describe("goose recipes bootstrap in generated projects", () => {
  const ctx = { capabilities: ["coding-agents", "doppler"], configuration: {} };

  it("writes an extensions-only config.yaml when none exists (MCPHub dev group default)", () => {
    const script = generateGooseSetupScript(ctx);
    // Migration (goose-mcp-groups-migration §4): with no host ~/.config/goose
    // bind-mount, genproj now WRITES ~/.config/goose/config.yaml when absent
    // (extensions only). mcphub-dev → MCPHub `dev` group, auth-off.
    expect(script).toContain("cat > \"$CONFIG\" <<'GOOSECFGEOF'");
    expect(script).toContain("GOOSECFGEOF");
    expect(script).toContain("extensions:");
    expect(script).toContain("mcphub-dev:");
    expect(script).toContain("uri: http://nas:8781/mcp/dev");
    // Extensions-only: NO provider block is emitted (resolves from Doppler env).
    expect(script).not.toContain("provider:");
  });

  it("merges into an existing config: it is not the old write-if-absent, and it never replaces the file", () => {
    const script = generateGooseSetupScript(ctx);
    // The old write was a bare `if [ -f "$CONFIG" ]; then keep`, which skipped
    // the project config forever once goose had created its own (telemetry-only)
    // config — measured on a2a-goose, 2026-09-20 (see file-generator.js).
    expect(script).not.toContain('if [ -f "$CONFIG" ]; then');
    expect(script).toContain('if [ ! -f "$CONFIG" ]');
    // Existing configs are edited in place: only the keys that are missing are
    // inserted under the existing top-level `extensions:` key.
    expect(script).toContain('grep -q "^[[:space:]]*$KEY:" "$CONFIG"');
    expect(script).toContain('MISSING="$MISSING $KEY"');
    expect(script).toContain(
      "Merged project goose extensions into the existing extensions: section",
    );
  });

  it("drops per-cap circleci (covered by dev) but keeps sonarqube as an exception (not in dev)", () => {
    const script = generateGooseSetupScript({
      capabilities: ["circleci", "sonarcloud", "doppler", "coding-agents"],
      configuration: {},
    });
    // mcphub-dev is the default toolset regardless of capabilities.
    expect(script).toContain("mcphub-dev:");
    // circleci is carried by the dev group (circleci-lite) → no stdio block.
    expect(script).not.toContain("@circleci/mcp-server-circleci");
    expect(script).not.toContain("CIRCLECI_TOKEN");
    // sonarqube is NOT in the dev group → kept as a doppler-wrapped exception.
    expect(script).toContain("sonarqube:");
    expect(script).toContain("cmd: doppler");
    expect(script).toContain("sonarqube-mcp-server");
    expect(script).not.toContain("ensure_goose_extension");
    expect(script).not.toContain("fintechnick:");
  });

  it("installs the extensions even when goose won the race and created a telemetry-only config", () => {
    // What goose writes for itself on first run.
    const { written } = runWithConfig(
      generateGooseSetupScript(ctx),
      "GOOSE_TELEMETRY_ENABLED: true\n",
    );

    // The user's/telemetry setting survives; the project extension is added,
    // and the result is valid YAML with a single top-level `extensions:` key.
    expect(written).toContain("GOOSE_TELEMETRY_ENABLED: true");
    const parsed = parse(written);
    expect(parsed.GOOSE_TELEMETRY_ENABLED).toBe(true);
    expect(parsed.extensions["mcphub-dev"]).toMatchObject({
      type: "streamable_http",
      uri: "http://nas:8781/mcp/dev",
    });
  });

  it("is idempotent: a second run of the block changes nothing", () => {
    const home = mkdtempSync(join(tmpdir(), "goose-home-"));
    mkdirSync(join(home, ".config", "goose"), { recursive: true });
    const config = join(home, ".config", "goose", "config.yaml");
    writeFileSync(config, "GOOSE_TELEMETRY_ENABLED: true\n");

    const script = generateGooseSetupScript(ctx);
    runConfigWrite(script, home);
    const once = readFileSync(config, "utf8");
    const second = runConfigWrite(script, home);
    expect(second.status).toBe(0);
    expect(second.stdout + second.stderr).toContain("already present in");
    expect(readFileSync(config, "utf8")).toBe(once);
  });

  it("is idempotent when it merged into a user's own config", () => {
    const script = generateGooseSetupScript(ctx);
    const home = mkdtempSync(join(tmpdir(), "goose-home-"));
    mkdirSync(join(home, ".config", "goose"), { recursive: true });
    const config = join(home, ".config", "goose", "config.yaml");
    writeFileSync(config, "extensions:\n  mine:\n    type: platform\n");

    runConfigWrite(script, home);
    const once = readFileSync(config, "utf8");
    runConfigWrite(script, home);
    expect(readFileSync(config, "utf8")).toBe(once);
    // One top-level `extensions:` only — the merge edits the section, it does
    // not append a second one.
    expect(once.match(/^extensions:/gm)).toHaveLength(1);
  });

  it("merges the project extensions into a config that has its own, never clobbering the user's entries", () => {
    const script = generateGooseSetupScript({
      capabilities: ["coding-agents", "doppler", "sonarcloud"],
      configuration: {},
    });
    const mine = [
      "GOOSE_TELEMETRY_ENABLED: true",
      "provider:",
      "  type: anthropic",
      "extensions:",
      "  mine:",
      "    type: platform",
      "    name: mine",
      "    enabled: true",
      "",
    ].join("\n");

    const { written, output } = runWithConfig(script, mine);

    // The user's settings and entries are byte-for-byte intact…
    expect(written).toContain(
      "GOOSE_TELEMETRY_ENABLED: true\nprovider:\n  type: anthropic\n",
    );
    expect(written).toContain(
      "  mine:\n    type: platform\n    name: mine\n    enabled: true\n",
    );
    // …and the missing managed extension was merged in, producing valid YAML.
    const parsed = parse(written);
    expect(Object.keys(parsed.extensions)).toEqual([
      "mcphub-dev",
      "sonarqube",
      "mine",
    ]);
    expect(parsed.extensions.mine).toEqual({
      type: "platform",
      name: "mine",
      enabled: true,
    });
    expect(parsed.provider).toEqual({ type: "anthropic" });
    expect(output).toContain("Merged project goose extensions");
  });

  it("adds only the managed keys a config is missing (an existing entry is the user's)", () => {
    const script = generateGooseSetupScript({
      capabilities: ["coding-agents", "doppler", "sonarcloud"],
      configuration: {},
    });
    const mine = [
      "extensions:",
      "  mcphub-dev:",
      "    type: streamable_http",
      "    name: mcphub-dev",
      "    enabled: false",
      "    uri: http://somewhere-else:1234/mcp",
      "",
    ].join("\n");

    const { written, output } = runWithConfig(script, mine);

    // The user's own (disabled, differently-pointed) mcphub-dev is respected…
    expect(written).toContain("uri: http://somewhere-else:1234/mcp");
    expect(written).not.toContain("uri: http://nas:8781/mcp/dev");
    // …and only sonarqube was added.
    expect(output).toContain("(added: sonarqube).");
    expect(Object.keys(parse(written).extensions).sort()).toEqual([
      "mcphub-dev",
      "sonarqube",
    ]);
  });

  it("refuses to merge into an extensions section indented by other than two spaces", () => {
    const mine = "extensions:\n    mine:\n        type: platform\n";
    const { written, output } = runWithConfig(
      generateGooseSetupScript(ctx),
      mine,
    );

    // Untouched (splicing a 2-space block in would break the YAML), and the
    // block is printed for the user to merge by hand instead.
    expect(written).toBe(mine);
    expect(output).toContain(
      "has an extensions: section indented by 4 spaces (not 2)",
    );
    expect(output).toContain("WARN:     mcphub-dev:");
  });

  it("refuses to merge into an inline 'extensions: {...}' declaration", () => {
    const mine = "extensions: {}\n";
    const { written, output } = runWithConfig(
      generateGooseSetupScript(ctx),
      mine,
    );

    expect(written).toBe(mine);
    expect(output).toContain("declares 'extensions:' inline");
  });

  it("fills an empty 'extensions:' section instead of appending a second one", () => {
    const mine = "extensions:\n";
    const { written } = runWithConfig(generateGooseSetupScript(ctx), mine);

    expect(written.match(/^extensions:/gm)).toHaveLength(1);
    expect(parse(written).extensions["mcphub-dev"].uri).toBe(
      "http://nas:8781/mcp/dev",
    );
  });

  it("clones/pulls the recipes repo into the global recipes dir", () => {
    const script = generateGooseSetupScript(ctx);
    expect(script).toContain("$HOME/.config/goose/recipes");
    expect(script).toContain(
      "git clone --quiet https://github.com/nickbrett1/goose-recipes.git",
    );
    expect(script).toContain("git pull --ff-only --quiet");
  });

  it("keeps only genuinely-local/remote non-hub exceptions (xcode-native, svelte)", () => {
    const script = generateGooseSetupScript({
      capabilities: ["xcode-development", "sveltekit"],
      configuration: {},
    });
    expect(script).toContain("mcphub-dev:");
    expect(script).toContain("xcode-native:");
    expect(script).toContain("mac-studio:9876/sse");
    expect(script).toContain("svelte:");
    expect(script).toContain("uri: https://mcp.svelte.dev/mcp");
  });
});

describe("generated post-create-setup.sh goose config (round-4 rewrite: MCPHub dev group)", () => {
  it("emits the mcphub-dev extension for a nas-port-mcp-like project (no per-capability stdio)", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();
    const files = await generateAllFiles({
      projectName: "nas-port-mcp",
      capabilities: [
        "devcontainer-python",
        "docker-container",
        "circleci",
        "doppler",
      ],
      configuration: {
        "docker-container": { entrypoint: ["/usr/local/bin/entrypoint.sh"] },
      },
    });
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();
    expect(setup.content).toContain("mcphub-dev:");
    expect(setup.content).toContain("uri: http://nas:8781/mcp/dev");
    // The circleci capability no longer wires a per-capability stdio block.
    expect(setup.content).not.toContain("ensure_goose_extension");
    expect(setup.content).not.toContain("@circleci/mcp-server-circleci");
    expect(setup.content).not.toContain("CIRCLECI_TOKEN");
  });
});
