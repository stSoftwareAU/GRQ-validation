// Tests for the Gitleaks secret-scanning GitHub Actions workflow.
//
// Verify the workflow file exists, parses as YAML, triggers on pull_request,
// declares read-only contents permission, and declares a concurrency group
// that cancels superseded in-progress runs (Issue #139).

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/gitleaks.yml";

Deno.test("Gitleaks workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("Gitleaks workflow parses as valid YAML with expected name", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "Gitleaks");
});

Deno.test("Gitleaks workflow triggers on pull_request", async () => {
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

Deno.test("Gitleaks workflow declares read-only contents permission", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { permissions?: Record<string, string> };
  assert(doc.permissions, "workflow must declare top-level permissions");
  assertEquals(doc.permissions.contents, "read");
});

// Concurrency cancellation (Issue #139). Without a concurrency group, rapid
// pushes to the same ref queue redundant, overlapping runs that each hold a
// runner. A top-level concurrency block keyed on workflow + ref with
// cancel-in-progress leaves only the latest run for a given ref alive,
// mirroring the canonical pattern already proven in ci.yml.
Deno.test("Gitleaks workflow declares a concurrency group that cancels superseded runs", async () => {
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

// Issue #219: gitleaks-action requires an org-level Gitleaks Pro licence, but
// Dependabot-triggered runs execute against the separate Dependabot secrets
// store and cannot read GITLEAKS_LICENSE. The action therefore exits with
// ErrLicense and the check fails on every Dependabot PR (e.g. PR #217). A
// dependency-bump PR introduces no secrets to scan, so the gitleaks job must
// be skipped when the actor is Dependabot.
Deno.test("Gitleaks job is skipped for Dependabot-authored PRs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as {
    jobs?: Record<string, { if?: string }>;
  };
  const job = doc.jobs?.gitleaks;
  assert(job, "workflow must declare a gitleaks job");
  assert(
    typeof job.if === "string",
    "gitleaks job must declare an 'if' condition guarding the Dependabot actor",
  );
  const condition = job.if as string;
  assert(
    condition.includes("dependabot[bot]"),
    `gitleaks job 'if' must reference the dependabot[bot] actor: ${condition}`,
  );
  assert(
    condition.includes("github.actor") && condition.includes("!="),
    `gitleaks job 'if' must skip runs where github.actor is Dependabot: ${condition}`,
  );
});
