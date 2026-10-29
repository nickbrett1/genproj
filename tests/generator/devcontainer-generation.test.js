import { describe, it, expect } from "vitest";
import {
  TemplateEngine,
  WRANGLER_LOGIN_SCRIPT,
  generateMergedDevelopmentContainerFiles,
} from "../../src/generator/file-generator.js";

describe("DevContainer Generation Tests", () => {
  it("should generate valid Java devcontainer.json without undefined variables", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      capabilities: ["devcontainer-java"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-java",
    ]);

    const devcontainerJsonFile = files.find(
      (f) => f.filePath === ".devcontainer/devcontainer.json",
    );
    expect(devcontainerJsonFile).toBeDefined();

    const devcontainerJson = JSON.parse(devcontainerJsonFile.content);

    // Check for unresolved variables in build
    expect(devcontainerJson.build).toEqual({ dockerfile: "Dockerfile" });

    // Check for runArgs
    expect(devcontainerJson.runArgs).toContain("--sysctl");
    expect(devcontainerJson.runArgs).toContain(
      "net.ipv6.conf.all.disable_ipv6=1",
    );

    // Check that the workspace folder is set so terminals start in the project dir
    expect(devcontainerJson.workspaceFolder).toBe("/workspaces/my-project");

    // Check for unresolved variables in features
    const javaFeature =
      devcontainerJson.features["ghcr.io/devcontainers/features/java:1"];
    expect(javaFeature).toBeDefined();
    expect(javaFeature.version).toBe("21");

    // Check for correct user in features
    expect(
      devcontainerJson.features["ghcr.io/devcontainers/features/common-utils:2"]
        .username,
    ).toBe("vscode");

    // Check Dockerfile user
    const dockerfileFile = files.find(
      (f) => f.filePath === ".devcontainer/Dockerfile",
    );
    expect(dockerfileFile).toBeDefined();
    expect(dockerfileFile.content).toContain("USER vscode");
  });

  it("should generate valid Python devcontainer.json without undefined variables", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      capabilities: ["devcontainer-python"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-python",
    ]);

    const devcontainerJsonFile = files.find(
      (f) => f.filePath === ".devcontainer/devcontainer.json",
    );
    expect(devcontainerJsonFile).toBeDefined();

    const devcontainerJson = JSON.parse(devcontainerJsonFile.content);

    // Check for unresolved variables in build
    expect(devcontainerJson.build).toEqual({ dockerfile: "Dockerfile" });

    // Check for runArgs
    expect(devcontainerJson.runArgs).toContain("--sysctl");
    expect(devcontainerJson.runArgs).toContain(
      "net.ipv6.conf.all.disable_ipv6=1",
    );

    // Check that the workspace folder is set so terminals start in the project dir
    expect(devcontainerJson.workspaceFolder).toBe("/workspaces/my-project");

    // Check for unresolved variables in features
    const pythonFeature =
      devcontainerJson.features["ghcr.io/devcontainers/features/python:1"];
    expect(pythonFeature).toBeDefined();
    expect(pythonFeature.version).toBe("3.12");

    // Check for correct user in features
    expect(
      devcontainerJson.features["ghcr.io/devcontainers/features/common-utils:2"]
        .username,
    ).toBe("vscode");

    // Check Dockerfile user
    const dockerfileFile = files.find(
      (f) => f.filePath === ".devcontainer/Dockerfile",
    );
    expect(dockerfileFile).toBeDefined();
    expect(dockerfileFile.content).toContain("USER vscode");

    // The container venv lives under the container's own $HOME — NOT
    // ${containerWorkspaceFolder}/.venv, which is bind-mounted to the host and
    // therefore shared (a container build rewrites it and breaks host tooling).
    // remoteEnv still prepends it to PATH for VS Code terminals/tasks.
    expect(devcontainerJson.remoteEnv.PATH).toBe(
      "/home/vscode/.devcontainer-venv/bin:${containerEnv:PATH}",
    );
  });

  it("puts the container venv under $HOME so a container build cannot touch the workspace", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "mailroom",
      capabilities: ["devcontainer-python"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-python",
    ]);
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();

    // The setup script must still cd into the workspace (the editable install
    // reads pyproject.toml there) but create the venv under $HOME, outside the
    // bind-mounted tree.
    expect(setup.content).toContain('cd "/workspaces/mailroom"');
    expect(setup.content).toContain('VENV_DIR="$HOME/.devcontainer-venv"');
    expect(setup.content).toContain('python3 -m venv "$VENV_DIR"');
    // pyproject-first projects install dev extras (matches README + CI), into
    // the $HOME venv.
    expect(setup.content).toContain('"$VENV_DIR/bin/pip" install -e ".[dev]"');

    // Idempotent rc hook: prefer the container venv in every interactive
    // shell that does not inherit remoteEnv (bash -lc / ssh / tmux).
    expect(setup.content).toContain("genproj-python-venv-path");
    expect(setup.content).toContain("$HOME/.bashrc");
    expect(setup.content).toContain("$HOME/.zshrc");
    expect(setup.content).toContain("$HOME/.devcontainer-venv/bin:$PATH");

    // The generator must substitute the project name — no literal
    // {{projectName}} may leak into the rendered script.
    expect(setup.content).not.toContain("{{projectName}}");
  });

  it("never writes the venv into the workspace tree (the shared bind mount)", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "mailroom",
      capabilities: ["devcontainer-python"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-python",
    ]);
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    const devcontainerJson = files.find(
      (f) => f.filePath === ".devcontainer/devcontainer.json",
    );
    expect(setup).toBeDefined();
    expect(devcontainerJson).toBeDefined();

    // The whole point of the fix: no reference to a workspace-local venv may
    // survive in either the script or the devcontainer JSON, so post-create
    // cannot create or rewrite <workspace>/.venv (which the host shares).
    for (const content of [setup.content, devcontainerJson.content]) {
      expect(content).not.toContain("/workspaces/mailroom/.venv");
      expect(content).not.toMatch(/\$\{containerWorkspaceFolder\}\/\.venv/);
      expect(content).not.toMatch(/(^|[^/])\.venv\/bin/);
    }
    // And it must positively point at the $HOME venv.
    expect(setup.content).toContain("$HOME/.devcontainer-venv");
    expect(JSON.parse(devcontainerJson.content).remoteEnv.PATH).toContain(
      "/home/vscode/.devcontainer-venv/bin",
    );
  });

  it.each(["devcontainer-python", "devcontainer-rust"])(
    "does not apt-install a second Node alongside the node feature (%s)",
    async (capability) => {
      const engine = new TemplateEngine();
      await engine.initialize();

      const context = {
        projectName: "mailroom",
        capabilities: [capability, "devcontainer-node"],
        configuration: {},
      };

      const files = generateMergedDevelopmentContainerFiles(engine, context, [
        capability,
      ]);
      const dockerfile = files.find(
        (f) => f.filePath === ".devcontainer/Dockerfile",
      );
      const devcontainerJson = files.find(
        (f) => f.filePath === ".devcontainer/devcontainer.json",
      );
      expect(dockerfile).toBeDefined();
      expect(devcontainerJson).toBeDefined();

      // The devcontainer installs Node through the devcontainers node feature
      // (nvm). Installing nodejs/npm from apt *as well* puts Debian's corepack
      // at /usr/share/nodejs/corepack, which the feature's `corepack enable`
      // then resolves instead of the nvm-bundled corepack and crashes
      // (devcontainer-features-install.sh exit 1) -> the image never builds.
      const features = JSON.parse(devcontainerJson.content).features;
      expect(features["ghcr.io/devcontainers/features/node:1"]).toBeDefined();
      expect(dockerfile.content).not.toMatch(
        /apt-get[^\n]*\bnodejs\b|apt-get[^\n]*\bnpm\b/,
      );
    },
  );

  it("should generate valid Node devcontainer.json with node username and remoteUser", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      capabilities: ["devcontainer-node"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);

    const devcontainerJsonFile = files.find(
      (f) => f.filePath === ".devcontainer/devcontainer.json",
    );
    expect(devcontainerJsonFile).toBeDefined();

    const devcontainerJson = JSON.parse(devcontainerJsonFile.content);

    // Check for unresolved variables in build
    expect(devcontainerJson.build).toEqual({ dockerfile: "Dockerfile" });

    // Check for runArgs
    expect(devcontainerJson.runArgs).toContain("--sysctl");
    expect(devcontainerJson.runArgs).toContain(
      "net.ipv6.conf.all.disable_ipv6=1",
    );

    // Check that the workspace folder is set so terminals start in the project dir
    expect(devcontainerJson.workspaceFolder).toBe("/workspaces/my-project");

    // Check for correct username in features
    expect(
      devcontainerJson.features["ghcr.io/devcontainers/features/common-utils:2"]
        .username,
    ).toBe("node");

    // Check for remoteUser
    expect(devcontainerJson.remoteUser).toBe("node");

    // memo: node devcontainer .venv PATH (same class as python) — remoteEnv
    // prepends the project node_modules/.bin to PATH for VS Code
    // terminals/tasks (spec: updating PATH is the documented remoteEnv use
    // case; containerEnv cannot reference container variables).
    expect(devcontainerJson.remoteEnv.PATH).toBe(
      "${containerWorkspaceFolder}/node_modules/.bin:${containerEnv:PATH}",
    );

    // Check Dockerfile copy and shell configuration
    const dockerfileFile = files.find(
      (f) => f.filePath === ".devcontainer/Dockerfile",
    );
    expect(dockerfileFile).toBeDefined();
    expect(dockerfileFile.content).toContain(
      "COPY --chown=node:node .zshrc .p10k.zsh /home/node/",
    );
    expect(dockerfileFile.content).toContain(
      "# Ensure zsh is the default shell for the node user",
    );
    expect(dockerfileFile.content).toContain("RUN chsh -s /usr/bin/zsh node");

    // Check tmux configuration
    const tmuxConfFile = files.find(
      (f) => f.filePath === ".devcontainer/.tmux.conf",
    );
    expect(tmuxConfFile).toBeDefined();
    expect(tmuxConfFile.content).toContain('set -g status-right "my-project"');
  });

  it("wires the project node_modules/.bin into post-create setup so tooling works in any shell", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "sveltekit-demo",
      capabilities: ["devcontainer-node"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();

    // Runs from the workspace and installs project deps (node_modules must
    // exist before the PATH hook can resolve .bin entries).
    expect(setup.content).toContain('cd "/workspaces/sveltekit-demo"');
    expect(setup.content).toContain("npm install");

    // Idempotent rc hook: prefer the project node_modules/.bin in every
    // interactive shell that does not inherit remoteEnv (bash -lc / ssh).
    expect(setup.content).toContain("genproj-node-bin-path");
    expect(setup.content).toContain("$HOME/.bashrc");
    expect(setup.content).toContain("$HOME/.zshrc");
    expect(setup.content).toContain(
      "/workspaces/sveltekit-demo/node_modules/.bin:$PATH",
    );

    // The generator must substitute the project name — no literal
    // {{projectName}} may leak into the rendered script.
    expect(setup.content).not.toContain("{{projectName}}");

    // genproj-npm-pin: the devcontainer post-create must activate the npm
    // pinned in package.json before npm install (npm 10 crashes fresh
    // installing vitest-4 projects; corepack alone does not switch npm).
    expect(setup.content).toContain("genproj-npm-pin");
    expect(setup.content).toContain("PINNED_NPM=");
    expect(setup.content).toContain('npm install -g "npm@${VERSION}"');

    // Node setup is gated on the node devcontainer: no python venv block.
    expect(setup.content).not.toContain("genproj-python-venv-path");
  });

  it("pins the doppler.yaml context in post-create setup so ambient DOPPLER_* env cannot redirect doppler run", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "mailroom",
      capabilities: ["devcontainer-node", "doppler"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();

    // Doppler precedence is env > doppler.yaml > ~/.doppler. The generated
    // setup must pin the repo context so ambient DOPPLER_PROJECT /
    // DOPPLER_CONFIG / DOPPLER_ENVIRONMENT (e.g. from the agent session
    // that launches the container) cannot silently redirect every
    // `doppler` command at the wrong project. Doppler scaling memo: the
    // default projectStrategy is 'common', so the pin is common/dev (the
    // same target doppler.yaml resolves to).
    expect(setup.content).toContain("genproj-doppler-context-pin");
    expect(setup.content).toContain("export DOPPLER_PROJECT=common");
    expect(setup.content).toContain("export DOPPLER_CONFIG=dev");
    expect(setup.content).toContain("unset DOPPLER_ENVIRONMENT");
    // Written to both rc files so agent-spawned shells (bash -lc / ssh /
    // tmux) that never re-run post-create still inherit the right context.
    expect(setup.content).toContain("$HOME/.bashrc");
    expect(setup.content).toContain("$HOME/.zshrc");
    // Applied to the current shell too, and verified loudly (never silent).
    expect(setup.content).toContain("doppler run -- printenv DOPPLER_PROJECT");
    expect(setup.content).toContain("resolves project '$RESOLVED_PROJECT'");
    // The pin must run AFTER the repo .zshrc copy, otherwise the cp
    // clobbers the appended block.
    expect(
      setup.content.indexOf('cp "/workspaces/mailroom/.devcontainer/.zshrc"'),
    ).toBeGreaterThan(-1);
    expect(
      setup.content.indexOf("genproj-doppler-context-pin"),
    ).toBeGreaterThan(
      setup.content.indexOf('cp "/workspaces/mailroom/.devcontainer/.zshrc"'),
    );
    // Existing doppler tooling is preserved (perms + CLI fallback).
    expect(setup.content).toContain("Installing Doppler CLI (fallback)");
    // The generator must substitute the project name — no literal
    // {{projectName}} may leak into the rendered script.
    expect(setup.content).not.toContain("{{projectName}}");
  });

  it("pins a dedicated project context when the doppler capability is configured with projectStrategy=new", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "mailroom",
      capabilities: ["devcontainer-node", "doppler"],
      configuration: {
        doppler: { projectStrategy: "new" },
      },
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();
    expect(setup.content).toContain("genproj-doppler-context-pin");
    expect(setup.content).toContain("export DOPPLER_PROJECT=mailroom");
    expect(setup.content).toContain("export DOPPLER_CONFIG=dev");
  });

  it("does not pin doppler context when the doppler capability is not selected", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "plain",
      capabilities: ["devcontainer-node"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();
    expect(setup.content).not.toContain("genproj-doppler-context-pin");
    expect(setup.content).not.toContain("DOPPLER_PROJECT");
  });

  it("wires SSH-first GitHub auth into git in post-create setup when the doppler capability is selected", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "gaggle",
      capabilities: ["devcontainer-node", "doppler"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();

    // The SSH-first marker + idempotent guard must be present.
    expect(setup.content).toContain("genproj-ssh-auth");
    expect(setup.content).toContain("git@github.com:");
    expect(setup.content).toContain("StrictHostKeyChecking=accept-new");
    expect(setup.content).toContain(
      "git config --global --get-regexp '^url\\.git@github\\.com:.*\\.insteadof'",
    );
    // Configure git via the SSH insteadOf rewrite (NOT the PAT x-access-token form).
    expect(setup.content).toContain('insteadOf "https://github.com/"');
    // No PAT probing / embedding anywhere.
    expect(setup.content).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(setup.content).not.toContain("x-access-token");
    // No unresolved template placeholders may leak into the rendered script.
    expect(setup.content).not.toContain("{{gitGithubAuthSetup}}");
    expect(setup.content).not.toContain("{{projectName}}");
  });

  it("renders the workspace path in post-create-setup.sh for callers that pass no projectName", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    // Callers are not required to set projectName (previews pass `name`,
    // tests pass nothing) — the template's /workspaces/{{projectName}} must
    // still resolve, to the placeholder name if necessary.
    for (const context of [
      { capabilities: ["devcontainer-node"], configuration: {} },
      {
        name: "TestProject",
        capabilities: ["devcontainer-node"],
        configuration: {},
      },
    ]) {
      const files = generateMergedDevelopmentContainerFiles(engine, context, [
        "devcontainer-node",
      ]);
      const setup = files.find(
        (f) => f.filePath === ".devcontainer/post-create-setup.sh",
      );
      expect(setup).toBeDefined();
      expect(setup.content).not.toContain("{{projectName}}");
      expect(setup.content).toContain(
        `/workspaces/${context.name || "my-project"}`,
      );
    }
  });

  it("node containers get SSH-first setup, .ssh bind, and npx --yes git hooks (no flaky java feature)", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    // ftn-style: a node project with sonarlint selected. The SDKMAN java
    // feature (ghcr.io/devcontainers/features/java) is flaky at build time
    // (unreachable SDKMAN API / Microsoft JDK host), so node containers must
    // NOT scaffold it — sonarlint uses its own bundled JRE.
    const context = {
      projectName: "gaggle",
      capabilities: ["devcontainer-node", "sonarlint", "doppler"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);

    const json = JSON.parse(
      files.find((f) => f.filePath === ".devcontainer/devcontainer.json")
        .content,
    );
    // No flaky SDKMAN java feature in node containers.
    expect(
      json.features["ghcr.io/devcontainers/features/java:1"],
    ).toBeUndefined();
    // Host ~/.ssh is bind-mounted for SSH-first GitHub auth.
    expect(
      json.mounts.some(
        (m) => m.includes(".ssh-host") && m.includes("type=bind"),
      ),
    ).toBe(true);

    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    // SSH-first auth (no PAT), and git hooks installed non-interactively.
    expect(setup.content).toContain("genproj-ssh-auth");
    expect(setup.content).not.toContain("x-access-token");
    // Non-interactive hooks install (the bare `npx simple-git-hooks` form
    // hangs on the "Ok to proceed? (y)" prompt in a non-tty build).
    expect(setup.content).toContain("npx --yes simple-git-hooks");
  });

  it("omits the GitHub auth wiring when the doppler capability is not selected", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "plain",
      capabilities: ["devcontainer-node"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup).toBeDefined();
    expect(setup.content).not.toContain("genproj-ssh-auth");
    expect(setup.content).not.toContain('insteadOf "https://github.com/"');
  });

  it("omits goose entirely when the selection resolves no doppler (spec 012)", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      capabilities: ["devcontainer-node"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);

    const zshrcFile = files.find((f) => f.filePath === ".devcontainer/.zshrc");
    expect(zshrcFile).toBeDefined();
    const zshrc = zshrcFile.content;

    // goose is only offered where it can run: the only supported invocation is
    // the GOOSE_ALIAS Doppler wrapper, so without doppler there is no binary,
    // no wrapper and no worktree block. The bare binary this used to bind
    // started and then died with "No provider configured".
    expect(zshrc).not.toContain("Goose Multi-Session Worktree Workflow");
    expect(zshrc).not.toContain("_wt_ensure()");
    expect(zshrc).not.toContain("goose()");
    expect(zshrc).not.toContain("GOOSE_ALIAS");
    expect(zshrc).not.toContain('goose() { _wt_ensure command goose "$@"; }');
    expect(zshrc).not.toContain("doppler");

    const dockerfile = files.find(
      (f) => f.filePath === ".devcontainer/Dockerfile",
    ).content;
    expect(dockerfile).not.toContain("goose");
    expect(dockerfile).not.toContain("GOOSE_ARCH");

    // Socket handling: hoisted locals + nullglob (N) qualifiers (no
    // 'sockets=(  )' noise, no 'no matches found' glob errors at startup).
    expect(zshrc).toContain("local current_user sockets socket");
    expect(zshrc).toContain("vscode-remote-containers-ipc-*.sock(N)");
    expect(zshrc).toContain("vscode-ssh-auth-*.sock(N)");
    expect(zshrc).not.toMatch(/\n\s+local sockets\b/);
    expect(zshrc).not.toMatch(/\n\s+local socket\b/);
  });

  it("includes goose and the multi-session worktree workflow when doppler is resolved (spec 012)", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      capabilities: ["devcontainer-node", "doppler"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);

    const zshrcFile = files.find((f) => f.filePath === ".devcontainer/.zshrc");
    expect(zshrcFile).toBeDefined();

    const zshrc = zshrcFile.content;
    // Core wrapper, post-exit check, audit/remove helpers, and entry point.
    expect(zshrc).toContain("Goose Multi-Session Worktree Workflow");
    expect(zshrc).toContain("_wt_ensure()");
    expect(zshrc).toContain("_wt_check()");
    expect(zshrc).toContain("_wt_merge()");
    expect(zshrc).toContain("_wt_audit()");
    expect(zshrc).toContain("_wt_remove()");
    // The worktree block does not bind the bare binary any more: it is only
    // emitted where goose exists, and goose() is the Doppler wrapper above.
    expect(zshrc).not.toContain('goose() { _wt_ensure command goose "$@"; }');
    expect(zshrc).not.toContain("typeset -f goose");

    // The install travels with the same predicate, so a devcontainer can never
    // have the wrapper without the binary (or vice versa).
    const dockerfile = files.find(
      (f) => f.filePath === ".devcontainer/Dockerfile",
    ).content;
    expect(dockerfile).toContain("RUN GOOSE_ARCH=");
    expect(dockerfile).toContain("aaif-goose/goose/releases");
  });

  it("overrides goose() with the Doppler wrapper when the doppler capability is selected", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      capabilities: ["devcontainer-node", "doppler"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);

    const zshrcFile = files.find((f) => f.filePath === ".devcontainer/.zshrc");
    expect(zshrcFile).toBeDefined();

    const zshrc = zshrcFile.content;
    // goose() itself is the Doppler wrapper (no separate goose-dev entry point)
    expect(zshrc).toContain("goose() {");
    expect(zshrc).toContain(
      "_wt_ensure doppler run --project common --config dev",
    );
    expect(zshrc).toContain('--project goose --config prd -- goose "$@"');
    expect(zshrc).not.toContain("goose-dev()");
    // Regression: the entry-point comment must NOT embed the multi-line
    // GOOSE_ALIAS. It previously rendered as '}) already defined goose(), it
    // already routes', producing a zsh parse error in every generated
    // devcontainer that selects the doppler capability.
    expect(zshrc).not.toContain("}) already defined");
    expect(zshrc).toContain(
      "# --- Entry point: run goose inside this shell's worktree ---",
    );
    expect(zshrc).toContain("which routes through _wt_ensure itself");
    // Doppler auth pre-flight: a fresh devcontainer/codespace has no Doppler
    // auth, and 'doppler run' would otherwise die with the cryptic "Doppler
    // Error: you must provide a token". The wrapper must fail with guidance
    // instead of a bare doppler error.
    expect(zshrc).toContain("if ! doppler whoami &> /dev/null 2>&1; then");
    expect(zshrc).toContain("bash scripts/cloud_login.sh");
    expect(zshrc).toContain("export DOPPLER_TOKEN=dp.st.<token>");
    expect(zshrc).toContain("Not authenticated with Doppler");
  });

  it("joins an existing tmux session for terminals starting outside the workspace", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      capabilities: ["devcontainer-rust"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-rust",
    ]);

    // devcontainer.json sets workspaceFolder so VS Code terminals start in the project
    const devcontainerJsonFile = files.find(
      (f) => f.filePath === ".devcontainer/devcontainer.json",
    );
    expect(devcontainerJsonFile).toBeDefined();
    const devcontainerJson = JSON.parse(devcontainerJsonFile.content);
    expect(devcontainerJson.workspaceFolder).toBe("/workspaces/my-project");

    // .zshrc falls back to scanning /workspaces/* for an existing session so
    // terminals that start in $HOME (before workspaceFolder kicks in) still join.
    const zshrcFile = files.find((f) => f.filePath === ".devcontainer/.zshrc");
    expect(zshrcFile).toBeDefined();

    const zshrc = zshrcFile.content;
    expect(zshrc).toContain(
      "Determine a session name from the workspace folder name",
    );
    expect(zshrc).toContain("for ws_dir in /workspaces/*(N/); do");
    expect(zshrc).toContain('candidate="${ws_dir:t}"');
    expect(zshrc).toContain('tmux has-session -t "$candidate" 2>/dev/null');
    expect(zshrc).toContain("start the named session");
  });

  it("installs rustfmt and clippy in the rust devcontainer image", async () => {
    // Same gap as the CI image, on the devcontainer side: devcontainers/rust is
    // `FROM rust:1-<variant>`, and the official rust images carry the rustup
    // *minimal* profile, so rustfmt and clippy are absent. Without this the
    // local lint gate and any hand-run `cargo fmt`/`cargo clippy` fail with
    // "'cargo-fmt' is not installed for the toolchain".
    const engine = new TemplateEngine();
    await engine.initialize();

    const files = generateMergedDevelopmentContainerFiles(
      engine,
      { capabilities: ["devcontainer-rust"], configuration: {} },
      ["devcontainer-rust"],
    );
    const dockerfile = files.find(
      (f) => f.filePath === ".devcontainer/Dockerfile",
    );

    expect(dockerfile).toBeDefined();
    expect(dockerfile.content).toContain(
      "RUN rustup component add rustfmt clippy",
    );
  });
});

