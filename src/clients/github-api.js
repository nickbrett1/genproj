/**
 * GitHub API Service
 *
 * Provides integration with GitHub API for repository creation, file management,
 * and webhook configuration in the genproj tool.
 *
 * @fileoverview Server-side GitHub API integration service
 */

/**
 * @typedef {Object} GitHubRepository
 * @property {string} name - Repository name
 * @property {string} fullName - Full repository name (owner/repo)
 * @property {string} cloneUrl - Clone URL
 * @property {string} htmlUrl - GitHub web URL
 * @property {boolean} private - Whether repository is private
 */

/**
 * @typedef {Object} GitHubFile
 * @property {string} path - File path in repository
 * @property {string} content - File content (base64 encoded)
 * @property {string} message - Commit message
 * @property {string} [branch] - Branch name (default: main)
 */

import { BaseAPIService } from "./base-api-service.js";
import { computeGitBlobSha } from "./git-blob.js";
import _sodium from "libsodium-wrappers";

/**
 * GitHub API service class
 */
export class GitHubAPIService extends BaseAPIService {
  /**
   * Creates a new GitHub API service instance
   * @param {string} token - GitHub access token
   */
  constructor(token) {
    super(
      token,
      "https://api.github.com",
      {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "genproj-tool",
      },
      "GitHub",
    );
  }

  /**
   * Gets the authenticated user's information
   * @returns {Promise<Object>} User information
   */
  async getUserInfo() {
    const response = await this.makeRequest("/user");
    return response.json();
  }

  /**
   * Creates a new repository
   * @param {string} name - Repository name
   * @param {string} description - Repository description
   * @param {boolean} [private=false] - Whether repository should be private
   * @param {boolean} [autoInit=true] - Whether to initialize with README
   * @returns {Promise<GitHubRepository>} Created repository information
   */
  async createRepository(
    name,
    description,
    isPrivate = false,
    autoInit = true,
  ) {
    console.log(`🔄 Creating GitHub repository: ${name}`);

    const repositoryData = {
      name,
      description,
      private: isPrivate,
      auto_init: autoInit,
      gitignore_template: "Node",
      license_template: "mit",
    };

    let response;
    try {
      response = await this.makeRequest("/user/repos", {
        method: "POST",
        body: JSON.stringify(repositoryData),
      });
    } catch (error) {
      if (error.message.includes("name already exists on this account")) {
        const e = new Error("Repository already exists");
        // @ts-ignore
        e.code = "REPOSITORY_EXISTS";
        throw e;
      }
      throw error;
    }

    const repository = await response.json();

    console.log(`✅ GitHub repository created: ${repository.full_name}`);

    return {
      name: repository.name,
      fullName: repository.full_name,
      cloneUrl: repository.clone_url,
      htmlUrl: repository.html_url,
      private: repository.private,
      defaultBranch: repository.default_branch || "main",
    };
  }

