// Tests for the actionlint GitHub Actions lint-gate workflow (Issue #725).
//
// actionlint is the standard linter for workflow YAML: it catches syntax
// errors, invalid `${{ }}` expressions, and — via its bundled shellcheck
// integration — shell issues inside `run:` blocks. This gate fails the build
// when a workflow regression is introduced, mirroring the shellcheck,
// markdown-lint, gitleaks and semgrep gates already in this repo.
//
// The assertions operate on the parsed YAML (structured assertions, not
// source-text greps — Issue #202) and verify the gate's invariants: the file
// exists and parses, triggers on pull_request, is least-privilege
// (contents: read), cancels superseded runs (Issue #139), actually invokes
// actionlint, and installs it from a version-pinned, sha256-verified release
// download rather than a `docker://` step action, which the organisation's
// Actions allow-list refuses (Issue #903).

import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  assertPullRequestRunsOnMilestone,
  branchFilterMatches,
  loadWorkflow,
  triggerBranches,
  workflowSteps,
  workflowTriggers,
} from "./workflow_assertions.ts";

const WORKFLOW_PATH = ".github/workflows/actionlint.yml";

Deno.test("actionlint workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("actionlint workflow parses as valid YAML with expected name", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  assertEquals(doc.name, "Actionlint");
});

Deno.test("actionlint workflow triggers on pull_request", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const on = workflowTriggers(doc);
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "must trigger on pull_request");
});

// Issue #866: a lint/checker gates the PR, so it must not re-run on push to
// the default branch — that duplicates the run that already gated the PR.
// A `push:` trigger may remain only if its branch filter excludes main/master.
Deno.test("actionlint workflow does not trigger on push to the default branch", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const pushBranches = triggerBranches(doc, "push");
  if (pushBranches === null) return; // No push trigger at all — compliant.
  for (const branch of ["main", "master"]) {
    assert(
      !branchFilterMatches(pushBranches, branch),
      `push trigger must not reach the default branch "${branch}"`,
    );
  }
});

Deno.test("actionlint workflow allows manual workflow_dispatch", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const on = workflowTriggers(doc);
  assert(on, "workflow must declare an 'on' trigger");
  assert("workflow_dispatch" in on, "must allow manual workflow_dispatch");
});

// Issue #788: milestone sub-issue PRs target a shared `milestone/<slug>`
// integration branch. A `branches: ["*"]` filter skips them because the `*`
// glob does not match the `/`, so the gate must run on milestone branches too.
Deno.test("actionlint workflow runs on milestone/* pull requests", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  assertPullRequestRunsOnMilestone(doc);
});

Deno.test("actionlint workflow declares read-only contents permission", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  assert(doc.permissions, "workflow must declare top-level permissions");
  assertEquals(doc.permissions.contents, "read");
});

// Concurrency cancellation (Issue #139): without a concurrency group, rapid
// pushes to the same ref queue redundant overlapping runs that each hold a
// runner. A top-level block keyed on workflow + ref with cancel-in-progress
// leaves only the latest run for a given ref alive.
Deno.test("actionlint workflow declares a concurrency group that cancels superseded runs", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
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

// The whole point of the gate: some step must actually run actionlint, either
// by invoking the downloaded binary in a `run:` block or by using an
// actionlint-named action/image.
Deno.test("actionlint workflow actually invokes actionlint", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc);
  const invokes = steps.some((step) => {
    const runsBinary = /\bactionlint\b/.test(step.run ?? "");
    const usesImage = typeof step.uses === "string" &&
      step.uses.includes("actionlint");
    return runsBinary || usesImage;
  });
  assert(invokes, "a step must invoke actionlint (run: or docker image)");
});

// Supply-chain hardening (Issue #72): every third-party action must be pinned
// to an immutable ref. First-party actions (actions/checkout) pin to a 40-char
// commit SHA; a `docker://` image action, were one ever added back, would need
// to pin to a 64-char sha256 digest. Neither may float on a mutable tag/branch.
Deno.test("actionlint workflow pins every action to an immutable ref", async () => {
  const { text } = await loadWorkflow(WORKFLOW_PATH);
  const usesLines = text.split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-?\s*uses:/.test(line));
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    const pinned = /@[0-9a-f]{40}\s*$/.test(line) || // commit SHA
      /@sha256:[0-9a-f]{64}\s*$/.test(line); // docker image digest
    assert(pinned, `action not pinned to an immutable ref: ${line}`);
  }
});

// Issue #867: the actionlint job only reads the tree to lint it — it never
// pushes back or fetches a private submodule — so the checkout must not
// persist GITHUB_TOKEN into .git/config where a later step could read it.
Deno.test("actionlint checkout does not persist credentials", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const checkouts = workflowSteps(doc, "actionlint").filter((step) =>
    typeof step.uses === "string" && step.uses.startsWith("actions/checkout@")
  );
  assert(checkouts.length > 0, "actionlint job must have a checkout step");
  for (const checkout of checkouts) {
    assertEquals(
      checkout.with?.["persist-credentials"],
      false,
      "checkout must set persist-credentials: false",
    );
  }
});

// Issue #903: the organisation's Actions allow-list refuses third-party
// `docker://` step actions outright (startup_failure on every run), so no
// step anywhere in this workflow may use one.
Deno.test("actionlint workflow never uses a docker:// step action", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const dockerSteps = workflowSteps(doc)
    .map((step) => step.uses)
    .filter((uses): uses is string =>
      typeof uses === "string" && uses.startsWith("docker://")
    );
  assertEquals(
    dockerSteps,
    [],
    "no step may use a docker:// action; the org allow-list refuses it",
  );
});

// Issue #903: with the docker:// action gone, the actionlint job must
// download the pinned release binary and verify it against its published
// sha256 before running it.
Deno.test("actionlint job downloads an exact-version release and verifies its sha256", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc, "actionlint");
  const installStep = steps.find((step) =>
    typeof step.env?.ACTIONLINT_VERSION === "string" &&
    typeof step.env?.ACTIONLINT_SHA256 === "string"
  );
  assert(
    installStep,
    "actionlint job must have a step with ACTIONLINT_VERSION and ACTIONLINT_SHA256 env",
  );
  const env = installStep.env as Record<string, string>;
  assertMatch(
    env.ACTIONLINT_VERSION,
    /^\d+\.\d+\.\d+$/,
    "ACTIONLINT_VERSION must be an exact release version",
  );
  assertMatch(
    env.ACTIONLINT_SHA256,
    /^[0-9a-f]{64}$/,
    "ACTIONLINT_SHA256 must be a 64-char hex sha256",
  );
  assert(
    (installStep.run ?? "").includes("sha256sum -c"),
    "install step must verify the download with sha256sum -c",
  );
});
