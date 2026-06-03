// Tests for the Dependency Review GitHub Actions workflow (Issue #65).
//
// Supply-chain hardening: actions in dependency-review.yml must be pinned to
// 40-character commit SHAs rather than mutable tags (e.g. @v4), matching the
// convention already used by the repo's other workflows.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/dependency-review.yml";

Deno.test("Dependency Review workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("Dependency Review workflow parses as valid YAML", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "Dependency Review");
});

Deno.test("Dependency Review workflow pins every action to a 40-char commit SHA", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const usesLines = text.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    assert(
      /@[0-9a-f]{40}\s*$/.test(line.trim()),
      `action not pinned to 40-char SHA: ${line.trim()}`,
    );
  }
});

Deno.test("Dependency Review workflow carries a version comment above each pinned action", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*-?\s*uses:/.test(lines[i])) continue;
    const prev = (lines[i - 1] ?? "").trim();
    assert(
      /^#\s*\S+\/\S+@\S+/.test(prev),
      `missing version comment above: ${lines[i].trim()}`,
    );
  }
});
