// Tests for the Markdown Lint GitHub Actions workflow (Issue #23).
//
// These tests verify the workflow file exists, parses as YAML, and contains
// the required steps. They also verify a markdownlint-cli2 config is present
// so the workflow passes against the existing markdown files in this repo.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { parse as parseJsonc } from "@std/jsonc";
import { assertActionsPinnedToSha } from "./workflow_assertions.ts";

const WORKFLOW_PATH = ".github/workflows/markdown-lint.yml";
const CONFIG_PATH = ".markdownlint-cli2.jsonc";

type Step = { name?: string; run?: string };

Deno.test("Markdown Lint workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("Markdown Lint workflow parses as valid YAML", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "Markdown Lint");
});

Deno.test("Markdown Lint workflow has correct triggers", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  // YAML "on" key sometimes parses to boolean true — accept either key.
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "must trigger on pull_request");
  // Issue #726: this is a lint/checker workflow that gates the PR. It must not
  // re-run on push to the default branch — that duplicates the run which
  // already gated the PR and wastes CI minutes. Allow manual dispatch instead.
  assert("workflow_dispatch" in on, "must allow manual workflow_dispatch");
});

// Issue #726: a lint/checker gates the PR, so it must not fire on push to the
// default branch. If the workflow keeps a `push:` trigger at all, its branch
// filter must exclude `main` (and `master`); a bare `push:` reaching the
// default branch re-runs the same check that already passed on the PR.
Deno.test("Markdown Lint workflow does not trigger on push to the default branch", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  if (!("push" in on)) return; // No push trigger at all — compliant.
  const push = on.push as { branches?: string[] } | null;
  const branches = push?.branches ?? [];
  assert(
    branches.length > 0,
    "a bare `push:` reaches the default branch — narrow its branches or drop push",
  );
  for (const branch of branches) {
    assert(
      branch !== "main" && branch !== "master",
      `push trigger must not include the default branch (found "${branch}")`,
    );
  }
});

Deno.test("Markdown Lint workflow defines markdownlint job", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, unknown> };
  assert(doc.jobs, "workflow must have jobs");
  assert(doc.jobs.markdownlint, "markdownlint job must exist");
  const job = doc.jobs.markdownlint as { "runs-on": string; steps: unknown[] };
  assertEquals(job["runs-on"], "ubuntu-latest");
  assert(
    Array.isArray(job.steps) && job.steps.length > 0,
    "job must have steps",
  );
});

Deno.test("Markdown Lint workflow runs markdownlint-cli2 in its job", async () => {
  // WHAT check (Issue #86): parse the YAML and confirm the markdownlint job
  // actually invokes markdownlint-cli2 in one of its `run` steps, rather than
  // grepping the raw file for one exact install incantation. This keeps the
  // real invariant (the lint job runs the linter) while tolerating a
  // behaviour-preserving change to how the tool is installed (e.g. pinning a
  // version, `npm i -g`, or a setup action).
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, { steps?: Step[] }> };
  const steps = doc.jobs?.markdownlint?.steps ?? [];
  assert(steps.length > 0, "markdownlint job must declare steps");
  const runText = steps.map((s) => s.run ?? "").join("\n");
  assertStringIncludes(
    runText,
    "markdownlint-cli2",
    "markdownlint job must invoke markdownlint-cli2 in a run step",
  );
});

// Issue #533: harden the CI Node-tooling install. The markdownlint-cli2 install
// must pass --ignore-scripts so the npm lifecycle hooks of the tool and its
// entire transitive tree never execute against the checked-out workspace, and
// must pin an exact version so the spec cannot float to whatever the registry
// currently serves. markdownlint-cli2 is pure JS with no build step, so
// disabling install scripts is functionally a no-op.
Deno.test("Markdown Lint install is hardened with --ignore-scripts and an exact version pin", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, { steps?: Step[] }> };
  const steps = doc.jobs?.markdownlint?.steps ?? [];
  const installStep = steps.find((s) =>
    /\bnpm install\b/.test(s.run ?? "") && /markdownlint-cli2/.test(s.run ?? "")
  );
  assert(installStep, "workflow must install markdownlint-cli2 via npm");
  const run = installStep.run ?? "";
  assert(
    /--ignore-scripts\b/.test(run),
    "markdownlint-cli2 install must pass --ignore-scripts to disable npm lifecycle scripts",
  );
  assert(
    /markdownlint-cli2@\d+\.\d+\.\d+\b/.test(run),
    `markdownlint-cli2 install must pin an exact version (got: ${run.trim()})`,
  );
});

Deno.test("Markdown Lint workflow pins actions to commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  assertActionsPinnedToSha(text);
});

Deno.test("markdownlint-cli2 config exists and parses as JSONC", async () => {
  const text = await Deno.readTextFile(CONFIG_PATH);
  const config = parseJsonc(text) as Record<string, unknown>;
  assert(config, "config must parse to an object");
  assert("config" in config, "must declare rule config");
});

Deno.test("markdownlint-cli2 passes against repository markdown files", async () => {
  // The workflow runs `markdownlint-cli2` with no args, so it uses the
  // globs declared in the config. This test asserts the same invocation
  // returns exit code 0 — i.e. the lint passes against existing files.
  const cmd = new Deno.Command("markdownlint-cli2", {
    args: [],
    stdout: "piped",
    stderr: "piped",
  });
  let result;
  try {
    result = await cmd.output();
  } catch (err) {
    // Skip when the tool is not installed or when --allow-run is not granted.
    if (
      err instanceof Deno.errors.NotFound ||
      err instanceof Deno.errors.NotCapable
    ) {
      console.warn(
        "markdownlint-cli2 not available (not installed or --allow-run not granted) — skipping repository lint check",
      );
      return;
    }
    throw err;
  }
  if (!result.success) {
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(
      `markdownlint-cli2 failed:\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
});

// Concurrency cancellation (Issue #139). Without a concurrency group, rapid
// pushes to the same ref queue redundant, overlapping runs that each hold a
// runner. A top-level concurrency block keyed on workflow + ref with
// cancel-in-progress leaves only the latest run for a given ref alive,
// mirroring the canonical pattern already proven in ci.yml.
Deno.test("Markdown Lint workflow declares a concurrency group that cancels superseded runs", async () => {
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
