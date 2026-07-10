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

// Issue #738: the shellcheck job only checks out to run ShellCheck — it never
// pushes back to the repo or fetches a private submodule, so it does not need
// the workflow's GITHUB_TOKEN persisted into .git/config. Leaving it there
// widens the blast radius of any compromised later step (a malicious dependency
// could read the token from disk and act as it). Require
// persist-credentials: false on the checkout step.
Deno.test("ShellCheck workflow checkout does not persist credentials", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const jobs = doc.jobs as Record<
    string,
    { steps?: Array<{ uses?: string; with?: Record<string, unknown> }> }
  >;
  const job = jobs.shellcheck;
  assert(job, "workflow must declare a shellcheck job");
  const checkout = (job.steps ?? []).find((s) =>
    typeof s.uses === "string" && s.uses.startsWith("actions/checkout@")
  );
  assert(checkout, "shellcheck job must have an actions/checkout step");
  assertEquals(
    checkout.with?.["persist-credentials"],
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
