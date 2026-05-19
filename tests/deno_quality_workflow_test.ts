// Tests for the Deno Quality GitHub Actions workflow (Issue #26).
//
// Verify the workflow file exists, parses as YAML, declares a
// pull_request trigger, defines a `quality` job that runs
// `deno lint`, `deno fmt --check`, `deno check`, and `deno test`
// with coverage uploaded to Codecov, and pins third-party actions
// to 40-character commit SHAs to satisfy the supply-chain rule.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/deno-quality.yml";

Deno.test("Deno Quality workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("Deno Quality workflow parses as valid YAML", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "Deno Quality");
});

Deno.test("Deno Quality workflow triggers on pull_request", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  // YAML "on" key can parse to boolean true — accept either key.
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "must trigger on pull_request");
});

Deno.test("Deno Quality workflow declares read permissions for contents", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { permissions?: Record<string, string> };
  assert(doc.permissions, "workflow must declare top-level permissions");
  assertEquals(doc.permissions.contents, "read");
});

Deno.test("Deno Quality workflow runs lint, fmt --check, check and test", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, unknown> };
  assert(doc.jobs, "workflow must have jobs");
  assert(doc.jobs.quality, "quality job must exist");
  const job = doc.jobs.quality as {
    "runs-on": string;
    steps: Array<
      { run?: string; uses?: string; with?: Record<string, string> }
    >;
  };
  assertEquals(job["runs-on"], "ubuntu-latest");
  assert(Array.isArray(job.steps) && job.steps.length > 0, "job needs steps");

  const runs = job.steps.map((s) => s.run ?? "").join("\n");
  assert(/\bdeno\s+lint\b/.test(runs), "job must run `deno lint`");
  assert(
    /\bdeno\s+fmt\s+--check\b/.test(runs),
    "job must run `deno fmt --check`",
  );
  assert(/\bdeno\s+check\b/.test(runs), "job must run `deno check`");
  assert(
    /\bdeno\s+test\b[^\n]*--coverage/.test(runs),
    "job must run `deno test` with coverage",
  );
  assert(
    /deno\s+coverage[^\n]*--lcov/.test(runs),
    "job must export lcov coverage",
  );

  const uses = job.steps.map((s) => s.uses ?? "");
  assert(
    uses.some((u) => u.startsWith("actions/checkout@")),
    "job must check out the repository",
  );
  assert(
    uses.some((u) => u.startsWith("denoland/setup-deno@")),
    "job must set up Deno",
  );
  assert(
    uses.some((u) => u.startsWith("codecov/codecov-action@")),
    "job must upload coverage to Codecov",
  );
});

Deno.test("Deno Quality workflow pins actions to commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  // Supply-chain rule: every `uses:` must reference a 40-char SHA, not a
  // floating tag like @v2 or @v4.
  const usesLines = text.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    assert(
      /@[0-9a-f]{40}\s*$/.test(line.trim()),
      `action not pinned to 40-char SHA: ${line.trim()}`,
    );
  }
});
