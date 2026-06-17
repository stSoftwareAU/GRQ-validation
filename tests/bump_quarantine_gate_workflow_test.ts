// Tests for the Dependency Quarantine Gate workflow (Issue #193).
//
// Verify the CI gate that backs the Dependabot cooldown for the Cargo and
// GitHub Actions ecosystems exists, parses as YAML, runs on pull requests,
// invokes helpers/bump_quarantine_gate.ts with a 24h quarantine window, and
// pins third-party actions to 40-character commit SHAs.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/bump-quarantine-gate.yml";

interface Step {
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

async function loadWorkflow() {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return { text, doc: parseYaml(text) as Record<string, unknown> };
}

Deno.test("quarantine gate workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("quarantine gate workflow triggers on pull_request", async () => {
  const { doc } = await loadWorkflow();
  // YAML parses the bare `on` key to boolean true.
  const on = (doc.on ?? doc["true"] ??
    (doc as Record<string, unknown>)[true as unknown as string]) as
      | Record<string, unknown>
      | undefined;
  assert(on, "workflow must declare an 'on' trigger");
  assert("pull_request" in on, "gate must run on pull_request");
});

Deno.test("quarantine gate runs the gate script with a 24h window", async () => {
  const { doc } = await loadWorkflow();
  const jobs = doc.jobs as Record<
    string,
    { env?: Record<string, string>; steps?: Step[] }
  >;
  const job = jobs.quarantine;
  assert(job, "workflow must define a quarantine job");

  const runs = (job.steps ?? []).map((s) => s.run ?? "").join("\n");
  assert(
    /deno\s+run[\s\S]*helpers\/bump_quarantine_gate\.ts/.test(runs),
    "job must invoke helpers/bump_quarantine_gate.ts",
  );

  // The 24h window must be configured (env value or VIBE_BUMP_QUARANTINE_HOURS).
  const envWindow = job.env?.["VIBE_BUMP_QUARANTINE_HOURS"];
  assertEquals(
    String(envWindow),
    "24",
    "gate must enforce a 24h VIBE_BUMP_QUARANTINE_HOURS window",
  );
});

Deno.test("quarantine gate grants the script the permissions it needs", async () => {
  const { doc } = await loadWorkflow();
  const jobs = doc.jobs as Record<string, { steps?: Step[] }>;
  const runs = (jobs.quarantine.steps ?? []).map((s) => s.run ?? "").join("\n");
  for (
    const flag of ["--allow-read", "--allow-net", "--allow-run", "--allow-env"]
  ) {
    assert(runs.includes(flag), `gate run step must pass ${flag}`);
  }
});

Deno.test("quarantine gate workflow pins actions to commit SHAs", async () => {
  const { text } = await loadWorkflow();
  const usesLines = text.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    assert(
      /@[0-9a-f]{40}\s*$/.test(line.trim()),
      `action not pinned to 40-char SHA: ${line.trim()}`,
    );
  }
});
