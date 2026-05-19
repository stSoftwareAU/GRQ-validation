// Tests for the Deno Dependency Updates GitHub Actions workflow (Issue #25).
//
// Verify the workflow file exists, parses as YAML, declares the expected
// triggers (weekly schedule + workflow_dispatch), defines an `outdated`
// job that runs `deno outdated --update --latest` and opens a PR, and
// pins third-party actions to 40-character commit SHAs to satisfy the
// supply-chain rule.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/deno-outdated.yml";

Deno.test("Deno Outdated workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("Deno Outdated workflow parses as valid YAML", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "Deno Dependency Updates");
});

Deno.test("Deno Outdated workflow has schedule and workflow_dispatch triggers", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  // YAML "on" key can parse to boolean true — accept either key.
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  assert("schedule" in on, "must trigger on a schedule");
  assert("workflow_dispatch" in on, "must support manual dispatch");
  const schedule = on.schedule as Array<{ cron: string }>;
  assert(
    Array.isArray(schedule) && schedule.length > 0,
    "schedule must list at least one cron entry",
  );
  assert(
    schedule.some((s) => typeof s.cron === "string" && s.cron.length > 0),
    "schedule entry must declare a non-empty cron expression",
  );
});

Deno.test("Deno Outdated workflow declares write permissions for PR creation", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { permissions?: Record<string, string> };
  assert(doc.permissions, "workflow must declare top-level permissions");
  assertEquals(doc.permissions.contents, "write");
  assertEquals(doc.permissions["pull-requests"], "write");
});

Deno.test("Deno Outdated workflow runs deno outdated and creates a PR", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, unknown> };
  assert(doc.jobs, "workflow must have jobs");
  assert(doc.jobs.outdated, "outdated job must exist");
  const job = doc.jobs.outdated as {
    "runs-on": string;
    steps: Array<
      { run?: string; uses?: string; with?: Record<string, string> }
    >;
  };
  assertEquals(job["runs-on"], "ubuntu-latest");
  assert(Array.isArray(job.steps) && job.steps.length > 0, "job needs steps");

  const runs = job.steps.map((s) => s.run ?? "").join("\n");
  assert(
    /deno\s+outdated\s+--update\s+--latest/.test(runs),
    "job must run `deno outdated --update --latest`",
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
    uses.some((u) => u.startsWith("peter-evans/create-pull-request@")),
    "job must use create-pull-request to open a PR",
  );
});

Deno.test("Deno Outdated workflow pins actions to commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  // Supply-chain rule: every `uses:` must reference a 40-char SHA, not a
  // floating tag like @v2 or @v7.
  const usesLines = text.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    assert(
      /@[0-9a-f]{40}\s*$/.test(line.trim()),
      `action not pinned to 40-char SHA: ${line.trim()}`,
    );
  }
});
