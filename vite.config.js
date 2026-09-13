import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    reporter: ["default"],
    coverage: {
      reporter: ["lcov", "text"],
      // Keep the exclusions explicit and list the entry point in `include`:
      // with the bare defaults, `src/index.js` is treated as a barrel file and
      // dropped from the report, which would hide routing regressions.
      exclude: [
        "node_modules/**",
        "coverage/**",
        "tests/**",
        "**/*.test.{js,ts}",
        "**/*.spec.{js,ts}",
        "**/*.config.{js,ts}",
        // Generated/data modules: the inlined templates and the capability →
        // template wiring are data, not logic.
        "src/generator/templates.generated.js",
        "src/generator/capability-templates.js",
      ],
      include: ["src/**/*.js"],
      // Enforce a minimum coverage gate in CI (matches the old SonarCloud >80% rule).
      // `npm test` fails when coverage drops below these.
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