describe("DevContainer kitchen-sink gating (memo §2.9 / audit §4.5)", () => {
  it("only mounts volumes and forwardPorts for SELECTED capabilities", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "ports",
      capabilities: ["devcontainer-python", "doppler", "coding-agents"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-python",
    ]);
    const jsonFile = files.find(
      (f) => f.filePath === ".devcontainer/devcontainer.json",
    );
    const json = JSON.parse(jsonFile.content);

    // Selected: doppler + coding-agents (+ always-on tailscale state volume).
    expect(json.mounts.some((m) => m.includes("tailscale-state"))).toBe(true);
    // Round-5: doppler mounts the host ~/.doppler as a BIND (auth persists
    // across rebuilds). No devcontainer feature — the contrib registry is
    // not reliably pullable; the CLI is installed via Dockerfile +
    // post-create fallback instead.
    expect(
      json.mounts.some(
        (m) => m.includes(".doppler") && m.includes("type=bind"),
      ),
    ).toBe(true);
    expect(json.mounts.some((m) => m.includes("doppler-config"))).toBe(false);
    // genproj-ssh-auth: host ~/.ssh is always bind-mounted (SSH-first GitHub
    // auth; no PAT in git config/remotes).
    expect(
      json.mounts.some(
        (m) => m.includes(".ssh-host") && m.includes("type=bind"),
      ),
    ).toBe(true);
    expect(
      json.features["ghcr.io/devcontainers-contrib/features/doppler-cli:1"],
    ).toBeUndefined();
    expect(json.mounts.some((m) => m.includes("gemini-cli-settings"))).toBe(
      true,
    );
    // NOT selected: wrangler mount and the kitchen-sink forwardPorts are gone.
    expect(json.mounts.some((m) => m.includes("wrangler-config"))).toBe(false);
    expect(json.forwardPorts).toEqual([]);

    // post-create-setup.sh contains only selected-capability tooling.
    const setup = files.find(
      (f) => f.filePath === ".devcontainer/post-create-setup.sh",
    );
    expect(setup.content).toContain(".doppler");
    expect(setup.content).toContain("Installing Doppler CLI (fallback)");
    expect(setup.content).toContain(".gemini");
    expect(setup.content).not.toContain(".wrangler");
    expect(setup.content).not.toContain("specdag");
    expect(setup.content).not.toContain("nanobanana");
  });
});

