// Tests for the Semgrep SAST GitHub Actions workflow (Issue #21).
//
// Verify the workflow file exists, parses as YAML, declares the expected
// pull_request trigger, declares read-only contents permission, defines a
// `semgrep` job that runs in the semgrep/semgrep container and invokes
// `semgrep ci`, and pins third-party actions to 40-character commit SHAs
// to satisfy the supply-chain rule.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/semgrep.yml";

Deno.test("Semgrep workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("Semgrep workflow parses as valid YAML with expected name", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "Semgrep");
});

Deno.test("Semgrep workflow triggers on pull_request", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  // YAML "on" key sometimes parses to boolean true — accept either key.
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "must trigger on pull_request");
});

Deno.test("Semgrep workflow declares read-only contents permission", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { permissions?: Record<string, string> };
  assert(doc.permissions, "workflow must declare top-level permissions");
  assertEquals(doc.permissions.contents, "read");
});

Deno.test("Semgrep workflow defines semgrep job that runs `semgrep ci`", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, unknown> };
  assert(doc.jobs, "workflow must declare jobs");
  assert(doc.jobs.semgrep, "semgrep job must exist");
  const job = doc.jobs.semgrep as {
    "runs-on": string;
    container?: { image?: string } | string;
    steps: Array<{ run?: string; uses?: string }>;
  };
  assertEquals(job["runs-on"], "ubuntu-latest");
  const containerImage = typeof job.container === "string"
    ? job.container
    : job.container?.image;
  assert(
    typeof containerImage === "string" &&
      containerImage.startsWith("semgrep/semgrep"),
    "job must run in the semgrep/semgrep container",
  );
  assert(Array.isArray(job.steps) && job.steps.length > 0, "job needs steps");
  const runs = job.steps.map((s) => s.run ?? "").join("\n");
  assert(/semgrep\s+ci/.test(runs), "semgrep job must run `semgrep ci`");
});

Deno.test("Semgrep workflow pins the container image to a sha256 digest", async () => {
  // Supply-chain rule (Issue #72): the third-party semgrep/semgrep container
  // must be pinned to an immutable @sha256: digest, not a mutable tag.
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs: Record<string, unknown> };
  const job = doc.jobs.semgrep as {
    container?: { image?: string } | string;
  };
  const containerImage = typeof job.container === "string"
    ? job.container
    : job.container?.image;
  assert(
    typeof containerImage === "string",
    "semgrep job must declare a container image",
  );
  assert(
    /@sha256:[0-9a-f]{64}$/.test(containerImage),
    `container image must be pinned to a sha256 digest: ${containerImage}`,
  );
});

Deno.test("Semgrep workflow pins actions to commit SHAs", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  // Supply-chain rule: every `uses:` must reference a 40-char SHA, not a
  // floating tag like @stable or @v4.
  const usesLines = text.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    assert(
      /@[0-9a-f]{40}\s*$/.test(line.trim()),
      `action not pinned to 40-char SHA: ${line.trim()}`,
    );
  }
});

// Concurrency cancellation (Issue #139). Without a concurrency group, rapid
// pushes to the same ref queue redundant, overlapping runs that each hold a
// runner. A top-level concurrency block keyed on workflow + ref with
// cancel-in-progress leaves only the latest run for a given ref alive,
// mirroring the canonical pattern already proven in ci.yml.
Deno.test("Semgrep workflow declares a concurrency group that cancels superseded runs", async () => {
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
