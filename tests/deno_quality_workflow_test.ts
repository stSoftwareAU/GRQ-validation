// Tests for the Deno Quality GitHub Actions workflow (Issue #26).
//
// Verify the workflow file exists, parses as YAML, declares a
// pull_request trigger, defines a `quality` job that runs
// `deno lint`, `deno fmt --check`, `deno check`, and `deno test`
// with coverage uploaded to Codecov, and pins third-party actions
// to 40-character commit SHAs to satisfy the supply-chain rule.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  assertActionsPinnedToSha,
  invokesTool,
} from "./workflow_assertions.ts";

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

  // Structured invariant (Issue #202): the job *invokes* each deno subcommand,
  // matched by tokenising the step commands rather than grepping their exact
  // source text — so reordering flags or splitting a step keeps passing.
  const steps = job.steps;
  assert(invokesTool(steps, "deno", { subcommand: "lint" }), "must run lint");
  assert(
    invokesTool(steps, "deno", { subcommand: "fmt", args: ["--check"] }),
    "job must run `deno fmt --check`",
  );
  assert(
    invokesTool(steps, "deno", { subcommand: "check" }),
    "job must run `deno check`",
  );
  assert(
    invokesTool(steps, "deno", { subcommand: "test", args: ["--coverage"] }),
    "job must run `deno test` with coverage",
  );
  assert(
    invokesTool(steps, "deno", { subcommand: "coverage", args: ["--lcov"] }),
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

Deno.test("Deno Quality workflow runs deno audit (SCR-VULN-SCAN, Issue #59)", async () => {
  // The Deno/JSR dependency surface must be scanned for known
  // vulnerabilities in CI, mirroring `cargo audit` on the Rust side.
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, unknown> };
  const job = doc.jobs.quality as {
    steps: Array<{ run?: string }>;
  };
  assert(
    invokesTool(job.steps, "deno", { subcommand: "audit" }),
    "quality job must run `deno audit` to scan JSR dependencies",
  );
});

Deno.test("Deno Quality workflow triggers on a weekly schedule (Issue #59)", async () => {
  // The audit should also run on the existing weekly cron so a JSR
  // compromise is caught even without an open pull request.
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  assert("schedule" in on, "must trigger on a schedule");
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

// Issue #734: the quality job only checks out to run the Deno quality checks
// (lint, fmt, check, audit, test) and upload coverage — it never pushes back to
// the repo or fetches a private submodule, so it does not need the workflow's
// GITHUB_TOKEN persisted into .git/config. Leaving it there widens the blast
// radius of any compromised later step (a malicious dependency could read the
// token from disk and act as it). Require persist-credentials: false on the
// checkout step.
Deno.test("Deno Quality workflow checkout does not persist credentials", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const jobs = doc.jobs as Record<
    string,
    { steps?: Array<{ uses?: string; with?: Record<string, unknown> }> }
  >;
  const job = jobs.quality;
  assert(job, "workflow must declare a quality job");
  const checkout = (job.steps ?? []).find((s) =>
    typeof s.uses === "string" && s.uses.startsWith("actions/checkout@")
  );
  assert(checkout, "quality job must have an actions/checkout step");
  assertEquals(
    checkout.with?.["persist-credentials"],
    false,
    "quality checkout must set persist-credentials: false so GITHUB_TOKEN is not written to .git/config",
  );
});

Deno.test("Deno Quality workflow pins actions to commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  assertActionsPinnedToSha(text);
});

// Concurrency cancellation (Issue #139). Without a concurrency group, rapid
// pushes to the same ref queue redundant, overlapping runs that each hold a
// runner. A top-level concurrency block keyed on workflow + ref with
// cancel-in-progress leaves only the latest run for a given ref alive,
// mirroring the canonical pattern already proven in ci.yml.
Deno.test("Deno Quality workflow declares a concurrency group that cancels superseded runs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const concurrency = doc.concurrency as Record<string, unknown> | undefined;
  assert(concurrency, "workflow must declare a top-level concurrency block");
  assertEquals(
    concurrency.group,
    "${{ github.workflow }}-${{ github.ref }}",
    "concurrency group must be keyed on workflow and ref",
  );
  assertEquals(
    concurrency["cancel-in-progress"],
    true,
    "concurrency must cancel superseded in-progress runs",
  );
});
