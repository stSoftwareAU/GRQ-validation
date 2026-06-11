// Tests for the contributor-facing docs floor (Issue #77).
//
// The repo already publishes README.md, LICENSE, and SECURITY.md but was
// missing CONTRIBUTING.md and CHANGELOG.md. These tests assert that both
// files now exist at the repository root and carry the substance contributors
// and consumers expect: build/test/lint commands and the PR workflow for
// CONTRIBUTING.md, and a Keep a Changelog structure seeded with the current
// Cargo.toml version for CHANGELOG.md.

import { assert } from "@std/assert";

const CONTRIBUTING_PATH = "CONTRIBUTING.md";
const CHANGELOG_PATH = "CHANGELOG.md";

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

Deno.test("CONTRIBUTING.md exists at the repository root", async () => {
  const stat = await Deno.stat(CONTRIBUTING_PATH);
  assert(stat.isFile, `${CONTRIBUTING_PATH} should be a file`);
});

Deno.test("CONTRIBUTING.md documents the Rust build/test/lint commands", async () => {
  const text = await read(CONTRIBUTING_PATH);
  assert(/cargo test/.test(text), "must reference cargo test");
  assert(/cargo fmt/.test(text), "must reference cargo fmt");
  assert(/cargo clippy/.test(text), "must reference cargo clippy");
  assert(/cargo build/.test(text), "must reference cargo build");
});

Deno.test("CONTRIBUTING.md documents the Deno test suite", async () => {
  const text = await read(CONTRIBUTING_PATH);
  assert(/deno test/.test(text), "must reference the Deno test suite");
});

Deno.test("CONTRIBUTING.md anchors on the existing quality gate", async () => {
  const text = await read(CONTRIBUTING_PATH);
  assert(
    text.includes("quality.sh"),
    "must reference the quality.sh local gate",
  );
});

Deno.test("CONTRIBUTING.md describes the pull-request workflow", async () => {
  const text = await read(CONTRIBUTING_PATH);
  assert(
    /pull request/i.test(text),
    "must describe the pull-request submission workflow",
  );
});

Deno.test("CHANGELOG.md exists at the repository root", async () => {
  const stat = await Deno.stat(CHANGELOG_PATH);
  assert(stat.isFile, `${CHANGELOG_PATH} should be a file`);
});

Deno.test("CHANGELOG.md follows the Keep a Changelog format", async () => {
  const text = await read(CHANGELOG_PATH);
  assert(
    text.includes("Keep a Changelog"),
    "must reference the Keep a Changelog format",
  );
  assert(
    text.includes("Semantic Versioning"),
    "must reference Semantic Versioning",
  );
});

Deno.test("CHANGELOG.md is seeded with the current Cargo.toml version", async () => {
  const cargo = await read("Cargo.toml");
  const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  assert(match, "Cargo.toml must declare a version");
  const version = match![1];
  const text = await read(CHANGELOG_PATH);
  assert(
    text.includes(`[${version}]`),
    `CHANGELOG.md must contain a section for the current version ${version}`,
  );
});
