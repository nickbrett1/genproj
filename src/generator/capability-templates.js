// src/generator/capability-templates.js

/**
 * Generator-internal template wiring, one entry per capability.
 *
 * These `templates[]` descriptors used to live alongside the capability
 * metadata in ftn's `config/capabilities.js`. They were deliberately left out of
 * the public catalog (the UI has no use for file paths), so they travel with
 * the generator instead.
 *
 * Exported as a plain object so `file-generator.js` can keep looking templates
 * up by capability id.
 */

export const capabilityTemplates = {
  "coding-agents": [
    {
      id: "mcp-config",
      filePath: ".agents/mcp_config.json",
      templateId: "mcp-config-json",
    },
    {
      id: "mcp-sse-proxy",
      filePath: ".agents/mcp-sse-proxy.cjs",
      templateId: "mcp-sse-proxy-js",
    },
    {
      id: "mcp-streamable-http-proxy",
      filePath: ".agents/mcp-streamable-http-proxy.cjs",
      templateId: "mcp-streamable-http-proxy-js",
    },
  ],
  "container-agent": [
    {
      id: "agent-dev",
      filePath: "scripts/agent-dev.sh",
      templateId: "scripts-agent-dev-sh",
      isExecutable: true,
    },
  ],
  "editor-tools": [
    {
      id: "vscode-tasks",
      filePath: ".vscode/tasks.json",
      templateId: "vscode-tasks-json",
    },
  ],
  "devcontainer-node": [
    {
      id: "devcontainer-json",
      filePath: ".devcontainer/devcontainer.json",
      templateId: "devcontainer-node-json",
    },
    {
      id: "dockerfile",
      filePath: ".devcontainer/Dockerfile",
      templateId: "devcontainer-node-dockerfile",
    },
    {
      id: "zshrc",
      filePath: ".devcontainer/.zshrc",
      templateId: "devcontainer-zshrc-full",
    },
    {
      id: "p10k",
      filePath: ".devcontainer/.p10k.zsh",
      templateId: "devcontainer-p10k-zsh-full",
    },
    {
      id: "tmux",
      filePath: ".devcontainer/.tmux.conf",
      templateId: "devcontainer-tmux-conf",
    },
    {
      id: "setup-sh",
      filePath: ".devcontainer/post-create-setup.sh",
      templateId: "devcontainer-post-create-setup-sh",
      isExecutable: true,
    },
    {
      id: "start-sh",
      filePath: ".devcontainer/post-start-setup.sh",
      templateId: "devcontainer-post-start-setup-sh",
      isExecutable: true,
    },
  ],
  sveltekit: [
    {
      id: "svelte-app-html",
      filePath: "src/app.html",
      templateId: "svelte-app-html",
    },
    {
      id: "svelte-page-svelte",
      filePath: "src/routes/+page.svelte",
      templateId: "svelte-page-svelte",
    },
    {
      id: "svelte-config-js",
      filePath: "svelte.config.js",
      templateId: "svelte-config-js",
    },
    {
      id: "svelte-vite-config-js",
      filePath: "vite.config.js",
      templateId: "svelte-vite-config-js",
    },
  ],
  "devcontainer-python": [
    {
      id: "devcontainer-json",
      filePath: ".devcontainer/devcontainer.json",
      templateId: "devcontainer-python-json",
    },
    {
      id: "dockerfile",
      filePath: ".devcontainer/Dockerfile",
      templateId: "devcontainer-python-dockerfile",
    },
    {
      id: "zshrc",
      filePath: ".devcontainer/.zshrc",
      templateId: "devcontainer-zshrc-full",
    },
    {
      id: "p10k",
      filePath: ".devcontainer/.p10k.zsh",
      templateId: "devcontainer-p10k-zsh-full",
    },
    {
      id: "tmux",
      filePath: ".devcontainer/.tmux.conf",
      templateId: "devcontainer-tmux-conf",
    },
    {
      id: "setup-sh",
      filePath: ".devcontainer/post-create-setup.sh",
      templateId: "devcontainer-post-create-setup-sh",
      isExecutable: true,
    },
    {
      id: "start-sh",
      filePath: ".devcontainer/post-start-setup.sh",
      templateId: "devcontainer-post-start-setup-sh",
      isExecutable: true,
    },
    {
      id: "pyproject-toml",
      filePath: "pyproject.toml",
      templateId: "pyproject-toml",
    },
  ],
  "devcontainer-java": [
    {
      id: "devcontainer-json",
      filePath: ".devcontainer/devcontainer.json",
      templateId: "devcontainer-java-json",
    },
    {
      id: "dockerfile",
      filePath: ".devcontainer/Dockerfile",
      templateId: "devcontainer-java-dockerfile",
    },
    {
      id: "zshrc",
      filePath: ".devcontainer/.zshrc",
      templateId: "devcontainer-zshrc-full",
    },
    {
      id: "p10k",
      filePath: ".devcontainer/.p10k.zsh",
      templateId: "devcontainer-p10k-zsh-full",
    },
    {
      id: "tmux",
      filePath: ".devcontainer/.tmux.conf",
      templateId: "devcontainer-tmux-conf",
    },
    {
      id: "setup-sh",
      filePath: ".devcontainer/post-create-setup.sh",
      templateId: "devcontainer-post-create-setup-sh",
      isExecutable: true,
    },
    {
      id: "start-sh",
      filePath: ".devcontainer/post-start-setup.sh",
      templateId: "devcontainer-post-start-setup-sh",
      isExecutable: true,
    },
  ],
  "devcontainer-rust": [
    {
      id: "devcontainer-json",
      filePath: ".devcontainer/devcontainer.json",
      templateId: "devcontainer-rust-json",
    },
    {
      id: "dockerfile",
      filePath: ".devcontainer/Dockerfile",
      templateId: "devcontainer-rust-dockerfile",
    },
    {
      id: "zshrc",
      filePath: ".devcontainer/.zshrc",
      templateId: "devcontainer-zshrc-full",
    },
    {
      id: "p10k",
      filePath: ".devcontainer/.p10k.zsh",
      templateId: "devcontainer-p10k-zsh-full",
    },
    {
      id: "tmux",
      filePath: ".devcontainer/.tmux.conf",
      templateId: "devcontainer-tmux-conf",
    },
    {
      id: "setup-sh",
      filePath: ".devcontainer/post-create-setup.sh",
      templateId: "devcontainer-post-create-setup-sh",
      isExecutable: true,
    },
    {
      id: "start-sh",
      filePath: ".devcontainer/post-start-setup.sh",
      templateId: "devcontainer-post-start-setup-sh",
      isExecutable: true,
    },
  ],
  circleci: [
    {
      id: "circleci-config",
      filePath: ".circleci/config.yml",
      templateId: "circleci-config",
    },
  ],
  buildkite: [
    {
      id: "buildkite-pipeline",
      filePath: ".buildkite/pipeline.yml",
      templateId: "buildkite-pipeline",
    },
    {
      id: "buildkite-readme",
      filePath: ".buildkite/README.md",
      templateId: "buildkite-readme",
    },
  ],
  "github-release": [
    {
      id: "github-release-notes",
      filePath: ".github/release.yml",
      templateId: "github-release-notes",
    },
    {
      id: "github-release-readme",
      filePath: "RELEASING.md",
      templateId: "github-release-readme",
    },
    {
      id: "github-release-artifacts",
      filePath: "scripts/release-artifacts.sh",
      templateId: "github-release-artifacts",
    },
    {
      id: "github-release-smoke-launch",
      filePath: "scripts/smoke-launch.sh",
      templateId: "github-release-smoke-launch",
      isExecutable: true,
    },
  ],
  "fetch-launch": [
    {
      id: "fetch-launch-readme",
      filePath: "LAUNCHING.md",
      templateId: "fetch-launch-readme",
    },
    {
      id: "fetch-launch-script",
      filePath: "scripts/fetch-launch.sh",
      templateId: "scripts-fetch-launch-sh",
      isExecutable: true,
    },
  ],
  doppler: [
    {
      id: "doppler-yaml",
      filePath: "doppler.yaml",
      templateId: "doppler-yaml",
    },
  ],
  sonarcloud: [
    {
      id: ".sonarcloud.properties",
      filePath: ".sonarcloud.properties",
      templateId: ".sonarcloud.properties",
    },
  ],
  "code-quality": [
    {
      id: "eslint-config-js",
      filePath: "eslint.config.js",
      templateId: "eslint-config-js",
    },
  ],
  "docker-container": [
    {
      id: "dockerfile",
      filePath: "Dockerfile",
      templateId: "dockerfile",
    },
    {
      id: "dockerignore",
      filePath: ".dockerignore",
      templateId: "dockerignore",
    },
    {
      id: "docker-compose",
      filePath: "docker-compose.yml",
      templateId: "docker-compose",
    },
    {
      id: "deploy-readme",
      filePath: "deploy/README.md",
      templateId: "deploy-readme",
    },
    {
      id: "homepage-snippet",
      filePath: "deploy/homepage-services.yaml",
      templateId: "homepage-services",
    },
    {
      id: "env-example",
      filePath: ".env.example",
      templateId: "env-example",
    },
  ],
  dependabot: [
    {
      id: "dependabot-config",
      filePath: ".github/dependabot.yml",
      templateId: "dependabot-config",
    },
    {
      id: "dependabot-auto-merge",
      filePath: ".github/workflows/dependabot-auto-merge.yml",
      templateId: "dependabot-auto-merge",
    },
  ],
  "lighthouse-ci": [
    {
      id: "lighthouse-ci-config",
      filePath: ".lighthouse.cjs",
      templateId: "lighthouse-ci-config",
    },
  ],
  micropython: [
    {
      id: "find-board",
      filePath: "scripts/find-board.sh",
      templateId: "scripts-find-board-sh",
      isExecutable: true,
    },
    {
      id: "post-create-micropython",
      filePath: ".devcontainer/post-create-micropython.sh",
      templateId: "devcontainer-post-create-micropython-sh",
      isExecutable: true,
    },
  ],
};

export default capabilityTemplates;
