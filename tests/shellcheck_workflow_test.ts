// Tests for the ShellCheck GitHub Actions workflow.
//
// Verify the workflow file exists, parses as YAML, triggers on pull_request,
// declares read-only contents permission, and declares a concurrency group
// that cancels superseded in-progress runs (Issue #139).

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/shellcheck.yml";

Deno.test("ShellCheck workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("ShellCheck workflow parses as valid YAML with expected name", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "ShellCheck");
});

Deno.test("ShellCheck workflow triggers on pull_request", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  // YAML "on" key sometimes parses to boolean true — accept either key.
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "must trigger on pull_request");
});

Deno.test("ShellCheck workflow declares read-only contents permission", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { permissions?: Record<string, string> };
  assert(doc.permissions, "workflow must declare top-level permissions");
  assertEquals(doc.permissions.contents, "read");
});

// Credential hygiene (Issue #738). By default actions/checkout writes the
// workflow GITHUB_TOKEN into .git/config as an auth header, where any later
// step in the job could read it and act as the token. The shellcheck job only
// reads the repo to scan it, so it must set persist-credentials: false.
Deno.test("ShellCheck checkout does not persist credentials", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as {
    jobs: Record<string, { steps?: Array<Record<string, unknown>> }>;
  };
  const job = doc.jobs.shellcheck;
  assert(job, "workflow must declare a shellcheck job");
  const checkout = (job.steps ?? []).find((s) =>
    typeof s.uses === "string" &&
    (s.uses as string).startsWith("actions/checkout@")
  );
  assert(checkout, "shellcheck job must have an actions/checkout step");
  const withBlock = checkout.with as Record<string, unknown> | undefined;
  assertEquals(
    withBlock?.["persist-credentials"],
    false,
    "shellcheck checkout must set persist-credentials: false so GITHUB_TOKEN is not written to .git/config",
  );
});

// Concurrency cancellation (Issue #139). Without a concurrency group, rapid
// pushes to the same ref queue redundant, overlapping runs that each hold a
// runner. A top-level concurrency block keyed on workflow + ref with
// cancel-in-progress leaves only the latest run for a given ref alive,
// mirroring the canonical pattern already proven in ci.yml.
Deno.test("ShellCheck workflow declares a concurrency group that cancels superseded runs", async () => {
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
