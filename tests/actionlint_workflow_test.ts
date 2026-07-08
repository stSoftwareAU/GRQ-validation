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
// actionlint, and pins its third-party image to an immutable sha256 digest
// (supply-chain hardening, mirroring semgrep.yml — Issue #72).

import { assert, assertEquals } from "@std/assert";
import {
  loadWorkflow,
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
// by invoking the binary in a `run:` block or by using the official
// rhysd/actionlint image (whose entrypoint is actionlint).
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
// commit SHA; a `docker://` image action pins to a 64-char sha256 digest.
// Neither may float on a mutable tag/branch.
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
