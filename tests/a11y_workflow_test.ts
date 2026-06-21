// Tests for the Accessibility (a11y) GitHub Actions workflow (Issue #92).
//
// The repo ships an interactive dashboard from docs/ (index.html, list.html,
// app.js, list.js) published to GitHub Pages. This workflow gates that UI with
// an automated accessibility check (pa11y-ci) on every pull request touching
// docs/, failing the build on WCAG 2.1 AA violations.
//
// These tests verify the workflow file exists, parses as YAML, declares the
// expected pull_request trigger (always runs; pa11y job gated on docs/ changes),
// declares a read-only
// contents permission, defines a job that serves the docs and runs pa11y-ci
// over the dashboard pages with the WCAG2AA standard, bounds the job with a
// timeout, and pins third-party actions to 40-character commit SHAs to satisfy
// the supply-chain rule.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import {
  assertActionsPinnedToSha,
  invokesTool,
} from "./workflow_assertions.ts";

const WORKFLOW_PATH = ".github/workflows/a11y.yml";

interface Step {
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface Job {
  "runs-on"?: string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  if?: string;
  steps?: Step[];
}

interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
}

async function loadWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as Workflow;
}

const PA11Y_CONFIG_PATH = "pa11yci.json";

interface Pa11yConfig {
  defaults?: { standard?: string };
  urls?: string[];
}

async function loadPa11yConfig(): Promise<Pa11yConfig> {
  const text = await Deno.readTextFile(PA11Y_CONFIG_PATH);
  return JSON.parse(text) as Pa11yConfig;
}

// YAML 1.1 parses a bare `on:` key as the boolean true; accept either form.
function getOn(doc: Workflow): Record<string, unknown> {
  const raw = doc as Record<string, unknown>;
  return (raw.on ?? raw["true"] ??
    raw[true as unknown as string]) as Record<string, unknown>;
}

function allSteps(doc: Workflow): Step[] {
  return Object.values(doc.jobs ?? {}).flatMap((j) => j.steps ?? []);
}

Deno.test("a11y workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("a11y workflow parses as valid YAML with expected name", async () => {
  const doc = await loadWorkflow();
  assertEquals(doc.name, "Accessibility");
});

Deno.test("a11y workflow triggers on every pull_request", async () => {
  const doc = await loadWorkflow();
  const on = getOn(doc);
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "must trigger on pull_request");
});

// Issue #219: the Main ruleset requires the `pa11y` status check on every PR.
// A workflow-level paths: filter suppresses the run when docs/ is unchanged,
// leaving the required check pending (e.g. Dependabot PR #217). Gate the scan
// with a job-level `if` instead, matching ci.yml and gitleaks.yml.
Deno.test("a11y pa11y job runs only when docs/ changed", async () => {
  const doc = await loadWorkflow();
  const job = doc.jobs?.pa11y;
  assert(job, "workflow must declare a pa11y job");
  const needs = job.needs;
  const dependsOnCheckDocs = Array.isArray(needs)
    ? needs.includes("check-docs-changes")
    : needs === "check-docs-changes";
  assert(
    dependsOnCheckDocs,
    "pa11y job must depend on check-docs-changes",
  );
  assert(
    typeof job.if === "string",
    "pa11y job must declare an 'if' condition gating on docs changes",
  );
  const condition = job.if as string;
  assert(
    condition.includes("docs-changed"),
    `pa11y job 'if' must reference the docs-changed output: ${condition}`,
  );
});

Deno.test("a11y workflow declares read-only contents permission", async () => {
  const doc = await loadWorkflow();
  assert(doc.permissions, "workflow must declare top-level permissions");
  assertEquals(doc.permissions.contents, "read");
});

Deno.test("a11y workflow defines a job with a sane timeout", async () => {
  const doc = await loadWorkflow();
  assert(doc.jobs, "workflow must declare jobs");
  const jobs = Object.values(doc.jobs);
  assert(jobs.length > 0, "workflow must declare at least one job");
  for (const job of jobs) {
    assertEquals(job["runs-on"], "ubuntu-latest");
    assert(
      typeof job["timeout-minutes"] === "number" &&
        job["timeout-minutes"] > 0,
      "job must declare a positive timeout-minutes",
    );
  }
});

Deno.test("a11y workflow runs pa11y-ci against the dashboard pages", async () => {
  const doc = await loadWorkflow();
  // Structured invariant (Issue #202): a step invokes pa11y-ci (here via npx),
  // matched on tokens rather than grepping the run-step source text.
  assert(invokesTool(allSteps(doc), "pa11y-ci"), "a job must run pa11y-ci");
  // The target URLs live in pa11yci.json (passed via --config), not in the
  // workflow run command. Both published dashboard pages must be exercised.
  const config = await loadPa11yConfig();
  const urls = (config.urls ?? []).join("\n");
  assert(/index\.html/.test(urls), "pa11y-ci must check index.html");
  assert(/list\.html/.test(urls), "pa11y-ci must check list.html");
});

Deno.test("a11y workflow enforces the WCAG2AA standard", async () => {
  // The standard is configured in pa11yci.json (defaults.standard), not on the
  // pa11y-ci CLI, so the build fails on WCAG 2.1 AA violations.
  const config = await loadPa11yConfig();
  assertEquals(
    config.defaults?.standard,
    "WCAG2AA",
    "pa11y-ci must run with the WCAG2AA standard so the build fails on WCAG 2.1 AA violations",
  );
});

Deno.test("a11y workflow serves the docs/ directory before checking", async () => {
  const doc = await loadWorkflow();
  // The dashboard is a static site; a local server must back the a11y check
  // because pa11y loads pages over HTTP. Assert the http-server tool is
  // invoked (Issue #202) rather than grepping the run-step source text.
  assert(
    invokesTool(allSteps(doc), "http-server"),
    "workflow must serve docs/ over a local HTTP server",
  );
});

// Multi-line bash run: blocks must fail fast (Issue #173). Without
// `set -euo pipefail` an intermediate command that fails (e.g. npx failing to
// install http-server) is masked by the success of a later command, so the
// step reports success even when an earlier stage broke.
Deno.test("a11y multi-line bash run blocks begin with set -euo pipefail", async () => {
  const doc = await loadWorkflow();
  const multiLineRuns = allSteps(doc)
    .map((s) => s.run ?? "")
    .filter((run) => run.includes("\n"));
  assert(
    multiLineRuns.length > 0,
    "workflow must contain at least one multi-line run block",
  );
  for (const run of multiLineRuns) {
    const firstLine = run.split("\n").map((l) => l.trim())
      .filter((l) => l.length > 0)[0] ?? "";
    assertEquals(
      firstLine,
      "set -euo pipefail",
      "every multi-line bash run block must start with set -euo pipefail",
    );
  }
});

Deno.test("a11y workflow pins actions to 40-character commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  assertActionsPinnedToSha(text);
});