describe("Declared forwardPorts (memo: stop stale VS Code port forwards)", () => {
  it("declares the Cloudflare OAuth callback port instead of printing it", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "wrangler-ports",
      capabilities: ["devcontainer-node", "cloudflare-wrangler"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);
    const json = JSON.parse(
      files.find((f) => f.filePath === ".devcontainer/devcontainer.json")
        .content,
    );

    // The callback is forwarded because it is declared, not because a
    // `localhost:8976` literal was scraped out of the post-create output.
    expect(json.forwardPorts).toContain(8976);
    expect(WRANGLER_LOGIN_SCRIPT).not.toContain("localhost:8976");
    expect(WRANGLER_LOGIN_SCRIPT).not.toContain("Ports' tab");
  });

  it("does not declare a callback port for a project without wrangler", async () => {
    const engine = new TemplateEngine();
    await engine.initialize();

    const context = {
      projectName: "no-wrangler-ports",
      capabilities: ["devcontainer-node"],
      configuration: {},
    };

    const files = generateMergedDevelopmentContainerFiles(engine, context, [
      "devcontainer-node",
    ]);
    const json = JSON.parse(
      files.find((f) => f.filePath === ".devcontainer/devcontainer.json")
        .content,
    );

    expect(json.forwardPorts).toEqual([]);
  });
});
