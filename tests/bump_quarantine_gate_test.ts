// Tests for the Cargo & GitHub Actions supply-chain quarantine gate
// (Issue #193).
//
// Dependabot's `cooldown` keyword is an in-preview, non-native age gate. It
// is kept as defence-in-depth, but the Cargo and GitHub Actions ecosystems
// now also have a deterministic CI gate (helpers/bump_quarantine_gate.ts)
// that mirrors the Deno `--minimum-dependency-age` approach: it checks the
// upstream publish timestamp of every *external* bumped dependency against a
// 24h VIBE_BUMP_QUARANTINE_HOURS threshold and fails closed when the age is
// too fresh or cannot be verified. Internal stSoftwareAU/* dependencies
// bypass the quarantine and update immediately.
//
// These tests exercise the pure decision logic with deterministic inputs —
// no network — so they verify behaviour, not implementation text.

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  ageInHours,
  type Bump,
  diffCargoLock,
  evaluateBump,
  evaluateBumps,
  isInternal,
  parseCargoLock,
  parseQuarantineHours,
  parseUses,
  violations,
} from "../helpers/bump_quarantine_gate.ts";

const NOW = "2026-06-18T00:00:00Z";

function bump(partial: Partial<Bump>): Bump {
  return {
    ecosystem: "cargo",
    name: "serde",
    version: "1.0.0",
    publishedAt: null,
    ...partial,
  };
}

// --- parseQuarantineHours -------------------------------------------------

Deno.test("parseQuarantineHours defaults to 24 when unset", () => {
  assertEquals(parseQuarantineHours(undefined), 24);
  assertEquals(parseQuarantineHours(""), 24);
});

Deno.test("parseQuarantineHours reads a positive override", () => {
  assertEquals(parseQuarantineHours("48"), 48);
  assertEquals(parseQuarantineHours("1"), 1);
});

Deno.test("parseQuarantineHours rejects non-positive or non-numeric input", () => {
  assertThrows(() => parseQuarantineHours("0"));
  assertThrows(() => parseQuarantineHours("-5"));
  assertThrows(() => parseQuarantineHours("abc"));
});

// --- isInternal -----------------------------------------------------------

Deno.test("isInternal recognises internal Cargo crates", () => {
  assert(isInternal("cargo", "stsoftware-core"));
  assert(isInternal("cargo", "stSoftware-utils"));
  assert(!isInternal("cargo", "serde"));
  assert(!isInternal("cargo", "tokio"));
});

Deno.test("isInternal recognises internal GitHub Actions by owner", () => {
  assert(isInternal("github-actions", "stSoftwareAU/some-action"));
  assert(isInternal("github-actions", "stsoftwareau/other"));
  assert(!isInternal("github-actions", "actions/checkout"));
  assert(!isInternal("github-actions", "denoland/setup-deno"));
});

// --- ageInHours -----------------------------------------------------------

Deno.test("ageInHours computes whole-hour differences", () => {
  assertEquals(ageInHours("2026-06-17T00:00:00Z", NOW), 24);
  assertEquals(ageInHours("2026-06-17T12:00:00Z", NOW), 12);
});

Deno.test("ageInHours returns null for an unparseable timestamp", () => {
  assertEquals(ageInHours("not-a-date", NOW), null);
});

// --- evaluateBump ---------------------------------------------------------

Deno.test("evaluateBump passes an old enough external crate", () => {
  const e = evaluateBump(
    bump({ publishedAt: "2026-06-16T00:00:00Z" }), // 48h old
    NOW,
    24,
  );
  assertEquals(e.verdict, "ok");
  assertEquals(e.ageHours, 48);
});

Deno.test("evaluateBump quarantines a too-fresh external crate", () => {
  const e = evaluateBump(
    bump({ publishedAt: "2026-06-17T18:00:00Z" }), // 6h old
    NOW,
    24,
  );
  assertEquals(e.verdict, "quarantined");
  assertEquals(e.ageHours, 6);
});

