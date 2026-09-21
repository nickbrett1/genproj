import { describe, it, expect } from "vitest";
import { parse } from "yaml";

import { generateAllFiles } from "../../src/generator/file-generator.js";

const generate = (capabilities, configuration = {}) =>
  generateAllFiles({ name: "test-project", capabilities, configuration });

const pipelineFrom = (files) =>
  files.find((f) => f.filePath === ".buildkite/pipeline.yml");
const readmeFrom = (files) =>
  files.find((f) => f.filePath === ".buildkite/README.md");

describe("Buildkite file generation", () => {
  it("generates the pipeline and its README for a node project", async () => {
    const files = await generate(["buildkite", "devcontainer-node"], {
      buildkite: {},
    });

    const pipeline = pipelineFrom(files);
    expect(pipeline).toBeDefined();
    expect(readmeFrom(files)).toBeDefined();

    expect(pipeline.content).toContain("queue: mac-studio-linux");
    expect(pipeline.content).toContain("node:22-bookworm");
    expect(pipeline.content).toContain(
      "npm ci --no-audit --no-fund --prefer-offline",
    );
    expect(pipeline.content).toContain("npm run build --if-present");
    // Tests run through a placeholder guard: a plain `npm init` project has
    // "test": "echo \"Error: no test specified\" && exit 1", which fails by design.
    expect(pipeline.content).toContain("CI=true npm test");
    expect(pipeline.content).toContain("skipping tests");
    // Installs once, in a single job — the ftn measurements showed the
    // install dominates, so there is deliberately only one step.
    expect((pipeline.content.match(/npm ci/g) || []).length).toBe(1);
  });

  it("honours a configured queue", async () => {
    const files = await generate(["buildkite", "devcontainer-node"], {
      buildkite: { queue: "my-queue" },
    });
    const pipeline = pipelineFrom(files);
    expect(pipeline.content).toContain("queue: my-queue");
    expect(pipeline.content).not.toContain("queue: mac-studio-linux");
  });

  it("uses python commands for a python project", async () => {
    const files = await generate(["buildkite", "devcontainer-python"], {
      buildkite: {},
    });
    const pipeline = pipelineFrom(files);

    expect(pipeline.content).toContain("python:3.13-slim");
    expect(pipeline.content).toContain(
      'pip install --no-cache-dir -e ".[dev]"',
    );
    expect(pipeline.content).toContain("ruff check src tests");
    expect(pipeline.content).toContain("pytest -q");
  });

  it("uses cargo for a rust project", async () => {
    const files = await generate(["buildkite", "devcontainer-rust"], {
      buildkite: {},
    });
    const pipeline = pipelineFrom(files);

    expect(pipeline.content).toContain("rust:1-slim");
    expect(pipeline.content).toContain("cargo build --locked");
    expect(pipeline.content).toContain("cargo test --locked");
    // No lint gate unless code-quality-rust is selected.
    expect(pipeline.content).not.toContain("cargo clippy");
  });

  it("adds the clippy + fmt lint gate when code-quality-rust is selected", async () => {
    const files = await generate([
      "buildkite",
      "devcontainer-rust",
      "code-quality-rust",
    ]);
    const pipeline = pipelineFrom(files);

    expect(pipeline.content).toContain("cargo fmt --check");
    expect(pipeline.content).toContain(
      "cargo clippy --all-targets -- -D warnings",
    );
    // The lint runs inside the build step, before the build itself.
    expect(pipeline.content.indexOf("cargo clippy")).toBeLessThan(
      pipeline.content.indexOf("cargo build --locked"),
    );
  });

  it("installs rustfmt and clippy before running the lint", async () => {
    // Regression: the build runs in `rust:1-slim`, an official rust image built
    // with the rustup *minimal* profile - rustc and cargo only, no rustfmt and
    // no clippy. The lint gate was internally self-consistent (it named exactly
    // the commands the capability advertises) but guaranteed a red build on a
    // clean project: `cargo fmt` died with "'cargo-fmt' is not installed for
    // the toolchain" before clippy or even `cargo build` ran. So this test does
    // not settle for the lint commands existing - it pins that the component
    // install is emitted, that it is in the same step as the lints, and that it
    // comes first. A template edit that drops the install, or moves it after the
    // lints, fails here.
    const files = await generate([
      "buildkite",
      "devcontainer-rust",
      "code-quality-rust",
    ]);
    const build = parse(pipelineFrom(files).content).steps.find(
      (step) => step.key === "build",
    );
    const commands = build.commands.map((command) => String(command));
    const indexOf = (needle) => commands.findIndex((c) => c.includes(needle));

    const install = indexOf("rustup component add rustfmt clippy");
    const fmt = indexOf("cargo fmt --check");
    const clippy = indexOf("cargo clippy --all-targets -- -D warnings");

    expect(install).toBeGreaterThanOrEqual(0);
    expect(fmt).toBeGreaterThanOrEqual(0);
    expect(clippy).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(fmt);
    expect(install).toBeLessThan(clippy);
    // And before the build/test the lint gate exists to gate.
    expect(install).toBeLessThan(indexOf("cargo build --locked"));
  });

  it("does not install rust components when code-quality-rust is absent", async () => {
    const files = await generate(["buildkite", "devcontainer-rust"]);
    expect(pipelineFrom(files).content).not.toContain("rustup component add");
  });

  it("builds the Svelte frontend in its own step for a rust primary", async () => {
    // The rust image has no node, so the frontend cannot be built in the rust
    // step; it gets a node-image step the build waits for.
    const files = await generate(
      ["buildkite", "devcontainer-rust", "devcontainer-node", "sveltekit"],
      { language: "rust" },
    );
    const pipeline = pipelineFrom(files);

    expect(pipeline.content).toContain("key: frontend_build");
    expect(pipeline.content).toContain("cd web");
    // Parses as YAML, and the rust build depends on the frontend step.
    const parsed = parse(pipeline.content);
    const build = parsed.steps.find((step) => step.key === "build");
    expect(build.depends_on).toContain("frontend_build");
  });

  it("explains itself rather than failing for a java project", async () => {
    // genproj generates a Java devcontainer but no build system, so there is
    // genuinely nothing to build yet. A step that fails on the first push
    // would be worse than one that says so.
    const files = await generate(["buildkite", "devcontainer-java"], {
      buildkite: {},
    });
    const pipeline = pipelineFrom(files);

    expect(pipeline.content).toContain("eclipse-temurin:21-jdk");
    expect(pipeline.content).toContain("genproj generates a Java devcontainer");
    expect(pipeline.content).not.toContain("npm ci");
  });

  it("installs playwright browsers when the project uses playwright", async () => {
    const files = await generate(
      ["buildkite", "devcontainer-node", "playwright"],
      {
        buildkite: {},
      },
    );
    const pipeline = pipelineFrom(files);

    expect(pipeline.content).toContain(
      "playwright install --with-deps chromium",
    );
  });

  it("documents the agent-side prerequisites in the generated README", async () => {
    const files = await generate(["buildkite", "devcontainer-node"], {
      buildkite: {},
    });
    const readme = readmeFrom(files);

    // The two failures we actually hit on ftn: a missing plugins-path, and a
    // secret that never reached the container.
    expect(readme.content).toContain("plugins-path");
    expect(readme.content).toContain("does **not** reach the container");
    expect(readme.content).toContain("webhook");
    expect(readme.content).toContain("node:22-bookworm");
  });

  it("generates nothing when the buildkite capability is not selected", async () => {
    const files = await generate(["devcontainer-node"], {});
    expect(pipelineFrom(files)).toBeUndefined();
    expect(readmeFrom(files)).toBeUndefined();
  });

  it("adds a secret scan that gates the build when gitguardian is selected", async () => {
    const files = await generate(
      ["buildkite", "devcontainer-node", "gitguardian"],
      {
        buildkite: {},
      },
    );
    const content = pipelineFrom(files).content;

    expect(content).toContain("key: secret_scan");
    expect(content).toContain("gitguardian/ggshield");
    // NAME only: a step-level env: value never reaches the container.
    expect(content).toContain("- GITGUARDIAN_API_KEY");
    // The image has no ENTRYPOINT, so the full argv is spelled out.
    expect(content).toContain(
      'command: ["ggshield", "secret", "scan", "path", "."]',
    );
    // CircleCI made `build` require the scan; so does this.
    expect(content).toMatch(/key: build[\s\S]*?depends_on:\n {6}- secret_scan/);
  });

  it("adds a main-only Lighthouse step when lighthouse-ci is selected", async () => {
    const files = await generate(
      ["buildkite", "devcontainer-node", "lighthouse-ci"],
      {
        buildkite: {},
      },
    );
    const content = pipelineFrom(files).content;

    expect(content).toContain("key: lighthouse");
    expect(content).toContain('if: build.branch == "main"');
    // The pinned Playwright image, because Lighthouse needs real Chromium.
    expect(content).toContain("mcr.microsoft.com/playwright");
    expect(content).toContain("- CHROME_PATH");
    // .lighthouse.cjs is not a filename lhci discovers on its own.
    expect(content).toContain("lhci autorun --config .lighthouse.cjs");
  });

  it("runs Lighthouse on every branch when branch gating is off", async () => {
    const files = await generate(
      ["buildkite", "devcontainer-node", "lighthouse-ci"],
      {
        buildkite: { branchGating: false },
      },
    );
    expect(pipelineFrom(files).content).not.toContain(
      'if: build.branch == "main"',
    );
  });

  it("adds a main-only Cloudflare deploy when cloudflare-wrangler is selected", async () => {
    const files = await generate(
      ["buildkite", "devcontainer-node", "cloudflare-wrangler", "doppler"],
      { buildkite: {} },
    );
    const content = pipelineFrom(files).content;

    expect(content).toContain("key: deploy");
    expect(content).toContain('if: build.branch == "main"');
    // With doppler selected the credentials are resolved from Doppler inside
    // the step (CircleCI got them from its context), so they are not listed
    // for forwarding from the agent environment.
    expect(content).toContain("doppler secrets get CLOUDFLARE_API_TOKEN");
    expect(content).not.toContain("            - CLOUDFLARE_API_TOKEN");
    expect(content).toContain("setup-wrangler-config.sh");
    expect(content).toContain("sync-doppler-secrets.sh");
    // The deploy step installs the CLI the same way the release step does, so
    // it needs the same `gpgv` for the installer's own signature check.
    expect(content).toContain(
      "apt-get install -y --no-install-recommends curl ca-certificates gpgv",
    );
    expect(content).toContain("npx --yes wrangler deploy");
    // A preview on every branch is off by default, matching CircleCI.
    expect(content).not.toContain("key: deploy_preview");
  });

  it("deploys without the Doppler steps when doppler is not selected", async () => {
    const files = await generate(
      ["buildkite", "devcontainer-node", "cloudflare-wrangler"],
      {
        buildkite: {},
      },
    );
    const content = pipelineFrom(files).content;

    expect(content).toContain("key: deploy");
    expect(content).not.toContain("DOPPLER_TOKEN");
    expect(content).not.toContain("sync-doppler-secrets.sh");
    // Without doppler there is nothing to resolve the credentials with, so
    // they have to come from the agent environment.
    expect(content).toContain("            - CLOUDFLARE_API_TOKEN");
    expect(content).toContain("            - CLOUDFLARE_ACCOUNT_ID");
  });

  it("adds a preview deploy for branches when branch gating is off", async () => {
    const files = await generate(
      ["buildkite", "devcontainer-node", "cloudflare-wrangler", "doppler"],
      { buildkite: { branchGating: false } },
    );
    const content = pipelineFrom(files).content;

    expect(content).toContain("key: deploy_preview");
    expect(content).toContain("wrangler deploy --env preview");
    expect(content).toContain('build.branch != "main"');
  });

  it("publishes the container image on the agent when docker-container is selected", async () => {
    const files = await generateAllFiles({
      name: "demo",
      registryNamespace: "nickbrett1",
      capabilities: [
        "buildkite",
        "devcontainer-node",
        "docker-container",
        "docker",
      ],
      configuration: { buildkite: {} },
    });
    const content = pipelineFrom(files).content;

    expect(content).toContain("key: docker_publish");
    expect(content).toContain("ghcr.io/nickbrett1/demo");
    expect(content).toContain("type=registry,ref=$$CACHE_REF,mode=max");
    // Needs a Docker daemon, so it runs on the agent rather than in a
    // container - i.e. no docker plugin on this step.
    expect(content).toMatch(/key: docker_publish[\s\S]*?commands:/);
    expect(content).not.toMatch(/key: docker_publish[\s\S]*?docker#v5\.13\.0/);
  });

  it("resolves the publish credentials from Doppler when doppler is selected", async () => {
    // The preferred channel: the registry token stays out of the agent's
    // environment hook, where every job on the fleet could read it. Selected by
    // the capability, not forced by a dependency - see the fallback test below.
    const files = await generateAllFiles({
      name: "demo",
      registryNamespace: "nickbrett1",
      capabilities: [
        "buildkite",
        "devcontainer-node",
        "docker-container",
        "doppler",
      ],
      configuration: { buildkite: {} },
    });
    const content = pipelineFrom(files).content;

    const step = content.slice(content.indexOf("key: docker_publish"));
    expect(step).toContain("GHCR_UPDATE_TOKEN");
    expect(step).toContain("api.doppler.com");
    expect(step).toContain("Authorization: Bearer $$DOPPLER_TOKEN");
    expect(step).not.toContain("GHCR_USERNAME/GHCR_TOKEN are not set");
  });

  it("uses agent-env credentials when doppler is absent", async () => {
    // docker-container does not declare doppler, so a container project can
    // reach this branch by selection alone - it is a real channel, not dead
    // code. It uses the same GHCR_USERNAME/GHCR_TOKEN contract the CircleCI
    // context supplies, and fails with a clear message rather than mid-push.
    const files = await generateAllFiles({
      name: "demo",
      registryNamespace: "nickbrett1",
      capabilities: ["buildkite", "devcontainer-node", "docker-container"],
      configuration: { buildkite: {} },
    });
    const content = pipelineFrom(files).content;

    const step = content.slice(content.indexOf("key: docker_publish"));
    expect(step).toContain("GHCR_USERNAME/GHCR_TOKEN are not set on the agent");
    expect(step).not.toContain("GHCR_UPDATE_TOKEN");
    expect(step).toContain('echo "$$GHCR_TOKEN" | docker login ghcr.io');
  });

  it("contributes no extra steps when no contributing capability is selected", async () => {
    const files = await generate(["buildkite", "devcontainer-node"], {
      buildkite: {},
    });
    const content = pipelineFrom(files).content;

    // Step keys, not raw substrings: the template's header comment names the
    // contributing capabilities on purpose.
    for (const key of [
      "key: secret_scan",
      "key: lighthouse",
      "key: deploy",
      "key: docker_publish",
    ]) {
      expect(content).not.toContain(key);
    }
    expect(content).not.toContain(":loudspeaker:");
  });

  it("activates the npm version the project pins, before installing", async () => {
    // The generated package.json declares `packageManager` and .npmrc sets
    // engine-strict=true, so the image's bundled npm refuses to install and
    // dies with "Cannot read properties of null (reading 'edgesOut')". This
    // is CircleCI's activate_pinned_npm step, and leaving it out is why the
    // first fleet build of a generated project failed.
    const files = await generate(["buildkite", "devcontainer-node"], {
      buildkite: {},
    });
    const content = pipelineFrom(files).content;

    expect(content).toContain("require('./package.json').packageManager");
    expect(content).toContain('npm install -g "npm@$$PINNED"');
  });

  it("guards npm ci behind a lockfile check", async () => {
    // A generated project ships a package.json but no package-lock.json, so
    // a bare `npm ci` fails outright.
    const files = await generate(["buildkite", "devcontainer-node"], {
      buildkite: {},
    });
    expect(pipelineFrom(files).content).toContain(
      "if [ -f package-lock.json ]; then npm ci",
    );
  });

  it("runs tests non-interactively so vitest cannot hang in watch mode", async () => {
    // The docker plugin allocates a TTY, and with a TTY vitest starts in
    // watch mode and holds the step open until the job is killed. CircleCI
    // has no TTY, which is why this only bites on Buildkite.
    const files = await generate(["buildkite", "devcontainer-node"], {
      buildkite: {},
    });
    expect(pipelineFrom(files).content).toContain("CI=true npm test");
  });

  it("pins the container platform to the fleet architecture", async () => {
    // Without this, docker resolves a multi-arch tag to linux/amd64 and runs
    // every step emulated on an Apple-silicon fleet.
    const files = await generate(["buildkite", "devcontainer-node"], {
      buildkite: {},
    });
    expect(pipelineFrom(files).content).toContain("platform: linux/arm64");
  });
  it("emits YAML that actually parses, whatever the capability mix", async () => {
    // The pipeline is the artifact: an unquoted label that starts with a colon
    // is a parse error Buildkite reports as an opaque upload failure, and the
    // string-containment tests above cannot see it. Parsing every shape is the
    // assertion that says "this file is loadable" rather than "this file
    // contains a substring".
    const shapes = [
      [["buildkite", "devcontainer-node"], {}],
      [
        ["buildkite", "gitguardian", "docker-container", "devcontainer-rust"],
        { language: "rust" },
      ],
      [
        [
          "buildkite",
          "github-release",
          "devcontainer-rust",
          "lighthouse-ci",
          "cloudflare-wrangler",
        ],
        { language: "rust" },
      ],
      // The build matrix: several build steps sharing one release step.
      [
        ["buildkite", "github-release", "devcontainer-rust"],
        {
          language: "rust",
          "github-release": {
            targets: ["aarch64-apple-darwin", "x86_64-unknown-linux-musl"],
          },
        },
      ],
      // A single platform-specific artifact: the build step stays a container
      // (its wheel is architecture-independent), the smoke gate is native.
      [
        ["buildkite", "github-release", "devcontainer-python"],
        {
          language: "python",
          "github-release": { target: "aarch64-apple-darwin" },
        },
      ],
    ];

    for (const [capabilities, configuration] of shapes) {
      const files = await generate(capabilities, configuration);
      const doc = parse(pipelineFrom(files).content);
      expect(Array.isArray(doc.steps)).toBe(true);
      expect(doc.steps.length).toBeGreaterThan(0);
    }
  });
});

describe("Buildkite docker smoke gate (roost regression)", () => {
  // "CI was green and the image was dead": the publish step only ever proved
  // the image BUILT. The smoke gate builds it, runs it, and asserts it serves
  // HTTP before anything is published.
  //
  // It applies where genproj can expect the image to serve its own
  // healthcheck: a node primary (genproj scaffolds the SvelteKit/node server),
  // a non-node primary WITH a frontend (genproj now scaffolds a serving
  // harness — src/main.rs / __main__.py — that serves the default /healthz, so
  // the gate is green by default), or a declared command/entrypoint (the user
  // owns the entry point). A non-node project with NO frontend still gets no
  // gate: its placeholder binary makes no promise — see the language-follows
  // reversal in docker-sveltekit-runtime.test.js.
  const nodeDockerCaps = ["buildkite", "devcontainer-node", "docker-container"];

  it("adds a smoke step for a node project that serves HTTP", async () => {
    const files = await generate(nodeDockerCaps, {});
    const content = pipelineFrom(files).content;

    expect(content).toContain("key: docker_smoke");
    expect(content).toContain("docker build -t");
    expect(content).toContain("docker run -d");
    expect(content).toContain(".State.Health");
    expect(content).toContain("healthy");

    const doc = parse(content);
    const smoke = doc.steps.find((s) => s.key === "docker_smoke");
    expect(smoke).toBeDefined();
    // Runs on every branch, not only main: a broken image must fail the PR.
    expect(smoke.if).toBeUndefined();
  });

  it("makes publish depend on the smoke gate so a dead image never ships", async () => {
    const files = await generate(nodeDockerCaps, {});
    const doc = parse(pipelineFrom(files).content);
    const publish = doc.steps.find((s) => s.key === "docker_publish");
    expect(publish).toBeDefined();
    expect(publish.depends_on).toContain("docker_smoke");
    expect(publish.if).toBe('build.branch == "main"');
  });

  it("adds the smoke step for a non-node project that has a frontend to serve", async () => {
    // rust + svelte: genproj scaffolds a serving harness that answers the
    // default /healthz, so the gate applies even with no declared command and
    // no declared healthcheck. This is the shape that would have caught the
    // dead roost image.
    const files = await generate(
      [
        "buildkite",
        "devcontainer-rust",
        "devcontainer-node",
        "svelte",
        "docker-container",
      ],
      { language: "rust" },
    );
    const content = pipelineFrom(files).content;
    const doc = parse(content);
    const smoke = doc.steps.find((s) => s.key === "docker_smoke");
    expect(smoke).toBeDefined();
    expect(smoke.if).toBeUndefined();
    expect(
      doc.steps.find((s) => s.key === "docker_publish").depends_on,
    ).toContain("docker_smoke");
  });

  it("adds the smoke step for a non-node project only on the shapes that serve", async () => {
    // No frontend, no declared command: the scaffolded binary is a placeholder,
    // so genproj cannot scaffold a server and a gate would be red by default.
    const bareRust = await generate(
      ["buildkite", "devcontainer-rust", "docker-container"],
      {
        language: "rust",
        "docker-container": { healthcheck: "http:/healthz" },
      },
    );
    expect(pipelineFrom(bareRust).content).not.toContain("docker_smoke");

    // A declared command is the user owning the entry point: the gate applies.
    const withEntrypoint = await generate(
      ["buildkite", "devcontainer-rust", "docker-container"],
      {
        language: "rust",
        "docker-container": {
          healthcheck: "http:/healthz",
          command: ["roost"],
        },
      },
    );
    const doc = parse(pipelineFrom(withEntrypoint).content);
    expect(doc.steps.find((s) => s.key === "docker_smoke")).toBeDefined();
    expect(
      doc.steps.find((s) => s.key === "docker_publish").depends_on,
    ).toContain("docker_smoke");
  });

  it("omits the smoke step for a frontend project that opts out of a healthcheck", async () => {
    const files = await generate(
      [
        "buildkite",
        "devcontainer-rust",
        "devcontainer-node",
        "svelte",
        "docker-container",
      ],
      {
        language: "rust",
        "docker-container": { healthcheck: "none" },
      },
    );
    expect(pipelineFrom(files).content).not.toContain("docker_smoke");
  });

  it("emits no docker smoke step when docker-container is not selected", async () => {
    const files = await generate(["buildkite", "devcontainer-rust"], {
      language: "rust",
    });
    expect(pipelineFrom(files).content).not.toContain("docker_smoke");
  });
});

describe("Buildkite docker publish (roost build 16 regression)", () => {
  // Three red builds on roost's first generation, and only one of them was
  // earned. #12/#13/#14 failed at docker_smoke - the gate doing its job on a
  // dead image. #16 failed at docker_publish, inside `docker login`, on the
  // SAME commit as #15, which published fine 96 seconds later: two agents on
  // one macOS host (mac-studio-1/-2) behind the osxkeychain credential helper,
  // two builds of one commit (the push webhook and the API "First build
  // (genproj)"), two keychain writes started 37ms apart, and the loser died
  // with "The specified item already exists in the keychain. (-25299)".
  //
  // Note what this means for the skip guard: the two publish steps overlapped
  // for their whole duration, so at the moment #16 would have checked, nothing
  // was published yet and it would have proceeded to log in regardless. The
  // skip alone does not fix that red - the keychain write does. Both are pinned
  // below, because both are the fix.
  const publishCaps = [
    "buildkite",
    "devcontainer-rust",
    "devcontainer-node",
    "svelte",
    "docker-container",
    "doppler",
  ];

  const publishCommand = async (capabilities = publishCaps) => {
    const files = await generateAllFiles({
      name: "roost",
      registryNamespace: "nickbrett1",
      capabilities,
      configuration: { language: "rust", buildkite: {} },
    });
    const doc = parse(pipelineFrom(files).content);
    const publish = doc.steps.find((step) => step.key === "docker_publish");
    return { publish, command: String(publish.commands[0]) };
  };

  it("keeps the whole publish in one shell", async () => {
    // Load-bearing, not tidiness. Buildkite runs each command of a step in its
    // own shell, so the credentials resolved in command 1 are gone by command 2,
    // and - the part that makes a naive skip guard useless - an `exit 0` in one
    // command does NOT stop the commands after it. Split back into three
    // commands and the skip below would skip nothing while looking correct.
    const { publish } = await publishCommand();
    expect(publish.commands).toHaveLength(1);
  });

  it("logs in through a per-job docker config instead of the shared keychain", async () => {
    const { command } = await publishCommand();

    expect(command).toContain(
      'export DOCKER_CONFIG="/tmp/bk-docker-$$BUILDKITE_JOB_ID"',
    );
    expect(command).toContain('mkdir -p "$$DOCKER_CONFIG"');
    // DOCKER_CONFIG also relocates the CLI-plugin directory, so the fresh
    // config dir hides docker-buildx and every buildx call dies as an unknown
    // ROOT flag ("unknown flag: --bootstrap", exit 125) before the push. The
    // plugin dir has to be linked back in. Pinned because that failure names
    // the flag - which is real - and points nowhere near the missing plugin.
    expect(command).toContain(
      'ln -sfn "$$HOME/.docker/cli-plugins" "$$DOCKER_CONFIG/cli-plugins"',
    );
    // The export has to come before the login, or the login writes to ~/.docker
    // and the race is back.
    expect(command.indexOf("export DOCKER_CONFIG")).toBeLessThan(
      command.indexOf("docker login ghcr.io"),
    );
    // And the isolated config is removed again - it holds a write:packages
    // token in plaintext once docker has written auth into it.
    expect(command).toContain('rm -rf "$$DOCKER_CONFIG"');
    // A single login: two logins in one step would race with itself.
    expect((command.match(/docker login ghcr\.io/g) || []).length).toBe(1);
  });

  it("skips the publish when the commit is already in the registry", async () => {
    const { command } = await publishCommand();

    expect(command).toContain(
      'if docker buildx imagetools inspect "$$IMAGE:$$BUILDKITE_COMMIT"',
    );
    expect(command).toContain("already in the registry - skipping the build.");
    // Before the build, which is the whole point.
    expect(command.indexOf("imagetools inspect")).toBeLessThan(
      command.indexOf("docker buildx build"),
    );
  });

  it("treats an unreachable registry as 'not published', never as 'published'", async () => {
    // Only a positive answer skips. The check is an `if` on success, so a
    // network failure or a 401 falls through to the push - "could not ask" must
    // not read as "already done", which would silently stop publishing.
    const { command } = await publishCommand();
    const guard = command.slice(command.indexOf("if docker buildx imagetools"));
    expect(guard).toContain("then");
    expect(guard).not.toMatch(/imagetools inspect[^\n]*\|\|\s*exit 0/);
    expect(guard).not.toContain("|| true");
  });

  it("still publishes in the no-doppler channel with the same guard", async () => {
    // The guard and the isolated config live outside the doppler branch, so a
    // project that takes its credentials from the agent environment gets both.
    const { command } = await publishCommand([
      "buildkite",
      "devcontainer-node",
      "docker-container",
    ]);
    expect(command).toContain(
      'export DOCKER_CONFIG="/tmp/bk-docker-$$BUILDKITE_JOB_ID"',
    );
    expect(command).toContain("imagetools inspect");
    expect(command).not.toContain("GHCR_UPDATE_TOKEN");
  });

  it("emits YAML that still parses", async () => {
    const { publish } = await publishCommand();
    expect(publish.if).toBe('build.branch == "main"');
    expect(publish.depends_on).toContain("docker_smoke");
    expect(publish.env.IMAGE).toBe("ghcr.io/nickbrett1/roost");
  });
});

describe("Buildkite output names Buildkite, never another CI provider", () => {
  // The generated docs must describe the CI that is actually selected. A
  // buildkite-selected project must never read as CircleCI-shaped: the leak
  // this pins was `deploy/README.md` and `.buildkite/README.md` telling the
  // reader to create a CircleCI context and pull GHCR credentials from it,
  // while the project's only pipeline is `.buildkite/pipeline.yml`.
  //
  // The shapes are chosen to exercise every file the CircleCI references used
  // to appear in: the deploy runbook (docker-container, with and without
  // doppler), the pipeline README, the emitted pipeline comments
  // (cloudflare-wrangler deploy), and the root README's capability list.
  const shapes = [
    ["buildkite", "devcontainer-node"],
    ["buildkite", "devcontainer-node", "docker-container"],
    ["buildkite", "devcontainer-node", "docker-container", "doppler"],
    ["buildkite", "devcontainer-node", "cloudflare-wrangler"],
    [
      "buildkite",
      "devcontainer-rust",
      "github-release",
      "lighthouse-ci",
      "cloudflare-wrangler",
      "docker-container",
      "doppler",
    ],
    ["buildkite", "devcontainer-python", "gitguardian", "sonarcloud"],
  ];

  it.each(shapes)(
    "emits no CircleCI reference for capabilities %j",
    async (...capabilities) => {
      const files = await generateAllFiles({
        name: "roost",
        registryNamespace: "nickbrett1",
        capabilities,
        configuration: { buildkite: {} },
      });

      // Every generated file, not a hand-picked subset: a reference in a file
      // this test does not know about is exactly the leak it needs to catch.
      for (const file of files) {
        expect(file.content, `${file.filePath} refers to CircleCI`).not.toMatch(
          /circleci/i,
        );
      }
    },
  );

  it("describes the agent environment hook and Doppler in the deploy runbook", async () => {
    // The positive half: the wording that replaced the CircleCI context is the
    // Buildkite channel (the agent's `environment` hook), and Doppler when it
    // is selected.
    const files = await generateAllFiles({
      name: "roost",
      registryNamespace: "nickbrett1",
      capabilities: [
        "buildkite",
        "devcontainer-node",
        "docker-container",
        "doppler",
      ],
      configuration: { buildkite: {} },
    });
    const readme = files.find((f) => f.filePath === "deploy/README.md");

    expect(readme.content).toContain("`.buildkite/pipeline.yml`");
    expect(readme.content).toContain("`docker_publish` step");
    expect(readme.content).toContain("agent's `environment` hook");
    expect(readme.content).toContain("GHCR_UPDATE_TOKEN");
    expect(readme.content).toContain("`common`/`prd`");
  });
});
