// Tests that every job in every GitHub Actions workflow declares an explicit
// `timeout-minutes:` (Issue #71).
//
// Without a per-job timeout, a wedged step falls back to GitHub's 360-minute
// (6-hour) default, holding a runner hostage and burning minutes. Each job
// must bound its worst case with a sensible, positive timeout.

import { assert } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOWS_DIR = ".github/workflows";

// GitHub's implicit default when timeout-minutes is omitted.
const GITHUB_DEFAULT_TIMEOUT = 360;

interface Job {
  "timeout-minutes"?: number;
}

interface Workflow {
  jobs?: Record<string, Job>;
}

async function listWorkflowFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(WORKFLOWS_DIR)) {
    if (
      entry.isFile &&
      (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
    ) {
      files.push(`${WORKFLOWS_DIR}/${entry.name}`);
    }
  }
  return files.sort();
}

async function loadJobs(path: string): Promise<Record<string, Job>> {
  const text = await Deno.readTextFile(path);
  const doc = parseYaml(text) as Workflow;
  return doc.jobs ?? {};
}

Deno.test("at least one workflow file is present", async () => {
  const files = await listWorkflowFiles();
  assert(files.length > 0, "expected workflow files under .github/workflows");
});

Deno.test("every job declares a timeout-minutes", async () => {
  const files = await listWorkflowFiles();
  for (const file of files) {
    const jobs = await loadJobs(file);
    assert(
      Object.keys(jobs).length > 0,
      `${file} must declare at least one job`,
    );
    for (const [name, job] of Object.entries(jobs)) {
      assert(
        typeof job["timeout-minutes"] === "number",
        `${file}: job '${name}' must declare timeout-minutes`,
      );
    }
  }
});

Deno.test("every timeout-minutes is a sane positive bound below the GitHub default", async () => {
  const files = await listWorkflowFiles();
  for (const file of files) {
    const jobs = await loadJobs(file);
    for (const [name, job] of Object.entries(jobs)) {
      const timeout = job["timeout-minutes"];
      assert(
        typeof timeout === "number" &&
          Number.isInteger(timeout) &&
          timeout > 0,
        `${file}: job '${name}' timeout-minutes must be a positive integer`,
      );
      assert(
        (timeout as number) < GITHUB_DEFAULT_TIMEOUT,
        `${file}: job '${name}' timeout-minutes (${timeout}) must be below the ${GITHUB_DEFAULT_TIMEOUT}-minute GitHub default`,
      );
    }
  }
});
