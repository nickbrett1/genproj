import { describe, it, expect } from "vitest";
import { buildProjectContext } from "../../src/generator/project-context.js";
import { DEFAULT_MCPHUB_BASE_URL } from "../../src/generator/capability-template-utils.js";

/**
 * The MCPHub origin is deployment data. It is read from the Worker
 * environment, which the deploy job fills from the Doppler `genproj` config
 * (`MCPHUB_BASE_URL`), and carried on the generation context so both the
 * generator and the preview write the same `mcphub-dev` URI.
 */
describe("MCPHub base URL in the generation context", () => {
  const payload = { name: "hub-project", selectedCapabilities: [] };

  it("reads MCPHUB_BASE_URL from the Worker environment", () => {
    const context = buildProjectContext(
      payload,
      "user@example.com",
      {},
      {
        MCPHUB_BASE_URL: "http://hub.internal:8781",
      },
    );

    expect(context.mcpHubBaseUrl).toBe("http://hub.internal:8781");
  });

  it("falls back to the default when the variable is absent", () => {
    const context = buildProjectContext(payload, "user@example.com", {}, {});

    expect(context.mcpHubBaseUrl).toBe(DEFAULT_MCPHUB_BASE_URL);
  });
});
