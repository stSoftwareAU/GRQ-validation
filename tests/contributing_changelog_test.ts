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

/** Parse `major.minor.patch` into comparable components. */
function semver(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

/** Negative when `a` precedes `b`, zero when equal, positive when `a` is ahead. */
function compareSemver(a: string, b: string): number {
  const left = semver(a);
  const right = semver(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Issue #818 changed the relationship this asserts. The Cargo package version
// is now auto-incremented by CI on every pull request (see
// .github/workflows/version-bump.yml) so the deployed scorer can detect a
// stale binary — it is a build identifier, not a release, and requiring a
// hand-written changelog section per PR would fill the log with empty entries.
// The invariant that survives: the changelog may never claim a release the
// manifest has not reached, and it must document at least one release.
Deno.test("CHANGELOG.md documents no release ahead of Cargo.toml", async () => {
  const cargo = await read("Cargo.toml");
  const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  assert(match, "Cargo.toml must declare a version");
  const version = match![1];

  const text = await read(CHANGELOG_PATH);
  const released = [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) =>
    m[1]
  );
  assert(
    released.length > 0,
    "CHANGELOG.md must document at least one released version",
  );

  const newest = released.reduce((a, b) => compareSemver(a, b) >= 0 ? a : b);
  assert(
    compareSemver(newest, version) <= 0,
    `CHANGELOG.md documents release ${newest}, ahead of Cargo.toml ${version}`,
  );
});
