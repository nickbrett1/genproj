/**
 * @fileoverview Local git blob SHA-1 computation.
 *
 * The value must match `git hash-object` exactly (i.e. the `sha` GitHub returns
 * for a blob in `GET /git/trees/{sha}?recursive=1`), because that equality is
 * what lets regeneration skip content reads.
 */

import { describe, it, expect } from "vitest";
import { computeGitBlobSha } from "../../src/clients/git-blob.js";

describe("computeGitBlobSha", () => {
  it("matches git hash-object for an empty blob", async () => {
    expect(await computeGitBlobSha("")).toBe(
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    );
  });

  it("matches git hash-object for text content", async () => {
    expect(await computeGitBlobSha("hello world\n")).toBe(
      "3b18e512dba79e4c8300dd08aeb37f8e728b8dad",
    );
    expect(await computeGitBlobSha("content")).toBe(
      "6b584e8ece562ebffc15d38808cd6b98fc3d97ea",
    );
  });

  it("hashes UTF-8 bytes, not UTF-16 code units", async () => {
    expect(await computeGitBlobSha("héllo")).toBe(
      "e507eb59f765207ed66c258795260c8bedbee89c",
    );
  });

  it("handles null/undefined content as empty", async () => {
    expect(await computeGitBlobSha(null)).toBe(await computeGitBlobSha(""));
    expect(await computeGitBlobSha(undefined)).toBe(
      await computeGitBlobSha(""),
    );
  });
});
