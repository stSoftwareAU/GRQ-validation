// Tests for the Cargo Audit GitHub Actions workflow (Issue #24).
//
// Verify the workflow file exists, parses as YAML, declares the expected
// triggers (pull_request + weekly schedule), defines an `audit` job that
// installs cargo-audit and runs it, and pins third-party actions to
// 40-character commit SHAs to satisfy the supply-chain rule.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  assertActionsPinnedToSha,
  invokesTool,
} from "./workflow_assertions.ts";

const WORKFLOW_PATH = ".github/workflows/cargo-audit.yml";

Deno.test("Cargo Audit workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("Cargo Audit workflow parses as valid YAML", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "Cargo Audit");
});

Deno.test("Cargo Audit workflow has pull_request and schedule triggers", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  // YAML "on" key sometimes parses to boolean true — accept either key.
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "must trigger on pull_request");
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

Deno.test("Cargo Audit workflow declares read-only contents permission", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { permissions?: Record<string, string> };
  assert(doc.permissions, "workflow must declare top-level permissions");
  assertEquals(doc.permissions.contents, "read");
});

Deno.test("Cargo Audit workflow defines audit job that installs and runs cargo-audit", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, unknown> };
  assert(doc.jobs, "workflow must have jobs");
  assert(doc.jobs.audit, "audit job must exist");
  const job = doc.jobs.audit as {
    "runs-on": string;
    steps: Array<{ run?: string; uses?: string }>;
  };
  assertEquals(job["runs-on"], "ubuntu-latest");
  assert(Array.isArray(job.steps) && job.steps.length > 0, "job needs steps");
  // Structured invariant (Issue #202): the job installs and runs cargo-audit,
  // matched on tokenised commands so the pinned `--version`/`--locked` flags
  // or a split step do not break the test.
  assert(
    invokesTool(job.steps, "cargo", {
      subcommand: "install",
      args: ["cargo-audit"],
    }),
    "audit job must install cargo-audit",
  );
  assert(
    invokesTool(job.steps, "cargo", { subcommand: "audit" }),
    "audit job must run `cargo audit`",
  );
});

Deno.test("Cargo Audit workflow pins actions to commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  assertActionsPinnedToSha(text);
});

// Concurrency cancellation (Issue #139). Without a concurrency group, rapid
// pushes to the same ref queue redundant, overlapping runs that each hold a
// runner. A top-level concurrency block keyed on workflow + ref with
// cancel-in-progress leaves only the latest run for a given ref alive,
// mirroring the canonical pattern already proven in ci.yml.
Deno.test("Cargo Audit workflow declares a concurrency group that cancels superseded runs", async () => {
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
