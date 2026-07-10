// Tests for documentation accuracy (Issue #42, refined in Issue #81).
//
// These tests verify the top-level README.md describes the repository
// accurately by asserting *derivable relationships* rather than hand-copied
// prose. They catch stale references to workflows that no longer exist,
// placeholder text, and a documented recent-files window that drifts from the
// value actually used by run.sh.
//
// Brittle source-text grep assertions (spelling police, literal CLI-flag
// strings, "# Test comment" bans, hardcoded "100 days") were removed in
// Issue #81: they verified prose, not behaviour, broke on harmless rewording,
// and duplicated magic values from the implementation. Documentation prose is
// better policed by the Markdown linter and review checklist.

import { assert } from "@std/assert";

const README = "README.md";
const RUN_SH = "run.sh";
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

// Parse the recent-files window (in days) from run.sh, the canonical source of
// the value. The README is then checked against this, so editing run.sh and
// the README together keeps the test green while a drift between them fails.
async function recentWindowDaysFromRunSh(): Promise<number> {
  const text = await readText(RUN_SH);
  const match = text.match(/within (\d+) days/);
  assert(
    match,
    "run.sh must document the recent-files window as 'within N days'",
  );
  return Number(match[1]);
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

Deno.test("README.md documents the recent-files window used by run.sh", async () => {
  const text = await readText(README);
  const days = await recentWindowDaysFromRunSh();
  assert(
    text.includes(`within ${days} days`),
    `README.md must describe the recent window as ${days} days to match run.sh`,
  );
});

Deno.test("README.md defines the GRQ acronym on first use (Issue #761)", async () => {
  const text = await readText(README);
  // The acronym must be glossed in the opening section, before the first
  // "## " heading, so a first-time reader meets the definition immediately.
  const opening = text.split(/^## /m)[0];
  assert(
    /Get Rich Quick/i.test(opening),
    "README.md must expand GRQ (Get Rich Quick) in the opening section",
  );
  assert(
    /\bGRQ\b/.test(opening),
    "README.md opening section must use the GRQ acronym alongside its gloss",
  );
});

Deno.test("Workflow listing helper finds the expected workflows", async () => {
  const workflows = await listWorkflowFiles();
  // Sanity check that the test environment can see the workflows directory.
  assert(workflows.length > 0, "expected at least one workflow file");
  assert(
    workflows.includes("ci.yml"),
    "ci.yml is expected to be present",
  );
});
