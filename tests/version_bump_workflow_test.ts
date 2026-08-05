// Tests for the Version Bump workflow (Issue #323).
//
// Verify the CI workflow that increments the dashboard app version on every
// pull request exists, parses as YAML, triggers on pull_request, invokes
// scripts/bump_version.ts via `deno run` with the permissions it needs,
// commits the result back to the PR branch, and pins actions to commit SHAs.
//
// The same job also increments the Rust [package].version via
// scripts/version-increment.sh and keeps Cargo.lock in step, so a deployed
// binary built from an earlier commit is detectable as stale (Issue #818).

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
const VERSION_INCREMENT_SCRIPT = "scripts/version-increment.sh";

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

Deno.test("version bump workflow increments the Cargo package version", async () => {
  // Issue #818: the deployed scorer rebuilds when its binary's --version no
  // longer matches Cargo.toml, so every PR must move [package].version.
  const stat = await Deno.stat(VERSION_INCREMENT_SCRIPT);
  assert(stat.isFile, `${VERSION_INCREMENT_SCRIPT} must exist on disk`);

  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc);
  assert(
    invokesTool(steps, `./${VERSION_INCREMENT_SCRIPT}`, {
      args: ["--run", "--manifest"],
    }),
    `workflow must run ${VERSION_INCREMENT_SCRIPT} --run against a manifest`,
  );
});

Deno.test("version bump workflow keeps Cargo.lock in step with the manifest", async () => {
  // CI builds with --locked (ci.yml), so a manifest bump that leaves the lock
  // file behind would fail every subsequent job.
  const { doc } = await loadWorkflow(WORKFLOW_PATH);
  const steps = workflowSteps(doc);
  assert(
    invokesTool(steps, "cargo", {
      subcommand: "update",
      args: ["--workspace"],
    }),
    "workflow must refresh the workspace entry in Cargo.lock",
  );
  assert(
    invokesTool(steps, "git", { subcommand: "add", args: ["Cargo.lock"] }),
    "workflow must stage Cargo.lock alongside Cargo.toml",
  );
  assert(
    invokesTool(steps, "git", { subcommand: "add", args: ["Cargo.toml"] }),
    "workflow must stage Cargo.toml",
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
