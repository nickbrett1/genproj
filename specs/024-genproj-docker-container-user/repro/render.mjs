// Render a minimal batch-workload project through the REAL generator
// (generateAllFiles), so the Dockerfile under test is the shipped one.
import { generateAllFiles } from "../../../src/generator/file-generator.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Default output: ./proj next to this script (gitignored scratch space).
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, "proj");

const context = {
  projectName: "verify024",
  description: "spec 024 user verification",
  registryNamespace: "nickbrett1",
  capabilities: ["docker-container", "buildkite"],
  configuration: {
    language: "shell",
    "docker-container": {
      workload: "batch",
      user: "1000:1000",
      entrypoint: ["/usr/local/bin/verify024.sh"],
      aptPackages: [],
    },
  },
};

const files = await generateAllFiles(context);
for (const f of files) {
  const p = join(OUT, f.filePath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, f.content);
  console.log("wrote", f.filePath, `(${f.content.length} bytes)`);
}
