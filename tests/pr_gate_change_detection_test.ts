// Tests for PR-gate change detection (Issue #885).
//
// actionlint, cargo-audit, dependency-review and markdown-lint used to run on
// every pull request whatever it touched. Each now has a `changes` job whose
// output gates the real job, plus an always-run `*-result` aggregator so the
// check still reports a conclusion when the gated job is skipped. These tests
// parse the workflows and exercise each area regex against sample paths.

import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  loadWorkflow,
  type Workflow,
  type WorkflowJob,
  workflowTriggers,
} from "./workflow_assertions.ts";

const WORKFLOWS = ".github/workflows";

interface GatedWorkflow {
  file: string;
  job: string;
  aggregator: string;
  /** Literal twin of the workflow's `PATHS_REGEX` (grep -E syntax). */
  pathsRegex: RegExp;
  matches: string[];
  ignores: string[];
}

const GATED: GatedWorkflow[] = [
  {
    file: "actionlint.yml",
    job: "actionlint",
    aggregator: "actionlint-result",
    pathsRegex: /^\.github\/workflows\//,
    matches: [".github/workflows/ci.yml", ".github/workflows/actionlint.yml"],
    ignores: ["README.md", "docs/app.js", "src/main.rs", ".github/CODEOWNERS"],
  },
  {
    file: "cargo-audit.yml",
    job: "audit",
    aggregator: "cargo-audit-result",
    pathsRegex:
      /^(Cargo\.toml|Cargo\.lock|\.github\/workflows\/cargo-audit\.yml)$/,
    matches: ["Cargo.toml", "Cargo.lock", ".github/workflows/cargo-audit.yml"],
    ignores: ["src/main.rs", "docs/Cargo.lock", "README.md", "deno.lock"],
  },
  {
    file: "dependency-review.yml",
    job: "dependency-review",
    aggregator: "dependency-review-result",
    pathsRegex:
      /^(Cargo\.toml|Cargo\.lock|deno\.jsonc?|deno\.lock|package(-lock)?\.json|\.github\/workflows\/.*)$/,
    matches: [
      "Cargo.lock",
      "Cargo.toml",
      "deno.json",
      "deno.lock",
      "package.json",
      "package-lock.json",
      ".github/workflows/ci.yml",
    ],
    ignores: ["src/main.rs", "docs/app.js", "README.md", "tests/a_test.ts"],
  },
  {
    file: "markdown-lint.yml",
    job: "markdownlint",
    aggregator: "markdownlint-result",
    pathsRegex:
      /(\.md$|^\.markdownlint-cli2\.jsonc$|^\.github\/workflows\/markdown-lint\.yml$)/,
    matches: [
      "README.md",
      "docs/archive/pr-summaries/pr-summary-885.md",
      ".markdownlint-cli2.jsonc",
      ".github/workflows/markdown-lint.yml",
    ],
    ignores: ["docs/app.js", "src/main.rs", "README.mdx", "deno.json"],
  },
];

function needsList(job: WorkflowJob): string[] {
  const needs = job.needs;
  if (needs === undefined) return [];
  return Array.isArray(needs) ? needs : [needs];
}

function requireJob(doc: Workflow, name: string, file: string): WorkflowJob {
  const job = doc.jobs?.[name];
  assert(job, `${file} must define a '${name}' job`);
  return job;
}

function filterStep(doc: Workflow, file: string) {
  const changes = requireJob(doc, "changes", file);
  const step = (changes.steps ?? []).find((s) => s.id === "filter");
  assert(step, `${file} changes job must have a step with id 'filter'`);
  return step;
}

// The workflow's PATHS_REGEX must equal the test's literal regex, so the
// sample paths exercised against the literal prove the workflow's behaviour.
function assertPathsRegex(doc: Workflow, wf: GatedWorkflow): RegExp {
  const pattern = filterStep(doc, wf.file).env?.PATHS_REGEX;
  assert(pattern, `${wf.file} filter step must set env.PATHS_REGEX`);
  assertEquals(pattern, wf.pathsRegex.source.replaceAll("\\/", "/"));
  return wf.pathsRegex;
}

