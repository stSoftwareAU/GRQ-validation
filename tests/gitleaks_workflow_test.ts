// Tests for the Gitleaks secret-scanning GitHub Actions workflow.
//
// Verify the workflow file exists, parses as YAML, triggers on pull_request,
// declares read-only contents permission, and declares a concurrency group
// that cancels superseded in-progress runs (Issue #139).

import { assert, assertEquals, assertMatch } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  assertActionsPinnedToSha,
  assertPullRequestRunsOnMilestone,
  commandSegments,
  invokesTool,
  loadWorkflow,
  type Workflow,
  type WorkflowStep,
  workflowSteps,
} from "./workflow_assertions.ts";

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

// Issue #788: milestone sub-issue PRs target a shared `milestone/<slug>`
// integration branch. A `branches: ["*"]` filter skips them because the `*`
// glob does not match the `/`, so the gate must run on milestone branches too.
Deno.test("Gitleaks workflow runs on milestone/* pull requests", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  assertPullRequestRunsOnMilestone(parseYaml(text) as Workflow);
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

// Issue #868: the licensed action exits with ErrLicense whenever the org
// licence is absent (Dependabot PRs, forks), so the job needs a licence-less
// fallback. The open-source CLI needs no licence; the two step conditions are
// complementary so exactly one scanner runs on every PR.
const LICENSED_ACTION = "gitleaks/gitleaks-action@";
const HAS_LICENCE = "env.GITLEAKS_LICENSE != ''";
const NO_LICENCE = "env.GITLEAKS_LICENSE == ''";

async function gitleaksSteps(): Promise<WorkflowStep[]> {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  return workflowSteps(doc, "gitleaks");
}

function fallbackStep(steps: WorkflowStep[]): WorkflowStep {
  const step = steps.find((s) => invokesTool([s], "./gitleaks"));
  assert(step, "gitleaks job must run the open-source gitleaks CLI");
  return step;
}

// Issue #219 used to skip the whole job for Dependabot because the licensed
// action failed there. Issue #868 replaces that skip with the CLI fallback, so
// Dependabot PRs are now scanned rather than waved through unscanned.
Deno.test("Gitleaks job is not skipped for Dependabot-authored PRs", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const job = doc.jobs?.gitleaks;
  assert(job, "workflow must declare a gitleaks job");
  assert(
    !(job.if ?? "").includes("dependabot"),
    `gitleaks job must not skip Dependabot PRs: ${job.if}`,
  );
});

Deno.test("Gitleaks job exposes GITLEAKS_LICENSE at job level for step if:", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  assertEquals(
    doc.jobs?.gitleaks?.env?.GITLEAKS_LICENSE,
    "${{ secrets.GITLEAKS_LICENSE }}",
  );
});

Deno.test("Gitleaks licensed action runs only when the licence is present", async () => {
  const steps = await gitleaksSteps();
  const action = steps.find((s) => s.uses?.startsWith(LICENSED_ACTION));
  assert(action, "gitleaks job must use gitleaks-action");
  assertEquals(action.if, HAS_LICENCE);
});

Deno.test("Gitleaks CLI fallback runs only when the licence is absent", async () => {
  const step = fallbackStep(await gitleaksSteps());
  assertEquals(step.if, NO_LICENCE);
});

Deno.test("Gitleaks CLI fallback scans the PR commit range and fails on a leak", async () => {
  const step = fallbackStep(await gitleaksSteps());
  assert(
    invokesTool([step], "./gitleaks", {
      subcommand: "git",
      args: ["--redact", "--exit-code", "--log-opts"],
    }),
    "fallback must run `gitleaks git --redact --exit-code 1 --log-opts=...`",
  );
  assertEquals(
    step.env?.BASE_SHA,
    "${{ github.event.pull_request.base.sha }}",
  );
  assertEquals(
    step.env?.HEAD_SHA,
    "${{ github.event.pull_request.head.sha }}",
  );
  assert(
    !(step.run ?? "").includes("${{"),
    "fallback must read the commit range from env:, not interpolate it in run:",
  );
});

Deno.test("Gitleaks CLI fallback runs in bash strict mode", async () => {
  const step = fallbackStep(await gitleaksSteps());
  assertEquals(commandSegments(step.run ?? "")[0], "set -euo pipefail");
});

Deno.test("Gitleaks CLI download is version-pinned and SHA-256 verified before it runs", async () => {
  const step = fallbackStep(await gitleaksSteps());
  assertMatch(step.env?.GITLEAKS_VERSION ?? "", /^\d+\.\d+\.\d+$/);
  assertMatch(step.env?.GITLEAKS_SHA256 ?? "", /^[0-9a-f]{64}$/);
  const segments = commandSegments(step.run ?? "");
  const verifyIdx = segments.findIndex((seg) =>
    seg.startsWith("sha256sum") && seg.includes("--check")
  );
  const scanIdx = segments.findIndex((seg) => seg.startsWith("./gitleaks"));
  assert(verifyIdx !== -1, "fallback must verify the download with sha256sum");
  assert(verifyIdx < scanIdx, "checksum must be verified before gitleaks runs");
});

Deno.test("Gitleaks workflow pins every action to a commit SHA", async () => {
  const { text } = await loadWorkflow(WORKFLOW_PATH);
  assertActionsPinnedToSha(text);
});
