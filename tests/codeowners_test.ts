// Tests for the repository CODEOWNERS governance file (Issue #74).
//
// This repository runs privileged workflows — the deploy-pages job grants
// id-token: write, and several workflows consume non-GITHUB_TOKEN secrets
// (SEMGREP_APP_TOKEN, CODECOV_TOKEN, GITLEAKS_LICENSE, ACTIONS_PUSH). Without a
// CODEOWNERS rule guarding `.github/workflows/`, a single self-approving account
// could quietly alter a workflow that runs with those secrets — the tj-actions /
// OIDC-theft attack shape. These tests verify the repo ships a CODEOWNERS file at
// a GitHub-recognised location that puts a named owner on the privileged surface.

import { assert } from "@std/assert";

// GitHub recognises CODEOWNERS at exactly these three locations.
const CODEOWNERS_LOCATIONS = [
  "CODEOWNERS",
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
];

interface CodeownersRule {
  pattern: string;
  owners: string[];
}

/** Locate the CODEOWNERS file in one of GitHub's recognised locations. */
async function findCodeownersPath(): Promise<string | null> {
  for (const path of CODEOWNERS_LOCATIONS) {
    try {
      const stat = await Deno.stat(path);
      if (stat.isFile) return path;
    } catch {
      // Not present at this location; keep looking.
    }
  }
  return null;
}

/** Parse CODEOWNERS text into pattern → owners rules, skipping comments/blanks. */
function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const [pattern, ...owners] = line.split(/\s+/);
    rules.push({ pattern, owners });
  }
  return rules;
}

/** True when `pattern` is the catch-all default rule. */
function isDefaultPattern(pattern: string): boolean {
  return pattern === "*";
}

/** True when `pattern` guards the given directory path. */
function coversDirectory(pattern: string, dir: string): boolean {
  const normalised = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  const target = dir.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalised === target;
}

// A valid GitHub owner is a @user or a @org/team handle.
const OWNER_RE =
  /^@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9._-]+)?$/;

async function loadRules(): Promise<CodeownersRule[]> {
  const path = await findCodeownersPath();
  assert(
    path !== null,
    `No CODEOWNERS file found in any of: ${CODEOWNERS_LOCATIONS.join(", ")}`,
  );
  const text = await Deno.readTextFile(path);
  return parseCodeowners(text);
}

Deno.test("CODEOWNERS exists at a GitHub-recognised location", async () => {
  const path = await findCodeownersPath();
  assert(
    path !== null,
    `CODEOWNERS must exist at one of: ${CODEOWNERS_LOCATIONS.join(", ")}`,
  );
});

Deno.test("CODEOWNERS defines a default owner for the whole repository", async () => {
  const rules = await loadRules();
  const def = rules.find((r) => isDefaultPattern(r.pattern));
  assert(def !== undefined, "CODEOWNERS must define a default `*` rule");
  assert(
    def.owners.length > 0,
    "the default `*` rule must name at least one owner",
  );
});

Deno.test("CODEOWNERS guards the privileged .github/workflows/ surface", async () => {
  const rules = await loadRules();
  const rule = rules.find((r) =>
    coversDirectory(r.pattern, ".github/workflows")
  );
  assert(
    rule !== undefined,
    "CODEOWNERS must include a rule covering /.github/workflows/",
  );
  assert(
    rule.owners.length > 0,
    "the /.github/workflows/ rule must name at least one owner",
  );
});

Deno.test("CODEOWNERS guards the .github/actions/ surface", async () => {
  const rules = await loadRules();
  const rule = rules.find((r) => coversDirectory(r.pattern, ".github/actions"));
  assert(
    rule !== undefined,
    "CODEOWNERS must include a rule covering /.github/actions/",
  );
  assert(
    rule.owners.length > 0,
    "the /.github/actions/ rule must name at least one owner",
  );
});

Deno.test("CODEOWNERS owners are syntactically valid GitHub handles", async () => {
  const rules = await loadRules();
  for (const rule of rules) {
    for (const owner of rule.owners) {
      assert(
        OWNER_RE.test(owner),
        `invalid owner handle "${owner}" for pattern "${rule.pattern}"`,
      );
    }
  }
});
