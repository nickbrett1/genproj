import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { GitHubAPIService } from "../../src/clients/github-api.js";
import { computeGitBlobSha } from "../../src/clients/git-blob.js";

describe("GitHubAPIService", () => {
  let service;

  beforeEach(() => {
    service = new GitHubAPIService("token");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Wires `makeRequest` for a `createMultipleFiles` run: branch head, the
   * GraphQL content commit, and (when a `.sh` is present) the mode-fix
   * tree/commit/ref cycle.
   * @param {Object} config
   * @param {Object} config.commit - GraphQL `commit` payload
   * @param {string} [config.modeCommitSha] - SHA returned by the mode-fix commit
   * @returns {{requests: Object[]}} Recorded `{endpoint, options}` calls
   */
  function mockCommitEndpoints({ commit, modeCommitSha = "mode-commit" }) {
    const requests = [];
    vi.spyOn(service, "makeRequest").mockImplementation(
      async (endpoint, options = {}) => {
        requests.push({ endpoint, options });
        if (
          endpoint === "/repos/user/repo/git/refs/heads/main" &&
          !options.method
        ) {
          return {
            json: vi.fn().mockResolvedValue({ object: { sha: "head-sha" } }),
          };
        }
        if (endpoint === "/graphql") {
          return {
            json: vi.fn().mockResolvedValue({
              data: { createCommitOnBranch: { commit } },
            }),
          };
        }
        if (endpoint === "/repos/user/repo/git/trees") {
          return { json: vi.fn().mockResolvedValue({ sha: "mode-tree" }) };
        }
        if (endpoint === "/repos/user/repo/git/commits") {
          return {
            json: vi.fn().mockResolvedValue({ sha: modeCommitSha }),
          };
        }
        if (
          endpoint === "/repos/user/repo/git/refs/heads/main" &&
          options.method === "PATCH"
        ) {
          return {};
        }
        throw new Error(`unexpected request: ${endpoint}`);
      },
    );
    return { requests };
  }

  it("makes authenticated requests and handles failures", async () => {
    const response = { ok: true, status: 200, statusText: "OK" };
    fetch.mockResolvedValueOnce(response);
    expect(await service.makeRequest("/user")).toEqual(response);
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/user", {
      headers: service.headers,
    });

    fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    await expect(service.makeRequest("/missing")).rejects.toThrow(
      "GitHub API error: 404 Not Found",
    );
  });

  it("retrieves user info and creates repositories", async () => {
    const userData = { login: "user" };
    const repoPayload = {
      name: "repo",
      full_name: "user/repo",
      clone_url: "clone",
      html_url: "html",
      private: false,
    };

    vi.spyOn(service, "makeRequest")
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue(userData) }) // getUserInfo
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue(repoPayload) }); // createRepository

    expect(await service.getUserInfo()).toEqual(userData);
    expect(await service.createRepository("repo", "desc")).toMatchObject({
      fullName: "user/repo",
      htmlUrl: "html",
    });
  });

  it("checks repository existence", async () => {
    const spy = vi.spyOn(service, "makeRequest");
    spy.mockResolvedValueOnce({});
    expect(await service.repositoryExists("user", "repo")).toBe(true);

    spy.mockRejectedValueOnce(new Error("GitHub API error: 404 Not Found"));
    expect(await service.repositoryExists("user", "repo")).toBe(false);
  });

  it("gets file content", async () => {
    const content = "Hello World";
    const base64Content = Buffer.from(content).toString("base64");
    const jsonMock = vi.fn();

    vi.spyOn(service, "makeRequest").mockResolvedValue({ json: jsonMock });

    // Success case
    jsonMock.mockResolvedValueOnce({ content: base64Content });
    const result1 = await service.getFileContent("user", "repo", "file.txt");
    expect(result1).toBe(content);
    expect(service.makeRequest).toHaveBeenCalledWith(
      "/repos/user/repo/contents/file.txt",
    );

    // Not found case
    service.makeRequest.mockRejectedValueOnce(
      new Error("GitHub API error: 404 Not Found"),
    );
    const result2 = await service.getFileContent("user", "repo", "missing.txt");
    expect(result2).toBeNull();
  });

  it("creates or updates files with existing sha detection", async () => {
    const getFileJson = vi.fn().mockResolvedValue({ sha: "abc123" });
    const putJson = vi
      .fn()
      .mockResolvedValue({ content: { path: "README.md" } });

    vi.spyOn(service, "makeRequest")
      .mockResolvedValueOnce({ json: getFileJson })
      .mockResolvedValueOnce({ json: putJson });

    const result = await service.createOrUpdateFile("user", "repo", {
      path: "README.md",
      content: "Hello",
      message: "Update README",
    });

    expect(result).toEqual({ content: { path: "README.md" } });
    const [, options] = service.makeRequest.mock.calls.at(-1);
    expect(JSON.parse(options.body)).toMatchObject({
      message: "Update README",
      branch: "main",
      sha: "abc123",
    });

    // New file path should omit sha
    service.makeRequest.mockReset();
    vi.spyOn(service, "makeRequest")
      .mockRejectedValueOnce(new Error("GitHub API error: 404 Not Found"))
      .mockResolvedValueOnce({ json: putJson });

    await service.createOrUpdateFile("user", "repo", {
      path: "LICENSE",
      content: "MIT",
      message: "Add LICENSE",
    });
    const [, newOptions] = service.makeRequest.mock.calls.at(-1);
    expect(JSON.parse(newOptions.body)).not.toHaveProperty("sha");
  });

  it("creates multiple files in a single GraphQL commit (no per-file blob POSTs)", async () => {
    const { requests } = mockCommitEndpoints({
      commit: { oid: "commit-sha", url: "url", tree: { oid: "content-tree" } },
    });

    const commit = await service.createMultipleFiles(
      "user",
      "repo",
      [{ path: "file.txt", content: "content" }],
      "Initial commit",
    );

    expect(commit.sha).toBe("commit-sha");

    // The whole fan-out of blob POSTs is gone: exactly one GraphQL mutation.
    expect(requests.some((request) => request.endpoint === "/graphql")).toBe(
      true,
    );
    expect(
      requests.some((request) => request.endpoint.endsWith("/git/blobs")),
    ).toBe(false);

    const graphql = requests.find((request) => request.endpoint === "/graphql");
    const body = JSON.parse(graphql.options.body);
    expect(body.variables.input.expectedHeadOid).toBe("head-sha");
    expect(body.variables.input.branch).toEqual({
      repositoryNameWithOwner: "user/repo",
      branchName: "main",
    });
    expect(body.variables.input.message).toEqual({
      headline: "Initial commit",
    });
    expect(body.variables.input.fileChanges.additions).toEqual([
      { path: "file.txt", contents: Buffer.from("content").toString("base64") },
    ]);
  });

  it("preserves the executable bit via a single mode-fix commit for .sh files", async () => {
    const { requests } = mockCommitEndpoints({
      commit: {
        oid: "content-commit",
        url: "url",
        tree: { oid: "content-tree" },
      },
      modeCommitSha: "mode-commit",
    });

    const commit = await service.createMultipleFiles(
      "user",
      "repo",
      [
        { path: "file.txt", content: "content" },
        { path: "script.sh", content: 'echo "hello"' },
      ],
      "Initial commit",
    );

    // Callers receive the FINAL commit (the one with correct modes).
    expect(commit.sha).toBe("mode-commit");

    // GraphQL cannot express a mode, so the .sh is re-pointed at 100755 with a
    // locally computed blob sha — no content re-upload.
    const treeRequest = requests.find(
      (request) => request.endpoint === "/repos/user/repo/git/trees",
    );
    expect(treeRequest).toBeDefined();
    const treeBody = JSON.parse(treeRequest.options.body);
    expect(treeBody.base_tree).toBe("content-tree");
    expect(treeBody.tree).toEqual([
      {
        path: "script.sh",
        mode: "100755",
        type: "blob",
        sha: await computeGitBlobSha('echo "hello"'),
      },
    ]);

    const lastCall = requests.at(-1);
    expect(lastCall.endpoint).toBe("/repos/user/repo/git/refs/heads/main");
    expect(lastCall.options.method).toBe("PATCH");
  });

  it("omits the mode-fix commit when no .sh files are written", async () => {
    const { requests } = mockCommitEndpoints({
      commit: { oid: "content-commit", url: "url", tree: { oid: "tree" } },
    });

    const commit = await service.createMultipleFiles(
      "user",
      "repo",
      [{ path: "file.txt", content: "content" }],
      "Initial commit",
    );

    expect(commit.sha).toBe("content-commit");
    expect(
      requests.some((request) => request.endpoint.endsWith("/git/trees")),
    ).toBe(false);
  });

  it("surfaces GraphQL errors", async () => {
    vi.spyOn(service, "makeRequest").mockImplementation(async (endpoint) => {
      if (endpoint === "/repos/user/repo/git/refs/heads/main") {
        return {
          json: vi.fn().mockResolvedValue({ object: { sha: "head-sha" } }),
        };
      }
      return {
        json: vi.fn().mockResolvedValue({ errors: [{ message: "boom" }] }),
      };
    });

    await expect(
      service.createMultipleFiles(
        "user",
        "repo",
        [{ path: "file.txt", content: "content" }],
        "Initial commit",
      ),
    ).rejects.toThrow("GitHub GraphQL error: boom");
  });

  it("fetches a recursive tree as a path -> blob sha map", async () => {
    const treeJson = vi.fn().mockResolvedValue({
      truncated: false,
      tree: [
        { path: "a.txt", type: "blob", sha: "sha-a", mode: "100644" },
        { path: "dir", type: "tree", sha: "tree-sha", mode: "040000" },
        { path: "dir/b.sh", type: "blob", sha: "sha-b", mode: "100755" },
      ],
    });
    vi.spyOn(service, "makeRequest").mockResolvedValue({ json: treeJson });

    const result = await service.getTree("user", "repo", "main");

    expect(service.makeRequest).toHaveBeenCalledWith(
      "/repos/user/repo/git/trees/main?recursive=1",
    );
    expect(result.truncated).toBe(false);
    expect(result.entries.get("a.txt")).toBe("sha-a");
    expect(result.entries.get("dir/b.sh")).toBe("sha-b");
    expect(result.entries.has("dir")).toBe(false);
  });

  it("creates webhooks, lists repos and deletes repository", async () => {
    const webhookJson = vi.fn().mockResolvedValue({ id: 1 });
    const reposJson = vi.fn().mockResolvedValue([{ name: "repo" }]);

    vi.spyOn(service, "makeRequest")
      .mockResolvedValueOnce({ json: webhookJson })
      .mockResolvedValueOnce({ json: reposJson })
      .mockResolvedValueOnce({});

    expect(
      await service.createWebhook("user", "repo", "https://example.com", [
        "push",
      ]),
    ).toEqual({
      id: 1,
    });
    expect(await service.listRepositories("all", "updated", 5)).toEqual([
      { name: "repo" },
    ]);

    await service.deleteRepository("user", "repo");
  });

  it("lists webhooks for a repository", async () => {
    const hooksJson = vi
      .fn()
      .mockResolvedValue([
        { id: 1, config: { url: "https://circleci.com/hooks/github" } },
      ]);
    const makeRequest = vi.spyOn(service, "makeRequest").mockResolvedValue({
      json: hooksJson,
    });

    const hooks = await service.listWebhooks("user", "repo");

    expect(makeRequest).toHaveBeenCalledWith("/repos/user/repo/hooks");
    expect(hooks).toEqual([
      { id: 1, config: { url: "https://circleci.com/hooks/github" } },
    ]);
  });

  it("enables auto-merge by PATCHing allow_auto_merge", async () => {
    const repoJson = vi.fn().mockResolvedValue({ allow_auto_merge: true });
    const makeRequest = vi
      .spyOn(service, "makeRequest")
      .mockResolvedValue({ json: repoJson });

    const result = await service.enableAutoMerge("user", "repo");

    expect(makeRequest).toHaveBeenCalledWith("/repos/user/repo", {
      method: "PATCH",
      body: JSON.stringify({ allow_auto_merge: true }),
    });
    expect(result).toEqual({ allowAutoMerge: true });
  });

  it("reports when auto-merge is still disabled", async () => {
    const repoJson = vi.fn().mockResolvedValue({ allow_auto_merge: false });
    vi.spyOn(service, "makeRequest").mockResolvedValue({ json: repoJson });

    expect(await service.enableAutoMerge("user", "repo")).toEqual({
      allowAutoMerge: false,
    });
  });

  it("retrieves repositories and validates token", async () => {
    const repoPayload = {
      name: "repo",
      full_name: "user/repo",
      clone_url: "clone",
      html_url: "html",
      private: false,
      default_branch: "main",
    };
    const repoJson = vi.fn().mockResolvedValue(repoPayload);
    vi.spyOn(service, "makeRequest").mockResolvedValue({ json: repoJson });

    expect(await service.getRepository("user", "repo")).toEqual({
      name: "repo",
      fullName: "user/repo",
      cloneUrl: "clone",
      htmlUrl: "html",
      private: false,
      defaultBranch: "main",
    });
    expect(await service.validateToken()).toBe(true);

    service.makeRequest.mockReset();
    vi.spyOn(service, "getUserInfo").mockRejectedValue(new Error("bad token"));
    expect(await service.validateToken()).toBe(false);
  });

  it("handles errors in repository creation", async () => {
    vi.spyOn(service, "makeRequest").mockRejectedValueOnce(
      new Error("name already exists on this account"),
    );
    await expect(service.createRepository("repo", "desc")).rejects.toThrow(
      "Repository already exists",
    );

    vi.spyOn(service, "makeRequest").mockRejectedValueOnce(
      new Error("Other error"),
    );
    await expect(service.createRepository("repo", "desc")).rejects.toThrow(
      "Other error",
    );
  });

  it("handles errors in repository existence check", async () => {
    vi.spyOn(service, "makeRequest").mockRejectedValueOnce(
      new Error("Other error"),
    );
    await expect(service.repositoryExists("user", "repo")).rejects.toThrow(
      "Other error",
    );
  });

  it("handles errors in get file content", async () => {
    vi.spyOn(service, "makeRequest").mockRejectedValueOnce(
      new Error("Other error"),
    );
    await expect(
      service.getFileContent("user", "repo", "file.txt"),
    ).rejects.toThrow("Other error");
  });

  it("handles errors in create or update file", async () => {
    vi.spyOn(service, "makeRequest").mockRejectedValueOnce(
      new Error("Other error"),
    );
    await expect(
      service.createOrUpdateFile("user", "repo", {
        path: "file.txt",
        content: "content",
      }),
    ).rejects.toThrow("Other error");
  });

  it("creates or updates a repository secret", async () => {
    // Provide a valid base64 key generated by sodium.crypto_box_keypair() to avoid "invalid publicKey length"
    const keyJson = vi.fn().mockResolvedValue({
      key: "/qKPNvqjqqVSQ6HlREVr10yqNv6g09wcUdSBthIYBTs=",
      key_id: "123",
    });

    vi.spyOn(service, "makeRequest")
      .mockResolvedValueOnce({ json: keyJson })
      .mockResolvedValueOnce({});

    await service.createRepositorySecret(
      "user",
      "repo",
      "MYTOKEN",
      "mysecretvalue",
    );

    // Check if it got the public key
    expect(service.makeRequest).toHaveBeenCalledWith(
      "/repos/user/repo/actions/secrets/public-key",
    );

    // Check if it set the secret
    const [, putOptions] = service.makeRequest.mock.calls.at(-1);
    expect(service.makeRequest).toHaveBeenLastCalledWith(
      "/repos/user/repo/actions/secrets/MYTOKEN",
      expect.anything(),
    );
    expect(putOptions.method).toBe("PUT");
    const body = JSON.parse(putOptions.body);
    expect(body).toHaveProperty("encrypted_value");
    expect(body.key_id).toBe("123");
  });
});