  /**
   * Checks if a repository exists
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<boolean>} Whether repository exists
   */
  async repositoryExists(owner, repo) {
    try {
      await this.makeRequest(`/repos/${owner}/${repo}`);
      return true;
    } catch (error) {
      if (error.message.includes("404")) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Gets the content of a file in the repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} path - File path
   * @returns {Promise<string|null>} File content or null if not found
   */
  async getFileContent(owner, repo, path) {
    try {
      const response = await this.makeRequest(
        `/repos/${owner}/${repo}/contents/${path}`,
      );
      const data = await response.json();
      return Buffer.from(data.content, "base64").toString("utf-8");
    } catch (error) {
      if (error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Creates or updates a file in the repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {GitHubFile} file - File information
   * @returns {Promise<Object>} Commit information
   */
  async createOrUpdateFile(owner, repo, file) {
    console.log(`🔄 Creating/updating file: ${file.path} in ${owner}/${repo}`);

    // Get current file SHA if it exists
    let sha = null;
    try {
      const currentFile = await this.makeRequest(
        `/repos/${owner}/${repo}/contents/${file.path}`,
      );
      const currentFileData = await currentFile.json();
      sha = currentFileData.sha;
    } catch (error) {
      // File doesn't exist, which is fine for new files
      if (!error.message.includes("404")) {
        throw error;
      }
    }

    const fileData = {
      message: file.message,
      content: Buffer.from(file.content).toString("base64"),
      branch: file.branch || "main",
    };

    if (sha) {
      fileData.sha = sha;
    }

    const response = await this.makeRequest(
      `/repos/${owner}/${repo}/contents/${file.path}`,
      {
        method: "PUT",
        body: JSON.stringify(fileData),
      },
    );

    const result = await response.json();

    console.log(`✅ File ${sha ? "updated" : "created"}: ${file.path}`);

    return result;
  }

  /**
   * Resolves the SHA of a branch's head commit.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} [branch='main'] - Branch name
   * @returns {Promise<string>} Head commit SHA
   */
  async getBranchHeadSha(owner, repo, branch = "main") {
    const response = await this.makeRequest(
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    );
    const data = await response.json();
    const sha = data?.object?.sha;
    if (!sha) {
      throw new Error(
        `Could not resolve the head of ${owner}/${repo}@${branch}`,
      );
    }
    return sha;
  }

  /**
   * Fetches a repository tree recursively in a single request.
   *
   * `treeish` may be a tree SHA or a ref (branch/tag) name. Each blob entry's
   * `sha` is the git blob hash, which is what lets callers compare generated
   * content against the repository without fetching any file content.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} treeish - Tree SHA or branch/tag name
   * @returns {Promise<{entries: Map<string, string>, truncated: boolean}>}
   *   Map of blob path -> blob SHA, plus whether GitHub truncated the response
   */
  async getTree(owner, repo, treeish) {
    const response = await this.makeRequest(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeish)}?recursive=1`,
    );
    const data = await response.json();
    const entries = new Map();
    for (const entry of data.tree || []) {
      if (entry.type === "blob") {
        entries.set(entry.path, entry.sha);
      }
    }
    return { entries, truncated: Boolean(data.truncated) };
  }

  /**
   * Issues a GitHub GraphQL v4 request and unwraps the `data` payload.
   * @param {string} query - GraphQL document
   * @param {Object} [variables] - GraphQL variables
   * @returns {Promise<Object>} The response's `data`
   */
  async makeGraphQLRequest(query, variables = {}) {
    const response = await this.makeRequest("/graphql", {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error(
        `GitHub GraphQL error: ${payload.errors
          .map((error) => error.message)
          .join("; ")}`,
      );
    }
    return payload.data;
  }

  /**
   * Re-points the executable files' blobs at mode 100755.
   *
   * `createCommitOnBranch`'s `FileAddition` has no mode field, so every
   * addition lands as `100644`. The content commit has already created the
   * blobs, so this lays a single new tree on top of that commit's tree with the
   * `.sh` entries marked executable — no content is re-uploaded. It is a
   * second commit by construction; it only runs when a `.sh` file was written.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} branch - Branch name
   * @param {string} parentOid - The content commit's oid (new parent)
   * @param {string} baseTreeOid - The content commit's tree oid
   * @param {GitHubFile[]} files - The executable files
   * @returns {Promise<{oid: string}>} The mode-fix commit
   */
  async #applyExecutableModes(
    owner,
    repo,
    branch,
    parentOid,
    baseTreeOid,
    files,
  ) {
    const treeEntries = await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        mode: "100755",
        type: "blob",
        sha: await computeGitBlobSha(file.content),
      })),
    );

    const treeResponse = await this.makeRequest(
      `/repos/${owner}/${repo}/git/trees`,
      {
        method: "POST",
        body: JSON.stringify({ base_tree: baseTreeOid, tree: treeEntries }),
      },
    );
    const treeData = await treeResponse.json();

    const commitResponse = await this.makeRequest(
      `/repos/${owner}/${repo}/git/commits`,
      {
        method: "POST",
        body: JSON.stringify({
          message: "chore: mark generated scripts executable",
          tree: treeData.sha,
          parents: [parentOid],
        }),
      },
    );
    const commitData = await commitResponse.json();

    await this.makeRequest(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commitData.sha }),
    });

    return { oid: commitData.sha };
  }

  /**
   * Creates multiple files in a single commit.
   *
   * Uses the GraphQL `createCommitOnBranch` mutation, which carries every
   * file's content in one request — replacing the old per-file
   * `POST /git/blobs` fan-out (N subrequests) plus the tree/commit/ref dance
   * (N + ~5). The mutation commits all files atomically and returns the new
   * commit oid; `fileChanges.deletions` is supported too.
   *
   * Because `FileAddition` cannot set a file mode, a single follow-up Git Data
   * API commit re-points `.sh` blobs at `100755` (`#applyExecutableModes`).
   * Blob SHAs are computed locally, so nothing is re-uploaded.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {GitHubFile[]} files - Array of files to create
   * @param {string} commitMessage - Commit message
   * @param {string} [branch='main'] - Branch name
   * @param {Object} [options]
   * @param {string[]} [options.deletions] - Paths to delete in the same commit
   * @returns {Promise<Object>} Commit information (`{ sha, url }`)
   */
  async createMultipleFiles(
    owner,
    repo,
    files,
    commitMessage,
    branch = "main",
    options = {},
  ) {
    console.log(
      `🔄 Creating ${files.length} files in ${owner}/${repo} on branch ${branch}`,
    );

    // createCommitOnBranch requires the branch head oid (optimistic concurrency).
    const headOid = await this.getBranchHeadSha(owner, repo, branch);

    const additions = files.map((file) => ({
      path: file.path,
      contents: Buffer.from(file.content).toString("base64"),
    }));
    const deletions = (options.deletions || []).map((path) => ({ path }));

    const data = await this.makeGraphQLRequest(
      `mutation CreateCommitOnBranch($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) {
          commit { oid url tree { oid } }
        }
      }`,
      {
        input: {
          branch: {
            repositoryNameWithOwner: `${owner}/${repo}`,
            branchName: branch,
          },
          message: { headline: commitMessage },
          expectedHeadOid: headOid,
          fileChanges: { additions, deletions },
        },
      },
    );

    const commit = data?.createCommitOnBranch?.commit;
    if (!commit?.oid) {
      throw new Error("GitHub GraphQL createCommitOnBranch returned no commit");
    }

    // Preserve the executable bit on shell scripts (GraphQL cannot express it).
    const executableFiles = files.filter((file) => file.path.endsWith(".sh"));
    let finalCommit = commit;
    if (executableFiles.length > 0) {
      finalCommit = await this.#applyExecutableModes(
        owner,
        repo,
        branch,
        commit.oid,
        commit.tree?.oid,
        executableFiles,
      );
    }

    console.log(
      `✅ Created ${files.length} files in commit: ${finalCommit.oid}`,
    );

    return { sha: finalCommit.oid, url: finalCommit.url };
  }

  /**
   * Sets up a webhook for the repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} webhookUrl - Webhook URL
   * @param {string[]} events - Events to listen for
   * @returns {Promise<Object>} Webhook information
   */
  async createWebhook(
    owner,
    repo,
    webhookUrl,
    events = ["push", "pull_request"],
  ) {
    console.log(`🔄 Creating webhook for ${owner}/${repo}`);

    const webhookData = {
      name: "web",
      active: true,
      events,
      config: {
        url: webhookUrl,
        content_type: "json",
      },
    };

    const response = await this.makeRequest(`/repos/${owner}/${repo}/hooks`, {
      method: "POST",
      body: JSON.stringify(webhookData),
    });

    const webhook = await response.json();

    console.log(`✅ Webhook created: ${webhook.id}`);

    return webhook;
  }

  /**
   * Lists the webhooks configured on a repository.
   *
   * Used by genproj to verify that CircleCI has actually installed its push
   * webhook (`https://circleci.com/hooks/github`) on a freshly-created repo.
   * CircleCI installs this webhook when it indexes a repo, so its absence is a
   * reliable signal that CircleCI cannot see the new repository yet.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<Object[]>} Array of webhook objects
   */
  async listWebhooks(owner, repo) {
    const response = await this.makeRequest(`/repos/${owner}/${repo}/hooks`);
    return response.json();
  }

  /**
   * Enables auto-merge on a repository.
   *
   * The generated `.github/workflows/dependabot-auto-merge.yml` runs
   * `gh pr merge --auto --merge`, which fails with
   * `GraphQL: Auto merge is not allowed for this repository
   * (enablePullRequestAutoMerge)` unless the repository setting
   * `allow_auto_merge` is true. That setting is a repository property, not a
   * file, so emitting the workflow alone cannot provision what it assumes —
   * genproj has to PATCH it, the same way `createWebhook` provisions the
   * webhook the CircleCI/Buildkite integration assumes exists.
   *
   * Best-effort and idempotent: GitHub accepts a PATCH that repeats the
   * current value.
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<{allowAutoMerge: boolean}>} Updated auto-merge setting
   */
  async enableAutoMerge(owner, repo) {
    console.log(`🔄 Enabling auto-merge for ${owner}/${repo}`);

    const response = await this.makeRequest(`/repos/${owner}/${repo}`, {
      method: "PATCH",
      body: JSON.stringify({ allow_auto_merge: true }),
    });

    const repository = await response.json();
    const allowAutoMerge = repository.allow_auto_merge === true;

    console.log(
      allowAutoMerge
        ? `✅ Auto-merge enabled for ${owner}/${repo}`
        : `⚠️ Auto-merge still disabled for ${owner}/${repo}`,
    );

    return { allowAutoMerge };
  }

  /**
   * Gets repository information
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<Object>} Repository information
   */
  async getRepository(owner, repo) {
    const response = await this.makeRequest(`/repos/${owner}/${repo}`);
    const repository = await response.json();
    return {
      name: repository.name,
      fullName: repository.full_name,
      cloneUrl: repository.clone_url,
      htmlUrl: repository.html_url,
      private: repository.private,
      defaultBranch: repository.default_branch || "main",
    };
  }

  /**
   * Lists user's repositories
   * @param {string} [type='all'] - Repository type (all, owner, public, private)
   * @param {string} [sort='updated'] - Sort order (created, updated, pushed, full_name)
   * @param {number} [perPage=30] - Number of repositories per page
   * @returns {Promise<Object[]>} Array of repositories
   */
  async listRepositories(type = "all", sort = "updated", perPage = 30) {
    const parameters = new URLSearchParams({
      type,
      sort,
      per_page: perPage.toString(),
    });

    const response = await this.makeRequest(
      `/user/repos?${parameters.toString()}`,
    );
    return response.json();
  }

  /**
   * Creates or updates a repository secret
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} secretName - Name of the secret
   * @param {string} secretValue - Unencrypted value of the secret
   * @returns {Promise<void>}
   */
  async createRepositorySecret(owner, repo, secretName, secretValue) {
    console.log(
      `🔄 Creating/updating secret ${secretName} for ${owner}/${repo}`,
    );

    // 1. Get the repository public key
    const keyResponse = await this.makeRequest(
      `/repos/${owner}/${repo}/actions/secrets/public-key`,
    );
    const { key, key_id } = await keyResponse.json();

    // 2. Encrypt the secret using libsodium
    await _sodium.ready;
    const sodium = _sodium;

    // Convert strings to Uint8Arrays
    const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
    const binsec = sodium.from_string(secretValue);

    // Encrypt the secret
    const encBytes = sodium.crypto_box_seal(binsec, binkey);

    // Convert to base64
    const encryptedValue = sodium.to_base64(
      encBytes,
      sodium.base64_variants.ORIGINAL,
    );

    // 3. Create or update the secret
    await this.makeRequest(
      `/repos/${owner}/${repo}/actions/secrets/${secretName}`,
      {
        method: "PUT",
        body: JSON.stringify({
          encrypted_value: encryptedValue,
          key_id: key_id,
        }),
      },
    );

    console.log(`✅ Secret ${secretName} created/updated successfully`);
  }

  /**
   * Deletes a repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<void>}
   */
  async deleteRepository(owner, repo) {
    console.log(`🔄 Deleting repository: ${owner}/${repo}`);

    await this.makeRequest(`/repos/${owner}/${repo}`, {
      method: "DELETE",
    });

    console.log(`✅ Repository deleted: ${owner}/${repo}`);
  }

  /**
   * Validates the GitHub token by making a test API call
   * @returns {Promise<boolean>} Whether the token is valid
   */
  async validateToken() {
    try {
      await this.getUserInfo();
      return true;
    } catch (error) {
      console.error(`❌ GitHub token validation failed: ${error.message}`);
      return false;
    }
  }
}
