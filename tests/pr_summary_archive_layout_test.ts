// Tests for consolidating the loose docs/pr-summary-20..27 files into the
// durable PR-summary archive (Issue #760).
//
// Eight PR-summary files (pr-summary-20.md … pr-summary-27.md) sat loose in
// docs/ instead of in docs/archive/pr-summaries/, where the other 250+
// summaries already live. Each documents the addition of one CI/CD workflow —
// Gitleaks (#20), Semgrep (#21), Dependency Review (#22), Markdown Lint (#23),
// Cargo Audit (#24), Deno Outdated (#25), Deno Quality (#26) and ShellCheck
// (#27). Their durable learnings are already reflected in the README's
// "CI/CD Pipeline → Workflows" list, so the files were MOVED (not deleted) into
// the archive to keep the project's cross-machine memory in one place without
// losing any learning (including the "requires the GITLEAKS_LICENSE secret"
// caveat in #20).
//
// These assertions read the REAL committed tree so a future edit cannot
// silently scatter a summary back into docs/ root.

import { assert } from "@std/assert";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

// The eight summaries relocated by #760, keyed by the PR/issue they document.
const RELOCATED_SUMMARIES = [
  "pr-summary-20.md",
  "pr-summary-21.md",
  "pr-summary-22.md",
  "pr-summary-23.md",
  "pr-summary-24.md",
  "pr-summary-25.md",
  "pr-summary-26.md",
  "pr-summary-27.md",
];

const ARCHIVE_DIR = "docs/archive/pr-summaries";

Deno.test("relocated PR summaries no longer sit loose in docs/ root (#760)", async () => {
  for (const name of RELOCATED_SUMMARIES) {
    assert(
      !(await exists(`docs/${name}`)),
      `docs/${name} must not remain loose in docs/ — it belongs in ` +
        `${ARCHIVE_DIR}/`,
    );
  }
});

Deno.test("relocated PR summaries live in the archive (#760)", async () => {
  for (const name of RELOCATED_SUMMARIES) {
    const path = `${ARCHIVE_DIR}/${name}`;
    assert(
      (await exists(path)) && (await Deno.stat(path)).isFile,
      `${path} must exist — the summary was moved here, not deleted`,
    );
  }
});

Deno.test("moved summaries retain their durable learnings (#760)", async () => {
  // Spot-check that content survived the move: the GITLEAKS_LICENSE caveat the
  // issue explicitly flags as a learning that must not be lost, and each file's
  // "Closes #NN" reference proving it is the genuine summary, not a stub.
  const gitleaks = await Deno.readTextFile(`${ARCHIVE_DIR}/pr-summary-20.md`);
  assert(
    gitleaks.includes("GITLEAKS_LICENSE"),
    "pr-summary-20.md must retain the GITLEAKS_LICENSE caveat",
  );

  for (let i = 0; i < RELOCATED_SUMMARIES.length; i++) {
    const name = RELOCATED_SUMMARIES[i];
    // Collapse whitespace so a line-wrapped "Closes\n#21" still matches.
    const text = (await Deno.readTextFile(`${ARCHIVE_DIR}/${name}`))
      .replace(/\s+/g, " ");
    assert(
      text.includes(`Closes #${20 + i}`),
      `${name} must retain its "Closes #${20 + i}" reference`,
    );
  }
});
