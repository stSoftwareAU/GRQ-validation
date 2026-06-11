// Tests for the SECURITY.md supply-chain readiness runbook (Issue #52,
// refined in Issue #81).
//
// Verify the repository publishes a root SECURITY.md. This is the SCR-RUNBOOK
// posture/readiness gap: the file must exist so reporters know where to find
// the disclosure contact and the emergency dependency-bump procedure.
//
// The earlier substring greps (disclosure email, deno.json/deno.lock/deno
// test, cargo update/audit/test) were removed in Issue #81: they asserted on
// documentation prose rather than behaviour, broke on harmless rewording, and
// duplicated implementation detail. The contents of the runbook are policed by
// the Markdown linter and human review, not by string asserts in the unit-test
// runner.

import { assert } from "@std/assert";

const SECURITY_PATH = "SECURITY.md";

Deno.test("SECURITY.md exists at the repository root", async () => {
  const stat = await Deno.stat(SECURITY_PATH);
  assert(stat.isFile, `${SECURITY_PATH} should be a file`);
});
