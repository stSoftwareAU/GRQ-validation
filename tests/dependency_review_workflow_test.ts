// Tests for the Dependency Review GitHub Actions workflow (Issue #65).
//
// Supply-chain hardening: actions in dependency-review.yml must be pinned to
// 40-character commit SHAs rather than mutable tags (e.g. @v4), matching the
// convention already used by the repo's other workflows.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { assertActionsPinnedToSha } from "./workflow_assertions.ts";

const WORKFLOW_PATH = ".github/workflows/dependency-review.yml";

Deno.test("Dependency Review workflow file exists", async () => {
  const stat = await Deno.stat(WORKFLOW_PATH);
  assert(stat.isFile, `${WORKFLOW_PATH} should be a file`);
});

Deno.test("Dependency Review workflow parses as valid YAML", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "Dependency Review");
});

Deno.test("Dependency Review workflow pins every action to a 40-char commit SHA", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  assertActionsPinnedToSha(text);
});

// Note: the "readable version comment above each pinned action" convention is
// deliberately NOT asserted here (Issue #86). It was a raw source-text /
// string-adjacency check on the YAML layout, not behaviour: moving the
// annotation inline (`uses: x@sha # x@tag`), reformatting, or blank-lining
// between the comment and `uses:` would break the test while the workflow
// behaves identically. The genuine supply-chain guard — SHA pinning — is
// enforced by the parsed "pins every action to a 40-char commit SHA" test
// above. The annotation convention, if wanted, belongs in a dedicated
// lint/actionlint rule rather than a unit assertion.

// Concurrency cancellation (Issue #139). Without a concurrency group, rapid
// pushes to the same ref queue redundant, overlapping runs that each hold a
// runner. A top-level concurrency block keyed on workflow + ref with
// cancel-in-progress leaves only the latest run for a given ref alive,
// mirroring the canonical pattern already proven in ci.yml.
Deno.test("Dependency Review workflow declares a concurrency group that cancels superseded runs", async () => {
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
