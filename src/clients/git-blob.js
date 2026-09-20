/**
 * Git blob hashing.
 *
 * A git blob object's id is `SHA-1("blob " + byteLength + "\0" + content)` over
 * the raw bytes. GitHub's `GET /git/trees/{tree_sha}?recursive=1` returns that
 * same id as the `sha` of every blob entry, so computing it locally lets us
 * decide "absent / byte-identical / diverged" for a generated file **without
 * fetching its content** — which is what keeps regeneration inside the
 * Cloudflare Workers Free-tier subrequest budget.
 *
 * This hashes the exact UTF-8 bytes of the JS string, matching how
 * `Buffer.from(content)` (used when the file was first written) encoded it.
 *
 * @fileoverview Local git blob SHA-1 computation for genproj.
 */

const encoder = new TextEncoder();

/**
 * Computes the git blob SHA-1 of a file's content.
 * @param {string} content - File content (UTF-8)
 * @returns {Promise<string>} Lowercase hex blob SHA
 */
export async function computeGitBlobSha(content) {
  const body = encoder.encode(content ?? "");
  const header = encoder.encode(`blob ${body.length}\u0000`);
  const store = new Uint8Array(header.length + body.length);
  store.set(header, 0);
  store.set(body, header.length);

  // SHA-1 is not a security choice here: it is the object-id algorithm git
  // itself uses for blobs, and the value must match git exactly.
  // eslint-disable-next-line sonarjs/hashing
  const digest = await crypto.subtle.digest("SHA-1", store);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
