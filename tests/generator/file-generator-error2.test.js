import { describe, it, expect } from "vitest";
import { collectNonDevelopmentContainerFiles } from "../../src/generator/file-generator.js";

describe("file-generator template error handling", () => {
  it("should gracefully handle if generateFile throws", () => {
    const mockEngine = {
      generateFile: () => {
        throw new Error("mock error");
      },
    };
    const context = {
      capabilities: ["doppler"],
      configuration: {},
    };
    const res = collectNonDevelopmentContainerFiles(mockEngine, context, [
      "doppler",
    ]);
    // should skip that template and return whatever it could (or empty array)
    expect(res).toBeInstanceOf(Array);
  });
});
