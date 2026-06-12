// Tests for the Markdown Lint GitHub Actions workflow (Issue #23).
//
// These tests verify the workflow file exists, parses as YAML, and contains
// the required steps. They also verify a markdownlint-cli2 config is present
// so the workflow passes against the existing markdown files in this repo.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { parse as parseJsonc } from "@std/jsonc";

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
  assert("push" in on, "must trigger on push");
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

Deno.test("Markdown Lint workflow pins actions to commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  // Each `uses:` line in the workflow must reference a 40-char SHA, not a
  // floating tag like @v4. This matches the supply-chain rule in the guide.
  const usesLines = text.split("\n").filter((l) => /^\s*-\s*uses:/.test(l));
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    assert(
      /@[0-9a-f]{40}\s*$/.test(line.trim()),
      `action not pinned to 40-char SHA: ${line.trim()}`,
    );
  }
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
