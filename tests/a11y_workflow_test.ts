// Tests for the Accessibility (a11y) GitHub Actions workflow (Issue #92).
//
// The repo ships an interactive dashboard from docs/ (index.html, list.html,
// app.js, list.js) published to GitHub Pages. This workflow gates that UI with
// an automated accessibility check (pa11y-ci) on every pull request touching
// docs/, failing the build on WCAG 2.1 AA violations.
//
// These tests verify the workflow file exists, parses as YAML, declares the
// expected pull_request trigger scoped to docs/**, declares a read-only
// contents permission, defines a job that serves the docs and runs pa11y-ci
// over the dashboard pages with the WCAG2AA standard, bounds the job with a
// timeout, and pins third-party actions to 40-character commit SHAs to satisfy
// the supply-chain rule.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/a11y.yml";

interface Step {
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface Job {
  "runs-on"?: string;
  "timeout-minutes"?: number;
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

Deno.test("a11y workflow triggers on pull_request scoped to docs/**", async () => {
  const doc = await loadWorkflow();
  const on = getOn(doc);
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "must trigger on pull_request");
  const pr = on.pull_request as { paths?: string[] };
  assert(Array.isArray(pr.paths), "pull_request must declare a paths filter");
  assert(
    pr.paths.some((p) => p.includes("docs/")),
    "paths filter must scope the workflow to docs/",
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
  const runs = allSteps(doc).map((s) => s.run ?? "").join("\n");
  assert(/pa11y-ci/.test(runs), "a job must run pa11y-ci");
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
  const runs = allSteps(doc).map((s) => s.run ?? "").join("\n");
  // The dashboard is a static site; a local server must back the a11y check
  // because pa11y loads pages over HTTP.
  assert(
    /http-server|http:\/\/localhost/.test(runs),
    "workflow must serve docs/ over a local HTTP server",
  );
});

Deno.test("a11y workflow pins actions to 40-character commit SHAs", async () => {
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
