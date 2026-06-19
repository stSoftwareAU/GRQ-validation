// Tests for the Deno Dependency Updates GitHub Actions workflow (Issue #25).
//
// Verify the workflow file exists, parses as YAML, declares the expected
// triggers (weekly schedule + workflow_dispatch), defines an `outdated`
// job that runs `deno outdated --update --latest` and opens a PR, and
// pins third-party actions to 40-character commit SHAs to satisfy the
// supply-chain rule.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  assertActionsPinnedToSha,
  invokesTool,
} from "./workflow_assertions.ts";

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

  // Structured invariant (Issue #202): the job runs `deno outdated` with the
  // --update and --latest flags, matched on tokens so flag order and the
  // appended --minimum-dependency-age do not break the test.
  assert(
    invokesTool(job.steps, "deno", {
      subcommand: "outdated",
      args: ["--update", "--latest"],
    }),
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

Deno.test("Deno Outdated workflow gates updates behind a release-age quarantine (Issue #64)", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, unknown> };
  const job = doc.jobs.outdated as {
    steps: Array<{ run?: string }>;
  };
  const runs = job.steps.map((s) => s.run ?? "").join("\n");

  // Supply-chain quarantine: the update step must pass
  // --minimum-dependency-age so a freshly-published (possibly hijacked)
  // external dependency is held back rather than auto-bumped.
  const match = runs.match(/--minimum-dependency-age[=\s]+(\S+)/);
  assert(
    match,
    "deno outdated must pass --minimum-dependency-age to quarantine new releases",
  );

  // The quarantine window must be at least 24h (P1D). Accept the ISO-8601
  // one-day duration or an explicit minutes value >= 1440.
  const value = match![1];
  const isOneDayOrMore = value === "P1D" ||
    (/^\d+$/.test(value) && Number(value) >= 1440);
  assert(
    isOneDayOrMore,
    `quarantine window must be at least 24h (P1D); got '${value}'`,
  );
});

Deno.test("deno.json declares a minimumDependencyAge quarantine with internal exclusions (Issue #64)", async () => {
  const text = await Deno.readTextFile("deno.json");
  const { parse: parseJsonc } = await import("@std/jsonc");
  const config = parseJsonc(text) as {
    minimumDependencyAge?: { age?: string; exclude?: string[] };
  };
  const mda = config.minimumDependencyAge;
  assert(mda, "deno.json must declare minimumDependencyAge");
  assertEquals(mda.age, "P1D", "external quarantine floor must be 24h (P1D)");
  assert(
    Array.isArray(mda.exclude),
    "minimumDependencyAge.exclude must be a list",
  );
  // Internal stSoftwareAU deps bypass the quarantine (0h) so they update
  // immediately, per the dependency-bump policy.
  assert(
    mda.exclude!.includes("jsr:@stsoftware/*"),
    "internal jsr:@stsoftware/* deps must be excluded from the quarantine",
  );
  assert(
    mda.exclude!.includes("npm:@stsoftware/*"),
    "internal npm:@stsoftware/* deps must be excluded from the quarantine",
  );
});

Deno.test("Deno Outdated workflow pins actions to commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  assertActionsPinnedToSha(text);
});
