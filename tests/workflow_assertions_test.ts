// Unit tests for the shared workflow assertions helper (Issue #202).
//
// These exercise the real helper functions with synthetic inputs to prove the
// structured matchers behave as intended — in particular that `invokesTool`
// tolerates the behaviour-preserving edits (flag reordering, line
// continuation, extra flags) that previously broke the source-text greps,
// while still failing when the tool is genuinely absent.

import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import {
  assertActionsPinnedToSha,
  branchFilterMatches,
  commandSegments,
  invokesTool,
  stepIndexInvoking,
  stepIndexUsing,
  triggerBranches,
  type Workflow,
  workflowSteps,
  workflowTriggers,
} from "./workflow_assertions.ts";

Deno.test("commandSegments joins line continuations and splits separators", () => {
  const script = "deno run --allow-read \\\n  helpers/gate.ts; echo done && ls";
  assertEquals(commandSegments(script), [
    "deno run --allow-read helpers/gate.ts",
    "echo done",
    "ls",
  ]);
});

Deno.test("commandSegments drops blank lines", () => {
  assertEquals(commandSegments("\n\n  \n"), []);
});

Deno.test("invokesTool matches a bare tool invocation", () => {
  const steps = [{ run: "deno lint" }];
  assert(invokesTool(steps, "deno", { subcommand: "lint" }));
});

Deno.test("invokesTool tolerates flag reordering and extra flags", () => {
  // `--check` before the subcommand operand still counts; a source-text grep
  // for `deno fmt --check` would have failed here.
  const steps = [{ run: "deno fmt --config deno.json --check src/" }];
  assert(invokesTool(steps, "deno", { subcommand: "fmt", args: ["--check"] }));
});

Deno.test("invokesTool matches name=value flags by name", () => {
  const steps = [{
    run: "deno test --allow-read --coverage=cov_profile tests/*.ts",
  }];
  assert(
    invokesTool(steps, "deno", { subcommand: "test", args: ["--coverage"] }),
  );
});

Deno.test("invokesTool follows line continuations across a step", () => {
  const steps = [{
    run:
      "deno run --allow-read --allow-net \\\n  helpers/bump_quarantine_gate.ts origin/main",
  }];
  assert(
    invokesTool(steps, "deno", {
      subcommand: "run",
      args: ["helpers/bump_quarantine_gate.ts", "--allow-net"],
    }),
  );
});

Deno.test("invokesTool detects a tool invoked via npx", () => {
  const steps = [{ run: "npx pa11y-ci --config pa11yci.json" }];
  assert(invokesTool(steps, "pa11y-ci"));
});

Deno.test("invokesTool returns false when the tool is absent", () => {
  const steps = [{ run: "deno lint" }];
  assertFalse(invokesTool(steps, "cargo"));
});

Deno.test("invokesTool returns false on subcommand mismatch", () => {
  const steps = [{ run: "deno fmt --check" }];
  assertFalse(invokesTool(steps, "deno", { subcommand: "lint" }));
});

Deno.test("invokesTool returns false when a required arg is missing", () => {
  const steps = [{ run: "deno test tests/*.ts" }];
  assertFalse(
    invokesTool(steps, "deno", { subcommand: "test", args: ["--coverage"] }),
  );
});

Deno.test("invokesTool checks each step independently", () => {
  // A tool in one step and its subcommand in another must not cross-match.
  const steps = [{ run: "cargo build" }, { run: "audit something" }];
  assertFalse(invokesTool(steps, "cargo", { subcommand: "audit" }));
});

Deno.test("stepIndexInvoking returns the matching step index", () => {
  const steps = [
    { run: "echo hi" },
    { run: "cargo cyclonedx --format json" },
    { run: "echo bye" },
  ];
  assertEquals(
    stepIndexInvoking(steps, "cargo", { subcommand: "cyclonedx" }),
    1,
  );
  assertEquals(stepIndexInvoking(steps, "cargo", { subcommand: "audit" }), -1);
});

