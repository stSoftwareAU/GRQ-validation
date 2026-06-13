// Tests for the CI/CD Pipeline GitHub Actions workflow (Issue #65).
//
// Supply-chain hardening: every third-party (and first-party) action used
// in ci.yml must be pinned to a 40-character commit SHA rather than a
// mutable tag/branch (e.g. @stable, @v4). A moving ref can be repointed at
// malicious code by a compromised upstream account and would then run in CI
// with the workflow token. These tests enforce SHA pinning and basic
// structural sanity.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/ci.yml";

Deno.test("CI workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("CI workflow parses as valid YAML", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "CI/CD Pipeline");
});

Deno.test("CI workflow pins every action to a 40-char commit SHA", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const usesLines = text.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    assert(
      /@[0-9a-f]{40}\s*$/.test(line.trim()),
      `action not pinned to 40-char SHA: ${line.trim()}`,
    );
  }
});

Deno.test("CI workflow no longer references the mutable rust-toolchain stable branch", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const usesLines = text.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
  // The branch ref must not appear on a `uses:` line (a trailing version
  // comment above the line documenting `@stable` is fine).
  assert(
    !usesLines.some((l) => /dtolnay\/rust-toolchain@stable\b/.test(l)),
    "dtolnay/rust-toolchain must be pinned to a SHA, not @stable",
  );
});

// Note: the "readable version comment above each pinned action" convention is
// deliberately NOT asserted here (Issue #86). It was a raw source-text /
// string-adjacency check on the YAML layout, not behaviour: moving the
// annotation inline (`uses: x@sha # x@tag`), reformatting, or blank-lining
// between the comment and `uses:` would break the test while CI behaves
// identically. The genuine supply-chain guard — SHA pinning — is enforced by
// the parsed "pins every action to a 40-char commit SHA" test above. The
// annotation convention, if wanted, belongs in a dedicated lint/actionlint
// rule rather than a unit assertion.

// Least-privilege GITHUB_TOKEN scoping (Issue #70). The workflow must declare
// an explicit restrictive top-level `permissions:` default so build/test jobs
// only ever read repository contents, rather than inheriting the broad
// repository-default token scope.
Deno.test("CI workflow declares a restrictive top-level permissions default", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const permissions = doc.permissions as Record<string, string> | undefined;
  assert(permissions, "workflow must declare a top-level permissions block");
  assertEquals(
    permissions.contents,
    "read",
    "top-level permissions must grant contents: read",
  );
});

Deno.test("CI workflow grants no write scopes at the top level", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const permissions = (doc.permissions ?? {}) as Record<string, string>;
  for (const [scope, value] of Object.entries(permissions)) {
    assert(
      value !== "write",
      `top-level permissions must be least-privilege; ${scope}: write is too broad`,
    );
  }
});

Deno.test("deploy-pages keeps its elevated per-job permissions", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const jobs = doc.jobs as Record<string, Record<string, unknown>>;
  const deploy = jobs["deploy-pages"];
  assert(deploy, "deploy-pages job must exist");
  const perms = deploy.permissions as Record<string, string> | undefined;
  assert(perms, "deploy-pages must declare its own permissions block");
  assertEquals(perms.pages, "write", "deploy-pages needs pages: write");
  assertEquals(
    perms["id-token"],
    "write",
    "deploy-pages needs id-token: write",
  );
  // A per-job block fully overrides the top-level default, so deploy-pages
  // must restate contents: read for its checkout step.
  assertEquals(
    perms.contents,
    "read",
    "deploy-pages must restate contents: read for checkout",
  );
});

Deno.test("build/test jobs do not declare their own permissions (inherit top-level)", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const jobs = doc.jobs as Record<string, Record<string, unknown>>;
  for (const name of ["check-changes", "test", "build"]) {
    assert(jobs[name], `${name} job must exist`);
    assertEquals(
      jobs[name].permissions,
      undefined,
      `${name} should inherit the top-level contents: read default`,
    );
  }
});

// Concurrency control (Issue #69). The pipeline triggers on push to main and
// pull_request to main but, without a concurrency group, successive pushes or
// rapid PR updates start a fresh full run (test, release build, SBOM, Pages
// deploy) without cancelling the superseded run. A top-level concurrency block
// keyed on the workflow and ref, with cancel-in-progress, ensures only the
// latest run for a given ref survives.
Deno.test("CI workflow declares a top-level concurrency group", async () => {
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

// Multi-line bash run: blocks must fail fast (Issue #73). Without
// `set -euo pipefail` an intermediate command that fails (or an unset
// variable) is masked by the success of the final command, so the step
// reports success even when an earlier stage broke.
type Step = { name?: string; run?: string };

function findRun(
  doc: Record<string, unknown>,
  jobName: string,
  stepName: string,
): string | undefined {
  const jobs = doc.jobs as Record<string, { steps?: Step[] }>;
  const step = jobs[jobName]?.steps?.find((s) => s.name === stepName);
  return step?.run;
}

function firstScriptLine(run: string): string {
  return run.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)[0] ??
    "";
}

Deno.test("multi-line bash run blocks begin with set -euo pipefail", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const targets: Array<[string, string]> = [
    ["check-changes", "Check for changes"],
    ["build", "Generate CycloneDX SBOM"],
    ["build", "Check Bash Script Syntax"],
  ];
  for (const [job, step] of targets) {
    const run = findRun(doc, job, step);
    assert(run, `step "${step}" in job "${job}" must exist with a run block`);
    assert(
      run.includes("\n"),
      `step "${step}" should be a multi-line run block`,
    );
    assertEquals(
      firstScriptLine(run),
      "set -euo pipefail",
      `step "${step}" must start its bash block with set -euo pipefail`,
    );
  }
});
