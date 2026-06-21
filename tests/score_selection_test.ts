// Tests for the default score-file selection helper (issue #275).
//
// The dashboard's default auto-selection must land on the nearest available
// score date ON OR BEFORE 90 days ago — never an absolute-nearest date that is
// more recent than the 90-day target. These tests import the REAL shipped
// helper from docs/projection.js and assert on its observable output.
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";

interface ScoreEntry {
  file: string;
  date: string;
}

const g = globalThis as unknown as {
  GRQProjection: {
    selectDefaultScore: (
      scores: ScoreEntry[],
      today: Date,
    ) => ScoreEntry | null;
  };
};
const { selectDefaultScore } = g.GRQProjection;

// Format a Date as a YYYY-MM-DD string for building score fixtures.
function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Build a date `daysAgo` days before `today`.
function daysBefore(today: Date, daysAgo: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

const TODAY = new Date(2026, 5, 22); // 2026-06-22 (local midnight)

Deno.test("projection.js publishes selectDefaultScore on globalThis", () => {
  assertEquals(typeof selectDefaultScore, "function");
});

Deno.test("selectDefaultScore: picks 90-days-ago over the closer 87-days-ago (regression #275)", () => {
  // Straddle the 90-day target: 87 days ago is absolute-nearest but MORE
  // recent than the target; 93 days ago is on/before. The old Math.abs logic
  // wrongly chose 87 days ago.
  const scores: ScoreEntry[] = [
    { file: "f87.tsv", date: ymd(daysBefore(TODAY, 87)) },
    { file: "f93.tsv", date: ymd(daysBefore(TODAY, 93)) },
  ];
  const chosen = selectDefaultScore(scores, TODAY);
  assertEquals(chosen?.file, "f93.tsv");
});

Deno.test("selectDefaultScore: picks the exact 90-days-ago date when present", () => {
  const scores: ScoreEntry[] = [
    { file: "f88.tsv", date: ymd(daysBefore(TODAY, 88)) },
    { file: "f90.tsv", date: ymd(daysBefore(TODAY, 90)) },
    { file: "f95.tsv", date: ymd(daysBefore(TODAY, 95)) },
  ];
  const chosen = selectDefaultScore(scores, TODAY);
  assertEquals(chosen?.file, "f90.tsv");
});

Deno.test("selectDefaultScore: chooses the LATEST date on or before the target", () => {
  const scores: ScoreEntry[] = [
    { file: "f120.tsv", date: ymd(daysBefore(TODAY, 120)) },
    { file: "f100.tsv", date: ymd(daysBefore(TODAY, 100)) },
    { file: "f95.tsv", date: ymd(daysBefore(TODAY, 95)) },
  ];
  const chosen = selectDefaultScore(scores, TODAY);
  assertEquals(chosen?.file, "f95.tsv");
});

Deno.test("selectDefaultScore: falls back to the EARLIEST date when none on/before the target", () => {
  // Every score is more recent than 90 days ago — fall back to the earliest.
  const scores: ScoreEntry[] = [
    { file: "f10.tsv", date: ymd(daysBefore(TODAY, 10)) },
    { file: "f30.tsv", date: ymd(daysBefore(TODAY, 30)) },
    { file: "f20.tsv", date: ymd(daysBefore(TODAY, 20)) },
  ];
  const chosen = selectDefaultScore(scores, TODAY);
  assertEquals(chosen?.file, "f30.tsv");
});

Deno.test("selectDefaultScore: order-independent (earliest fallback ignores array order)", () => {
  const scores: ScoreEntry[] = [
    { file: "f20.tsv", date: ymd(daysBefore(TODAY, 20)) },
    { file: "f50.tsv", date: ymd(daysBefore(TODAY, 50)) },
    { file: "f5.tsv", date: ymd(daysBefore(TODAY, 5)) },
  ];
  const chosen = selectDefaultScore(scores, TODAY);
  assertEquals(chosen?.file, "f50.tsv");
});

Deno.test("selectDefaultScore: returns null for an empty list", () => {
  assertEquals(selectDefaultScore([], TODAY), null);
});

Deno.test("selectDefaultScore: returns null for non-array input", () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(selectDefaultScore(null as any, TODAY), null);
});

Deno.test("selectDefaultScore: single date on/before target is chosen", () => {
  const scores: ScoreEntry[] = [
    { file: "f200.tsv", date: ymd(daysBefore(TODAY, 200)) },
  ];
  const chosen = selectDefaultScore(scores, TODAY);
  assert(chosen !== null);
  assertEquals(chosen?.file, "f200.tsv");
});