Deno.test("stepIndexUsing finds an action by ref prefix", () => {
  const steps = [
    { uses: "actions/checkout@abc" },
    { uses: "actions/upload-artifact@def" },
  ];
  assertEquals(stepIndexUsing(steps, "actions/upload-artifact@"), 1);
  assertEquals(stepIndexUsing(steps, "codecov/"), -1);
});

Deno.test("workflowSteps collects all steps or a single job's steps", () => {
  const doc: Workflow = {
    jobs: {
      a: { steps: [{ run: "one" }] },
      b: { steps: [{ run: "two" }, { run: "three" }] },
    },
  };
  assertEquals(workflowSteps(doc).length, 3);
  assertEquals(workflowSteps(doc, "b").length, 2);
  assertEquals(workflowSteps(doc, "missing"), []);
});

Deno.test("workflowTriggers accepts the YAML boolean-true `on` key", () => {
  const truthy = { true: { pull_request: {} } } as unknown as Workflow;
  const triggers = workflowTriggers(truthy);
  assert(triggers && "pull_request" in triggers);
});

Deno.test("assertActionsPinnedToSha passes for 40-char SHAs", () => {
  const text = [
    "      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10",
    "      - uses: denoland/setup-deno@667a34cdef165d8d2b2e98dde39547c9daac7282",
  ].join("\n");
  assertActionsPinnedToSha(text);
});

Deno.test("assertActionsPinnedToSha throws on a floating tag", () => {
  const text = "      - uses: actions/checkout@v4";
  assertThrows(
    () => assertActionsPinnedToSha(text),
    Error,
    "not pinned",
  );
});

Deno.test("assertActionsPinnedToSha throws when no actions are present", () => {
  assertThrows(
    () => assertActionsPinnedToSha("name: no actions here\n"),
    Error,
    "at least one action",
  );
});

// Branch-filter semantics (Issue #788). GitHub Actions filter patterns treat
// `*` as "any character except `/`", so a `branches: ["*"]` filter silently
// skips every pull request whose base is `milestone/<slug>`. These exercise
// the real matcher with synthetic filters.
Deno.test("branchFilterMatches treats an absent filter as every branch", () => {
  assert(branchFilterMatches(undefined, "milestone/star-filter"));
  assert(branchFilterMatches(undefined, "main"));
});

Deno.test("branchFilterMatches: `*` does not match a slash", () => {
  assert(branchFilterMatches(["*"], "main"));
  assertFalse(branchFilterMatches(["*"], "milestone/star-filter"));
});

Deno.test("branchFilterMatches: `**` matches across slashes", () => {
  assert(branchFilterMatches(["milestone/**"], "milestone/star-filter"));
  assert(branchFilterMatches(["milestone/**"], "milestone/a/b"));
  assertFalse(branchFilterMatches(["milestone/**"], "main"));
});

Deno.test("branchFilterMatches: single-level glob stops at a nested slash", () => {
  assert(branchFilterMatches(["milestone/*"], "milestone/star-filter"));
  assertFalse(branchFilterMatches(["milestone/*"], "milestone/a/b"));
});

Deno.test("branchFilterMatches honours exclusion patterns", () => {
  assertFalse(branchFilterMatches(["**", "!milestone/**"], "milestone/x"));
  assert(branchFilterMatches(["**", "!milestone/**"], "main"));
});

Deno.test("branchFilterMatches treats dots and dashes literally", () => {
  assert(branchFilterMatches(["release-1.2"], "release-1.2"));
  assertFalse(branchFilterMatches(["release-1.2"], "release-1x2"));
});

Deno.test("triggerBranches reports absent, unfiltered and filtered triggers", () => {
  const doc = {
    on: { pull_request: { branches: ["main"] }, push: null },
  } as unknown as Workflow;
  assertEquals(triggerBranches(doc, "pull_request"), ["main"]);
  assertEquals(triggerBranches(doc, "push"), undefined);
  assertEquals(triggerBranches(doc, "schedule"), null);
});
