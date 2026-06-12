// Tests for the contributor-facing docs floor (Issue #77, refined in
// Issue #149).
//
// The repo already publishes README.md, LICENSE, and SECURITY.md but was
// missing CONTRIBUTING.md and CHANGELOG.md. These tests assert that both
// files exist at the repository root and that the changelog is seeded with a
// section for the current Cargo.toml version — a *derivable relationship*
// rather than a hand-copied phrase.
//
// The earlier substring greps (cargo test/fmt/clippy/build, deno test,
// quality.sh, "pull request", "Keep a Changelog", "Semantic Versioning") were
// removed in Issue #149: they asserted on documentation prose rather than
// behaviour, broke on harmless rewording that preserved meaning, and
// duplicated implementation detail. This is the same anti-pattern removed from
// security_md_test.ts and documentation_accuracy_test.ts under Issue #81.
// Documentation prose is policed by the Markdown linter and human review, not
// by string asserts in the unit-test runner.

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

Deno.test("CHANGELOG.md exists at the repository root", async () => {
  const stat = await Deno.stat(CHANGELOG_PATH);
  assert(stat.isFile, `${CHANGELOG_PATH} should be a file`);
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
