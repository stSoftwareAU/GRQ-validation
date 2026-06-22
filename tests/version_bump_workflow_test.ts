// Tests for the Version Bump workflow (Issue #323).
//
// Verify the CI workflow that increments the dashboard app version on every
// pull request exists, parses as YAML, triggers on pull_request, invokes
// scripts/bump_version.ts via `deno run` with the permissions it needs,
// commits the result back to the PR branch, and pins actions to commit SHAs.

import { assert, assertEquals } from "@std/assert";
import {
  assertActionsPinnedToSha,
  invokesTool,
  loadWorkflow,
  workflowSteps,
  workflowTriggers,
} from "./workflow_assertions.ts";

const WORKFLOW_PATH = ".github/workflows/version-bump.yml";
const BUMP_SCRIPT = "scripts/bump_version.ts";

Deno.test("version bump workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("version bump workflow triggers on pull_request", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const on = workflowTriggers(doc);
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "version bump must run on pull_request");
});

Deno.test("version bump workflow runs the bump script via deno run", async () => {
  // Derived-relationship invariant: the referenced script exists on disk and
  // the workflow invokes it through `deno run` with read+write access.
  const stat = await Deno.stat(BUMP_SCRIPT);
  assert(stat.isFile, `${BUMP_SCRIPT} must exist on disk`);

  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc);
  assert(
    invokesTool(steps, "deno", {
      subcommand: "run",
      args: [BUMP_SCRIPT, "--allow-read", "--allow-write"],
    }),
    "workflow must run scripts/bump_version.ts with --allow-read --allow-write",
  );
});

Deno.test("version bump workflow commits the bump back to the PR branch", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc);
  // It must create a commit and push it for the client to actually update.
  assert(
    invokesTool(steps, "git", { subcommand: "commit" }),
    "workflow must commit the version bump",
  );
  assert(
    invokesTool(steps, "git", { subcommand: "push" }),
    "workflow must push the version bump back to the branch",
  );
});

Deno.test("version bump job grants contents: write", async () => {
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const job = doc.jobs?.["bump-version"];
  assert(job, "workflow must define a bump-version job");
  assertEquals(
    job.permissions?.contents,
    "write",
    "bump-version job needs contents: write to push the commit",
  );
});

Deno.test("version bump workflow pins actions to commit SHAs", async () => {
  const { text } = await loadWorkflow(WORKFLOW_PATH);
  assertActionsPinnedToSha(text);
});