Deno.test("evaluateBump bypasses internal dependencies regardless of age", () => {
  const e = evaluateBump(
    bump({
      name: "stsoftware-core",
      publishedAt: "2026-06-17T23:30:00Z", // 30min old
    }),
    NOW,
    24,
  );
  assertEquals(e.verdict, "internal");
});

Deno.test("evaluateBump fails closed when the publish time is unknown", () => {
  const e = evaluateBump(bump({ publishedAt: null }), NOW, 24);
  assertEquals(e.verdict, "unknown");
});

Deno.test("evaluateBump treats exactly-threshold age as old enough", () => {
  const e = evaluateBump(
    bump({ publishedAt: "2026-06-17T00:00:00Z" }), // exactly 24h
    NOW,
    24,
  );
  assertEquals(e.verdict, "ok");
});

// --- evaluateBumps / violations ------------------------------------------

Deno.test("violations collects only the blocking evaluations", () => {
  const bumps: Bump[] = [
    bump({ name: "serde", publishedAt: "2026-06-10T00:00:00Z" }), // ok
    bump({ name: "tokio", publishedAt: "2026-06-17T20:00:00Z" }), // fresh
    bump({ name: "stsoftware-x", publishedAt: "2026-06-17T20:00:00Z" }), // internal
    bump({ name: "log", publishedAt: null }), // unknown
  ];
  const evals = evaluateBumps(bumps, NOW, 24);
  const blocked = violations(evals);
  const names = blocked.map((e) => e.bump.name).sort();
  assertEquals(names, ["log", "tokio"]);
});

Deno.test("evaluateBumps with no bumps yields no violations", () => {
  assertEquals(violations(evaluateBumps([], NOW, 24)).length, 0);
});

// --- parseCargoLock / diffCargoLock --------------------------------------

const LOCK_OLD = `# This file is automatically @generated by Cargo.
version = 4

[[package]]
name = "serde"
version = "1.0.200"

[[package]]
name = "tokio"
version = "1.38.0"
`;

const LOCK_NEW = `# This file is automatically @generated by Cargo.
version = 4

[[package]]
name = "serde"
version = "1.0.210"

[[package]]
name = "tokio"
version = "1.38.0"

[[package]]
name = "once_cell"
version = "1.19.0"
`;

Deno.test("parseCargoLock extracts package name/version pairs", () => {
  const map = parseCargoLock(LOCK_OLD);
  assertEquals(map.get("serde"), "1.0.200");
  assertEquals(map.get("tokio"), "1.38.0");
  assertEquals(map.size, 2);
});

Deno.test("diffCargoLock reports upgraded and newly-added crates", () => {
  const bumps = diffCargoLock(LOCK_OLD, LOCK_NEW);
  const byName = new Map(bumps.map((b) => [b.name, b.version]));
  // serde upgraded, once_cell added; tokio unchanged so excluded.
  assertEquals(byName.get("serde"), "1.0.210");
  assertEquals(byName.get("once_cell"), "1.19.0");
  assert(!byName.has("tokio"), "unchanged crates must not be reported");
  for (const b of bumps) assertEquals(b.ecosystem, "cargo");
});

Deno.test("diffCargoLock reports nothing when the lock is unchanged", () => {
  assertEquals(diffCargoLock(LOCK_OLD, LOCK_OLD).length, 0);
});

// --- parseUses ------------------------------------------------------------

const WORKFLOW = `name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10
      - uses: denoland/setup-deno@667a34cdef165d8d2b2e98dde39547c9daac7282 # v2.0.4
      - run: echo hello
`;

Deno.test("parseUses extracts owner/repo@ref entries", () => {
  const uses = parseUses(WORKFLOW);
  assertEquals(
    uses.get("actions/checkout"),
    "df4cb1c069e1874edd31b4311f1884172cec0e10",
  );
  assertEquals(
    uses.get("denoland/setup-deno"),
    "667a34cdef165d8d2b2e98dde39547c9daac7282",
  );
  assertEquals(uses.size, 2);
});

Deno.test("parseUses ignores lines without a uses directive", () => {
  assertEquals(
    parseUses("jobs:\n  x:\n    steps:\n      - run: echo hi\n").size,
    0,
  );
});
