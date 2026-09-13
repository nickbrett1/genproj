// tests/auth/service-secret.test.js

import { describe, expect, it } from "vitest";

import {
  authenticateService,
  requireService,
  SERVICE_SECRET_HEADER,
  USER_EMAIL_HEADER,
} from "../../src/auth/service-secret.js";

const ENV = { SERVICE_SECRET: "s3cret" };

/**
 * Builds a request carrying the given headers.
 * @param {Record<string, string>} headers Headers to set.
 * @returns {Request} The request.
 */
function request(headers = {}) {
  return new Request("https://genproj.example/v1/generate", { headers });
}

describe("authenticateService", () => {
  it("accepts the matching secret", async () => {
    const identity = await authenticateService(
      request({ [SERVICE_SECRET_HEADER]: "s3cret" }),
      ENV,
    );
    expect(identity).toEqual({ userEmail: "" });
  });

  it("reports the user the caller named", async () => {
    const identity = await authenticateService(
      request({
        [SERVICE_SECRET_HEADER]: "s3cret",
        [USER_EMAIL_HEADER]: "dev@example.com",
      }),
      ENV,
    );
    expect(identity).toEqual({ userEmail: "dev@example.com" });
  });

  it("rejects a request with no secret", async () => {
    expect(await authenticateService(request(), ENV)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const identity = await authenticateService(
      request({ [SERVICE_SECRET_HEADER]: "nope" }),
      ENV,
    );
    expect(identity).toBeNull();
  });

  it("rejects a secret that is only a prefix of the real one", async () => {
    // The comparison hashes both sides first, so a short input must not be
    // able to satisfy it by matching early bytes.
    const identity = await authenticateService(
      request({ [SERVICE_SECRET_HEADER]: "s3" }),
      ENV,
    );
    expect(identity).toBeNull();
  });

  it("rejects the secret sent with different casing", async () => {
    // Header names are case-insensitive, values are not.
    const identity = await authenticateService(
      request({ [SERVICE_SECRET_HEADER]: "S3CRET" }),
      ENV,
    );
    expect(identity).toBeNull();
  });

  it("throws when the deployment has no secret configured", async () => {
    // Silently rejecting every internal call would look like a broken deploy
    // rather than a missing configuration.
    await expect(
      authenticateService(request({ [SERVICE_SECRET_HEADER]: "s3cret" }), {}),
    ).rejects.toThrow("SERVICE_SECRET is not configured");
  });
});

describe("requireService", () => {
  it("hands back the identity when the secret matches", async () => {
    const result = await requireService(
      request({ [SERVICE_SECRET_HEADER]: "s3cret" }),
      ENV,
    );
    expect(result.identity).toEqual({ userEmail: "" });
    expect(result.response).toBeUndefined();
  });

  it("returns a 401 response when the secret does not match", async () => {
    const { response } = await requireService(request(), ENV);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Unauthorized" });
  });

  it("returns a 500 response when the deployment is misconfigured", async () => {
    const { response } = await requireService(
      request({ [SERVICE_SECRET_HEADER]: "s3cret" }),
      {},
    );
    expect(response.status).toBe(500);
    expect((await response.json()).message).toMatch(/SERVICE_SECRET/);
  });
});
