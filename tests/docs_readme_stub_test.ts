// Tests for the docs/README.md stub (Issue #758).
//
// docs/README.md used to be a stale, duplicate dashboard README that
// contradicted the source-of-truth root README.md on the tool's central
// invariant (it validates a settled "90-Day Actual" move, never a live
// "current price") and on fail-loud missing-data handling. It also carried a
// stale market-CSV schema. To stop the two copies drifting apart, docs/README.md
// is reduced to a one-line stub that points at the root README.md as the single
// source of truth.
//
// These tests assert the stub stays small and stays a pointer, and that the
// contradicting prose does not creep back in.

import { assert } from "@std/assert";

const DOCS_README = "docs/README.md";

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

Deno.test("docs/README.md is a small stub, not a duplicate dashboard README", async () => {
  const text = await readText(DOCS_README);
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  assert(
    lines.length <= 6,
    `docs/README.md must be a short stub (<=6 non-blank lines), found ${lines.length}`,
  );
});

Deno.test("docs/README.md points to the root README as the single source of truth", async () => {
  const text = await readText(DOCS_README);
  assert(
    /\.\.\/README\.md/.test(text),
    "docs/README.md must link to ../README.md as the source of truth",
  );
  assert(
    /source of truth/i.test(text),
    "docs/README.md must name the root README as the single source of truth",
  );
});

Deno.test("docs/README.md does not contradict the root README", async () => {
  const text = await readText(DOCS_README);
  // Phrases that made the old duplicate contradict the source of truth.
  const forbidden = [
    "current price", // tool never shows a live/current price (#683, #539, #542)
    "current prices",
    "No data available yet", // replaced by the loud .market-data-error state
    "Tracks real market performance since prediction date",
    "date, ticker, high, low, open, close", // stale CSV schema (missing volume, split_coefficient)
  ];
  for (const phrase of forbidden) {
    assert(
      !text.toLowerCase().includes(phrase.toLowerCase()),
      `docs/README.md must not reintroduce contradicting prose: "${phrase}"`,
    );
  }
});