for (const wf of GATED) {
  const path = `${WORKFLOWS}/${wf.file}`;

  Deno.test(`${wf.file} - changes job checks out full history without persisted credentials`, async () => {
    const { doc } = await loadWorkflow(path);
    const changes = requireJob(doc, "changes", wf.file);
    assertEquals(
      changes.outputs?.changed,
      "${{ steps.filter.outputs.changed }}",
      "changes job must expose the filter step's `changed` output",
    );
    const checkout = (changes.steps ?? []).find((s) =>
      s.uses?.startsWith("actions/checkout@")
    );
    assert(checkout, "changes job must check out the repo to diff it");
    assertEquals(checkout.with?.["persist-credentials"], false);
    assertEquals(checkout.with?.["fetch-depth"], 0);
  });

  Deno.test(`${wf.file} - filter step passes context via env and fails loud`, async () => {
    const { doc } = await loadWorkflow(path);
    const step = filterStep(doc, wf.file);
    const run = step.run ?? "";
    assert(
      run.trimStart().startsWith("set -euo pipefail"),
      "filter script must start with set -euo pipefail",
    );
    assert(!run.includes("${{"), "filter script must not interpolate ${{ }}");
    assertEquals(step.env?.EVENT_NAME, "${{ github.event_name }}");
    assertEquals(
      step.env?.BASE_SHA,
      "${{ github.event.pull_request.base.sha }}",
    );
    assertEquals(step.env?.HEAD_SHA, "${{ github.sha }}");
    assertMatch(run, /changed=true/);
    assertMatch(run, /changed=false/);
  });

  Deno.test(`${wf.file} - '${wf.job}' job is gated on the changes output`, async () => {
    const { doc } = await loadWorkflow(path);
    const job = requireJob(doc, wf.job, wf.file);
    assert(needsList(job).includes("changes"), `${wf.job} must need changes`);
    assertEquals(job.if, "needs.changes.outputs.changed == 'true'");
  });

  Deno.test(`${wf.file} - '${wf.aggregator}' always reports a conclusion`, async () => {
    const { doc } = await loadWorkflow(path);
    const agg = requireJob(doc, wf.aggregator, wf.file);
    assertEquals(agg.if, "always()");
    const needs = needsList(agg);
    assert(needs.includes("changes"), "aggregator must need changes");
    assert(needs.includes(wf.job), `aggregator must need ${wf.job}`);
    const steps = agg.steps ?? [];
    assertEquals(steps.length, 1);
    assertEquals(steps[0].env?.RESULTS, "${{ join(needs.*.result, ' ') }}");
    const run = steps[0].run ?? "";
    assert(run.trimStart().startsWith("set -euo pipefail"));
    assert(!run.includes("${{"), "aggregator script must not interpolate");
    assertMatch(run, /success\|skipped/);
    assertMatch(run, /exit 1/);
  });

  Deno.test(`${wf.file} - pull_request trigger has no workflow-level path filter`, async () => {
    const { doc } = await loadWorkflow(path);
    const pr = workflowTriggers(doc)?.pull_request as
      | Record<string, unknown>
      | null;
    assert(pr, `${wf.file} must still trigger on pull_request`);
    assertEquals(pr.paths, undefined, "paths: leaves required checks pending");
    assertEquals(pr["paths-ignore"], undefined);
  });

  Deno.test(`${wf.file} - area regex selects the files this gate checks`, async () => {
    const { doc } = await loadWorkflow(path);
    const re = assertPathsRegex(doc, wf);
    for (const p of wf.matches) assert(re.test(p), `${p} should trigger`);
    for (const p of wf.ignores) assert(!re.test(p), `${p} should not trigger`);
  });
}

// Secret and SAST scanners must see every PR, and the Deno suite reads almost
// the whole tree (docs/, src/, workflows, top-level docs), so a path scope
// would silently skip tests guarding those files.
for (const file of ["gitleaks.yml", "semgrep.yml", "deno-quality.yml"]) {
  Deno.test(`${file} - stays ungated by change detection`, async () => {
    const { doc } = await loadWorkflow(`${WORKFLOWS}/${file}`);
    assertEquals(doc.jobs?.changes, undefined, `${file} must not add changes`);
    for (const [name, job] of Object.entries(doc.jobs ?? {})) {
      assert(
        !needsList(job).includes("changes"),
        `${file} job ${name} must not need changes`,
      );
      assert(
        !(job.if ?? "").includes("needs.changes"),
        `${file} job ${name} must not be gated on changes`,
      );
    }
  });
}
