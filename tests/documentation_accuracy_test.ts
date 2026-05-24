// Tests for documentation accuracy (Issue #42).
//
// These tests verify the top-level README.md and docs/README.md describe the
// repository accurately. They catch stale references to workflows that no
// longer exist, placeholder text, and misstated CLI behaviour.

import { assert, assertEquals } from "@std/assert";

const README = "README.md";
const DOCS_README = "docs/README.md";
const WORKFLOWS_DIR = ".github/workflows";

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

async function listWorkflowFiles(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".yml")) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

Deno.test("README.md does not reference workflows that do not exist", async () => {
  const text = await readText(README);
  const stale = ["rust.yml", "deploy.yml", "dependencies.yml"];
  for (const name of stale) {
    assert(
      !text.includes(name),
      `README.md must not reference removed workflow ${name}`,
    );
  }
});

Deno.test("README.md references every workflow that exists", async () => {
  const text = await readText(README);
  const workflows = await listWorkflowFiles();
  for (const wf of workflows) {
    assert(
      text.includes(wf),
      `README.md must reference workflow ${wf}`,
    );
  }
});

Deno.test("README.md does not contain the license placeholder", async () => {
  const text = await readText(README);
  assert(
    !text.includes("[Add your license information here]"),
    "README.md must not contain the license placeholder",
  );
  assert(
    text.includes("Apache License") || text.includes("Apache-2.0") ||
      text.includes("Apache 2.0"),
    "README.md must document the Apache 2.0 licence (matches LICENSE file)",
  );
});

Deno.test("README.md describes the correct recent-files window", async () => {
  const text = await readText(README);
  assert(
    !text.includes("within 180 days"),
    "README.md must not describe the recent window as 180 days (run.sh uses 100)",
  );
  assert(
    text.includes("within 100 days"),
    "README.md should describe the recent window as 100 days",
  );
});

Deno.test("README.md documents the helpers and scripts directories", async () => {
  const text = await readText(README);
  assert(
    text.includes("helpers/"),
    "README.md project structure should mention helpers/",
  );
  assert(
    text.includes("scripts/"),
    "README.md project structure should mention scripts/",
  );
});

Deno.test("README.md lists every documented CLI flag", async () => {
  const text = await readText(README);
  // Flags exposed by src/main.rs Args struct.
  const flags = [
    "--docs-path",
    "--process-all",
    "--calculate-performance",
    "--performance-only",
    "--date",
    "--verbose",
  ];
  for (const f of flags) {
    assert(text.includes(f), `README.md must document the ${f} CLI flag`);
  }
});

Deno.test("docs/README.md does not contain stray test comments", async () => {
  const text = await readText(DOCS_README);
  assert(
    !text.includes("# Test comment"),
    "docs/README.md must not contain stray '# Test comment' lines",
  );
  assert(
    !text.includes("# Another test comment"),
    "docs/README.md must not contain stray '# Another test comment' lines",
  );
});

Deno.test("README.md uses Australian English spellings", async () => {
  const text = await readText(README);
  // Spot-check for common American spellings that should be Australianised in
  // text we own. Only check tokens we have actually authored — do not flag
  // CLI/library names or third-party project names.
  const banned = [
    /\bcolor-coded\b/i,
    /\bbehavior\b/i,
    /\borganization\b/i,
  ];
  for (const re of banned) {
    assert(
      !re.test(text),
      `README.md must use Australian English; matched ${re}`,
    );
  }
});

Deno.test("Workflow listing helper finds the expected workflows", async () => {
  const workflows = await listWorkflowFiles();
  // Sanity check that the test environment can see the workflows directory.
  assert(workflows.length > 0, "expected at least one workflow file");
  assertEquals(
    workflows.includes("ci.yml"),
    true,
    "ci.yml is expected to be present",
  );
});
