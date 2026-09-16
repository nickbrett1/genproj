// tests/generator/file-generator-rust-crate.test.js

import { describe, it, expect } from "vitest";

import { cargoPackageName } from "../../src/generator/capability-template-utils.js";
import { generateAllFiles } from "../../src/generator/file-generator.js";
import { generatePreview } from "../../src/generator/preview-generator.js";

const CARGO_TOML = "Cargo.toml";
const CARGO_LOCK = "Cargo.lock";
const MAIN_RS = "src/main.rs";
const RUST_CAPS = ["buildkite", "devcontainer-rust"];
const PROJECT = "a2a-goose";

const generate = (name, capabilities, configuration = {}) =>
  generateAllFiles({ name, capabilities, configuration });

const byPath = (files, filePath) =>
  files.find((file) => file.filePath === filePath);

describe("cargoPackageName", () => {
  it("keeps a name cargo already accepts", () => {
    expect(cargoPackageName(PROJECT)).toBe(PROJECT);
    expect(cargoPackageName("my_project")).toBe("my_project");
  });

  it("removes the characters cargo rejects", () => {
    // `.` is a legal git-repository-name character and an illegal
    // cargo-package-name one; leaving it in is a manifest cargo refuses to load.
    expect(cargoPackageName("My.Proj")).toBe("myproj");
  });

  it("never returns a name that starts with a digit or is empty", () => {
    expect(cargoPackageName("2fa")).toBe("app-2fa");
    expect(cargoPackageName("!!!")).toBe("app");
    expect(cargoPackageName("")).toBe("app");
  });
});

describe("generated rust crate", () => {
  it("ships a buildable package for a rust project", async () => {
    const files = await generate(PROJECT, RUST_CAPS);

    const cargoToml = byPath(files, CARGO_TOML);
    const cargoLock = byPath(files, CARGO_LOCK);
    expect(cargoToml).toBeDefined();
    expect(cargoLock).toBeDefined();
    expect(byPath(files, MAIN_RS)).toBeDefined();

    // `cargo build --locked` (what the generated build step runs) is a hard
    // error when Cargo.lock is missing or names a different package, so the
    // manifest and the lockfile are one artifact and have to agree.
    expect(cargoToml.content).toContain(`name = "${PROJECT}"`);
    expect(cargoToml.content).toContain('version = "0.1.0"');
    expect(cargoLock.content).toContain(`name = "${PROJECT}"`);
    expect(cargoLock.content).toContain('version = "0.1.0"');
    expect(cargoLock.content).toContain("version = 3");
  });

  it("does not ship a crate for a project whose language is not rust", async () => {
    const files = await generate(PROJECT, ["buildkite", "devcontainer-node"]);

    expect(byPath(files, CARGO_TOML)).toBeUndefined();
    expect(byPath(files, CARGO_LOCK)).toBeUndefined();
    expect(byPath(files, MAIN_RS)).toBeUndefined();
  });

  it("names the package the pipeline and the Dockerfile look for", async () => {
    // The three consumers - the manifest, the per-target build step's `cp` and
    // the docker-container runtime stage - have to agree on one spelling of the
    // binary, including for a project name cargo would reject verbatim.
    const files = await generate(
      "My.Proj",
      ["buildkite", "github-release", "devcontainer-rust"],
      {
        language: "rust",
        "github-release": { targets: ["aarch64-apple-darwin"] },
      },
    );

    const cargoToml = byPath(files, CARGO_TOML).content;
    const yaml = byPath(files, ".buildkite/pipeline.yml").content;

    expect(cargoToml).toContain('name = "myproj"');
    expect(yaml).toContain(
      'if [ -f "target/aarch64-apple-darwin/release/myproj" ]; then',
    );
    expect(yaml).not.toContain("My.Proj");
  });

  it("tracks the lockfile rather than ignoring it", async () => {
    const files = await generate(PROJECT, RUST_CAPS);

    const gitignore = byPath(files, ".gitignore").content;
    expect(gitignore).toContain("target/");
    // An ignored Cargo.lock is a checkout where `cargo build --locked` fails.
    expect(gitignore).not.toContain(CARGO_LOCK);
  });

  it("documents `cargo` in the README, not npm", async () => {
    const files = await generate(PROJECT, RUST_CAPS);

    const readme = byPath(files, "README.md").content;
    expect(readme).toContain("cargo build");
    expect(readme).not.toContain("npm install");
  });
});

describe("preview matches generation", () => {
  it("shows the crate a rust preview would generate", async () => {
    const preview = await generatePreview(
      { name: PROJECT, configuration: { language: "rust" } },
      RUST_CAPS,
    );

    const paths = [];
    const walk = (nodes) => {
      for (const node of nodes) {
        paths.push(node.path);
        if (node.type === "folder" && node.children) walk(node.children);
      }
    };
    walk(preview.files);
    expect(paths).toContain(CARGO_TOML);
    expect(paths).toContain(CARGO_LOCK);
    expect(paths).toContain(MAIN_RS);
  });
});
