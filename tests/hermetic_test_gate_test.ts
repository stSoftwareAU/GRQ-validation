// Wiring tests for the hermetic-test gate (Issue #804).
//
// The four market-data/dividend integration tests used to read — and in two
// cases write — the operator's private data checkout, and skipped silently
// everywhere else. `scripts/check_hermetic_tests.sh` is the gate that keeps
// them synthetic: it runs them with no data root configured and fails on a
// skip, a private-tree reference, or a dirtied working tree. These tests assert
// the gate exists and that CI actually runs it, so the guarantee is enforced by
// the build rather than by reviewer memory.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const GATE_SCRIPT = "scripts/check_hermetic_tests.sh";
const WORKFLOW_PATH = ".github/workflows/ci.yml";

// The markers the gate greps for, split so this file — which lives under
// `tests/` — never matches the very grep it is describing.
const PRIVATE_TREE_MARKERS = [
  "GRQ-share" + "prices",
  "GRQ-divid" + "ends",
  "MARKET_DATA_BASE" + "_PATH",
  "DIVIDEND_DATA_BASE" + "_PATH",
];

type WorkflowStep = { name?: string; run?: string; uses?: string };
type Workflow = {
  jobs: Record<string, { steps?: WorkflowStep[] }>;
};

async function readWorkflow(): Promise<Workflow> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  return parseYaml(text) as Workflow;
}

Deno.test("hermetic-test gate script exists and is executable", async () => {
  const stat = await Deno.stat(GATE_SCRIPT);
  assert(stat.isFile, `${GATE_SCRIPT} should be a file`);
  // Owner-execute bit, so CI and quality.sh can invoke it directly.
  assert(
    (stat.mode ?? 0) & 0o100,
    `${GATE_SCRIPT} should be executable`,
  );
});

Deno.test("hermetic-test gate rejects every private data-tree marker", async () => {
  const script = await Deno.readTextFile(GATE_SCRIPT);
  for (const marker of PRIVATE_TREE_MARKERS) {
    assert(
      script.includes(marker),
      `${GATE_SCRIPT} should reject the ${marker} marker`,
    );
  }
});

Deno.test("hermetic-test gate checks the tests left the working tree clean", async () => {
  const script = await Deno.readTextFile(GATE_SCRIPT);
  assert(
    script.includes("git status --porcelain"),
    `${GATE_SCRIPT} should compare git status before and after the test run`,
  );
});

Deno.test("CI runs the hermetic-test gate in the Rust test job", async () => {
  const workflow = await readWorkflow();
  const steps = workflow.jobs?.test?.steps ?? [];
  const gateSteps = steps.filter((step) =>
    (step.run ?? "").includes(GATE_SCRIPT)
  );
  assertEquals(
    gateSteps.length,
    1,
    `the ci.yml test job should run ${GATE_SCRIPT} exactly once`,
  );
});
