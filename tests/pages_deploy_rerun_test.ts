// Tests for the Pages deploy re-run hardening in the CI/CD workflow
// (Issue #706).
//
// Re-running a failed CI/CD run previously failed deterministically:
// `upload-pages-artifact` uploaded a second `github-pages` artifact onto the
// same run and `deploy-pages` hard-fails when it finds more than one
// ("Multiple artifacts named github-pages … Artifact count is 2"). The
// workflow must therefore:
//   * upload under a per-attempt artifact name keyed on github.run_attempt,
//   * point deploy-pages at that same per-attempt name,
//   * delete any leftover github-pages* artifacts on the current run before
//     uploading (requires actions: write), and
//   * retry the deploy step once after a short wait so unattended daily
//     deploys self-recover from GitHub-side transients.
//
// These assertions operate on the parsed workflow (structured data), not on
// source-text greps, so behaviour-preserving edits do not break them.

import { assert, assertEquals } from "@std/assert";
import {
  commandSegments,
  loadWorkflow,
  type WorkflowStep,
  workflowSteps,
} from "./workflow_assertions.ts";

const WORKFLOW_PATH = ".github/workflows/ci.yml";

function deploySteps(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.filter((s) =>
    typeof s.uses === "string" && s.uses.startsWith("actions/deploy-pages@")
  );
}

function uploadStep(steps: WorkflowStep[]): WorkflowStep | undefined {
  return steps.find((s) =>
    typeof s.uses === "string" &&
    s.uses.startsWith("actions/upload-pages-artifact@")
  );
}

Deno.test("deploy-pages job grants actions: write for artifact cleanup", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const perms = doc.jobs?.["deploy-pages"]?.permissions;
  assert(perms, "deploy-pages must declare its own permissions block");
  assertEquals(
    perms.actions,
    "write",
    "deploy-pages needs actions: write to delete stale artifacts",
  );
});

Deno.test("deploy-pages preserves its existing elevated permissions", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const perms = doc.jobs?.["deploy-pages"]?.permissions ?? {};
  assertEquals(perms.pages, "write", "deploy-pages still needs pages: write");
  assertEquals(
    perms["id-token"],
    "write",
    "deploy-pages still needs id-token: write",
  );
  assertEquals(
    perms.contents,
    "read",
    "deploy-pages still needs contents: read for checkout",
  );
});

Deno.test("upload-pages-artifact uses a per-attempt artifact name", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc, "deploy-pages");
  const upload = uploadStep(steps);
  assert(upload, "deploy-pages must upload a Pages artifact");
  const name = String(upload.with?.name ?? "");
  assert(
    name.includes("github.run_attempt"),
    `upload artifact name must be keyed on run_attempt, got "${name}"`,
  );
});

Deno.test("deploy-pages targets the same per-attempt artifact name", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc, "deploy-pages");
  const upload = uploadStep(steps);
  const deploys = deploySteps(steps);
  assert(deploys.length > 0, "deploy-pages must run actions/deploy-pages");
  const uploadName = String(upload?.with?.name ?? "");
  for (const deploy of deploys) {
    const artifactName = String(deploy.with?.artifact_name ?? "");
    assertEquals(
      artifactName,
      uploadName,
      "deploy-pages artifact_name must match the uploaded per-attempt name",
    );
  }
});

Deno.test("deploy-pages deletes stale github-pages artifacts before upload", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc, "deploy-pages");
  const uploadIdx = steps.findIndex((s) =>
    typeof s.uses === "string" &&
    s.uses.startsWith("actions/upload-pages-artifact@")
  );
  assert(uploadIdx >= 0, "upload step must exist");

  const cleanupIdx = steps.findIndex((s) => {
    const segments = commandSegments(s.run ?? "");
    // A cleanup segment invokes `gh api` with a DELETE against artifacts.
    return segments.some((seg) => {
      const tokens = seg.split(/\s+/);
      return tokens.includes("gh") && tokens.includes("api") &&
        /delete/i.test(seg) && /artifact/i.test(seg);
    });
  });
  assert(
    cleanupIdx >= 0,
    "a step must delete stale github-pages artifacts via the Actions API",
  );
  assert(
    cleanupIdx < uploadIdx,
    "artifact cleanup must run before the upload step",
  );
});

Deno.test("deploy step is retried once after a wait on transient failure", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc, "deploy-pages");
  const deploys = deploySteps(steps);
  assert(
    deploys.length >= 2,
    "there must be an initial deploy and a retry deploy step",
  );

  const [first, second] = deploys;
  assertEquals(
    first["continue-on-error" as keyof WorkflowStep] ??
      (first as Record<string, unknown>)["continue-on-error"],
    true,
    "the first deploy must not fail the job so the retry can run",
  );
  const retryIf = String((second as Record<string, unknown>).if ?? "");
  assert(
    retryIf.includes("failure"),
    "the retry deploy must be conditioned on the first attempt failing",
  );

  // A wait must separate the two attempts so a GitHub-side transient can clear.
  const hasWait = steps.some((s) =>
    commandSegments(s.run ?? "").some((seg) => /\bsleep\b/.test(seg))
  );
  assert(hasWait, "a wait (sleep) must separate the deploy attempts");
});
