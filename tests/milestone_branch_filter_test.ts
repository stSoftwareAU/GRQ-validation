// Every quality gate must run on milestone integration PRs (Issue #788).
//
// Milestone sub-issue PRs target a shared `milestone/<slug>` branch. Nine
// test/lint/scan workflows filtered their `pull_request` trigger with
// `branches: ["*"]`, and a GitHub Actions `*` wildcard does not match `/` —
// so gitleaks, semgrep, dependency review, the Cargo/Deno audits, the
// quarantine gate and every lint gate silently skipped those PRs. The gap
// only surfaced on the oversized rollup PR into `main`.
//
// These tests load each workflow and evaluate its real `branches:` filter
// against a representative milestone branch name using the shared
// `branchFilterMatches` helper (the same glob semantics GitHub applies), so
// they assert the outcome — does this gate run? — rather than the spelling of
// the filter.

import { assert, assertFalse } from "@std/assert";
import {
  branchFilterMatches,
  loadWorkflow,
  triggerBranches,
} from "./workflow_assertions.ts";

/** Quality gates that must run on every pull request, whatever the base. */
const GATE_WORKFLOWS = [
  "a11y",
  "actionlint",
  "bump-quarantine-gate",
  "cargo-audit",
  "ci",
  "deno-quality",
  "dependency-review",
  "gitleaks",
  "markdown-lint",
  "semgrep",
  "shellcheck",
];

const MILESTONE_BRANCH = "milestone/star-filter-controls";

for (const name of GATE_WORKFLOWS) {
  Deno.test(`${name} workflow runs on pull requests into a milestone branch`, async () => {
    const { doc } = await loadWorkflow(`.github/workflows/${name}.yml`);
    const branches = triggerBranches(doc, "pull_request");
    assert(branches !== null, `${name}.yml must trigger on pull_request`);
    assert(
      branchFilterMatches(branches, MILESTONE_BRANCH),
      `${name}.yml pull_request filter ${
        JSON.stringify(branches)
      } does not match ${MILESTONE_BRANCH} — the gate would be skipped`,
    );
  });

  Deno.test(`${name} workflow still runs on pull requests into main`, async () => {
    const { doc } = await loadWorkflow(`.github/workflows/${name}.yml`);
    const branches = triggerBranches(doc, "pull_request");
    assert(branches !== null, `${name}.yml must trigger on pull_request`);
    assert(
      branchFilterMatches(branches, "main"),
      `${name}.yml must keep running on PRs into main`,
    );
  });
}

// No scope creep: version-bump.yml deliberately targets `main` only, because
// it pushes a version-bump commit that belongs on the rollup PR rather than on
// every milestone sub-issue PR (Issue #323).
Deno.test("version-bump workflow stays main-only", async () => {
  const { doc } = await loadWorkflow(".github/workflows/version-bump.yml");
  const branches = triggerBranches(doc, "pull_request");
  assert(branches !== null, "version-bump.yml must trigger on pull_request");
  assert(branchFilterMatches(branches, "main"));
  assertFalse(branchFilterMatches(branches, MILESTONE_BRANCH));
});
