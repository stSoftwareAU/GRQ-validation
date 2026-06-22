// Tests for the declared branch-protection and commit-signing governance
// descriptor (Issue #180).
//
// Branch-protection rules and commit-signature requirements are repository
// settings that do not live in the committed tree, so a static scan cannot
// confirm them and flags them as a gap (finding BP-c6a4162e1eed). This repo
// also pushes daily score data straight to `main` under the automated
// `scorer 3` identity, so a blanket "require a reviewed PR for every commit"
// rule is a deliberately relaxed control rather than an oversight.
//
// `.github/branch-protection.json` is the static, machine-readable record of
// the intended controls AND the deliberately relaxed ones, so future scans can
// treat the posture as documented. These tests parse that descriptor and
// assert on its structure — the same parse-and-assert pattern used by
// codeowners_test.ts and dependabot_config_test.ts, not the fragile prose
// greps removed under Issues #81 and #149.

import { assert, assertEquals } from "@std/assert";

const DESCRIPTOR_PATH = ".github/branch-protection.json";

// Controls the descriptor must declare as the intended posture for `main`.
const REQUIRED_CONTROLS = [
  "require_pull_request",
  "require_code_owner_reviews",
  "block_force_pushes",
  "block_deletions",
  "require_linear_history",
  "require_signed_commits",
] as const;

interface Relaxation {
  control: string;
  identities: string[];
  reason: string;
  scope?: string;
}

interface MilestoneRuleset {
  branch_pattern: string;
  required_status_checks: string[];
  require_branches_up_to_date: boolean;
  enforcement: string;
}

interface Descriptor {
  default_branch: string;
  intended_controls: Record<string, boolean>;
  required_approving_review_count: number;
  enforcement: string;
  accepted_relaxations: Relaxation[];
  milestone_ruleset: MilestoneRuleset;
}

async function loadDescriptor(): Promise<Descriptor> {
  const text = await Deno.readTextFile(DESCRIPTOR_PATH);
  return JSON.parse(text) as Descriptor;
}

Deno.test("branch-protection descriptor exists and is valid JSON", async () => {
  const stat = await Deno.stat(DESCRIPTOR_PATH);
  assert(stat.isFile, `${DESCRIPTOR_PATH} should be a file`);
  const descriptor = await loadDescriptor();
  assert(
    typeof descriptor === "object" && descriptor !== null,
    "descriptor must parse to an object",
  );
});

Deno.test("descriptor targets the default branch", async () => {
  const descriptor = await loadDescriptor();
  assertEquals(
    descriptor.default_branch,
    "main",
    "descriptor must target the `main` default branch",
  );
});

Deno.test("descriptor declares every required control as enabled", async () => {
  const descriptor = await loadDescriptor();
  for (const control of REQUIRED_CONTROLS) {
    assertEquals(
      descriptor.intended_controls[control],
      true,
      `intended_controls.${control} must be declared true`,
    );
  }
});

Deno.test("descriptor requires at least one approving review", async () => {
  const descriptor = await loadDescriptor();
  assert(
    typeof descriptor.required_approving_review_count === "number" &&
      descriptor.required_approving_review_count >= 1,
    "required_approving_review_count must be a number >= 1",
  );
});

Deno.test("descriptor records how the controls are enforced", async () => {
  const descriptor = await loadDescriptor();
  assert(
    typeof descriptor.enforcement === "string" &&
      descriptor.enforcement.trim().length > 0,
    "enforcement must be a non-empty string explaining who applies the rules",
  );
});

Deno.test("descriptor documents the deliberately relaxed controls", async () => {
  const descriptor = await loadDescriptor();
  assert(
    Array.isArray(descriptor.accepted_relaxations) &&
      descriptor.accepted_relaxations.length > 0,
    "accepted_relaxations must list at least one documented exception",
  );
  for (const relaxation of descriptor.accepted_relaxations) {
    assert(
      typeof relaxation.control === "string" &&
        relaxation.control.length > 0,
      "each relaxation must name the control it relaxes",
    );
    assert(
      Array.isArray(relaxation.identities) && relaxation.identities.length > 0,
      `relaxation of ${relaxation.control} must name at least one identity`,
    );
    assert(
      typeof relaxation.reason === "string" &&
        relaxation.reason.trim().length > 0,
      `relaxation of ${relaxation.control} must give a non-empty reason`,
    );
  }
});

Deno.test("every relaxation references a declared control", async () => {
  const descriptor = await loadDescriptor();
  const known = new Set(Object.keys(descriptor.intended_controls));
  for (const relaxation of descriptor.accepted_relaxations) {
    assert(
      known.has(relaxation.control),
      `relaxation control "${relaxation.control}" must match a key in intended_controls`,
    );
  }
});

// Milestone integration branches require the Rust gate (Issue #342). Like the
// `main` controls above, the milestone ruleset is a repository setting applied
// out-of-band by an admin; this descriptor records the intended posture so the
// gap is documented rather than undetected.
Deno.test("descriptor declares the milestone ruleset posture", async () => {
  const descriptor = await loadDescriptor();
  const ruleset = descriptor.milestone_ruleset;
  assert(ruleset, "descriptor must declare a milestone_ruleset block");
  assertEquals(
    ruleset.branch_pattern,
    "milestone/**",
    "milestone ruleset must target the `milestone/**` pattern",
  );
});

Deno.test("milestone ruleset requires the Rust status check", async () => {
  const descriptor = await loadDescriptor();
  const checks = descriptor.milestone_ruleset.required_status_checks;
  assert(
    Array.isArray(checks) && checks.includes("Test and Quality Checks"),
    "milestone ruleset must require the `Test and Quality Checks` status check",
  );
});

Deno.test("milestone ruleset requires up-to-date branches", async () => {
  const descriptor = await loadDescriptor();
  assertEquals(
    descriptor.milestone_ruleset.require_branches_up_to_date,
    true,
    "milestone ruleset must require branches to be up to date before merging",
  );
});

Deno.test("milestone ruleset records how it is enforced", async () => {
  const descriptor = await loadDescriptor();
  assert(
    typeof descriptor.milestone_ruleset.enforcement === "string" &&
      descriptor.milestone_ruleset.enforcement.trim().length > 0,
    "milestone ruleset must record a non-empty enforcement note",
  );
});

Deno.test("the direct-push relaxation covers the automated score committer", async () => {
  const descriptor = await loadDescriptor();
  const prRelaxation = descriptor.accepted_relaxations.find(
    (r) => r.control === "require_pull_request",
  );
  assert(
    prRelaxation !== undefined,
    "the require_pull_request relaxation for direct data pushes must be recorded",
  );
  assert(
    prRelaxation.identities.some((id) => id.includes("scorer")),
    "the direct-push relaxation must name the automated scorer identity",
  );
});
