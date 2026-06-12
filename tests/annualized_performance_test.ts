// Behavioural tests for the score-file list page's summary-statistics kernel.
//
// History (issue #121): this file used to assert on inline reimplementations of
// production maths — it hand-coded the annualisation formula
// `(1 + r)^(365.25/90) - 1`, reimplemented the index.json averaging loop, and
// defined a local `calculateHybridProjection` — then asserted each copy against
// numbers derived from the same copy. Those were tautologies: no shipped code
// ran, so a regression in the real annualisation, averaging or hybrid-projection
// path left every assertion green.
//
// Those cases have been resolved against the real modules:
//   - The annualisation formula's production home is Rust
//     (`calculate_annualized_performance`), WHAT-tested by
//     `tests::test_annualized_performance_calculation_with_actual_days` in
//     src/utils.rs. The recompute-only "Compound Interest" guard was deleted
//     (issue #121, option b) rather than kept as a self-referential check.
//   - The hybrid-projection algorithm's production home is
//     `GRQProjection.computeHybridProjection` in docs/projection.js, driven by
//     `tests/projection_kernels_test.ts`. The local `calculateHybridProjection`
//     copy was deleted (issue #121, option b).
//   - The index.json averaging now lives in the shipped, pure
//     `GRQListStats.computeListAverages` (docs/list_stats.js), which
//     docs/list.js delegates to. The test below drives that real kernel.
import { assertEquals } from "@std/assert";
import "../docs/list_stats.js";

interface IndexRow {
  date?: string;
  performance_90_day: number | null;
  performance_annualized: number | null;
}

const g = globalThis as unknown as {
  GRQListStats: {
    computeListAverages: (rows: IndexRow[]) => {
      avg90Day: number;
      avgAnnualized: number;
      valid90DayCount: number;
      validAnnualizedCount: number;
      positiveCount: number;
    };
  };
};
const GRQListStats = g.GRQListStats;

Deno.test("computeListAverages averages only the populated fields", () => {
  // Two settled score files plus two still awaiting their 90-day result
  // (90-day null, annualised reported as a hybrid projection of 0.0).
  const rows: IndexRow[] = [
    {
      date: "2025-04-15",
      performance_90_day: 23.77,
      performance_annualized: 137.62,
    },
    {
      date: "2025-04-22",
      performance_90_day: 23.64,
      performance_annualized: 136.57,
    },
    {
      date: "2025-07-22",
      performance_90_day: null,
      performance_annualized: 0.0,
    },
    {
      date: "2025-07-23",
      performance_90_day: null,
      performance_annualized: 0.0,
    },
  ];

  const result = GRQListStats.computeListAverages(rows);

  // 90-day average excludes the two null entries: (23.77 + 23.64) / 2.
  assertEquals(result.avg90Day, 23.705);
  assertEquals(result.valid90DayCount, 2);
  // Annualised average spans all four entries: (137.62 + 136.57 + 0 + 0) / 4.
  assertEquals(result.avgAnnualized, 68.5475);
  assertEquals(result.validAnnualizedCount, 4);
  // Both populated 90-day figures are positive.
  assertEquals(result.positiveCount, 2);
});

Deno.test("computeListAverages counts negative 90-day figures as non-positive", () => {
  const rows: IndexRow[] = [
    { performance_90_day: 10, performance_annualized: 40 },
    { performance_90_day: -5, performance_annualized: -20 },
    { performance_90_day: 0, performance_annualized: 0 },
  ];

  const result = GRQListStats.computeListAverages(rows);

  assertEquals(result.avg90Day, (10 - 5 + 0) / 3);
  assertEquals(result.valid90DayCount, 3);
  // Only the +10 entry is strictly positive; 0 and -5 are excluded.
  assertEquals(result.positiveCount, 1);
});

Deno.test("computeListAverages returns zeroed averages for no populated rows", () => {
  const empty = GRQListStats.computeListAverages([]);
  assertEquals(empty, {
    avg90Day: 0,
    avgAnnualized: 0,
    valid90DayCount: 0,
    validAnnualizedCount: 0,
    positiveCount: 0,
  });

  const allNull = GRQListStats.computeListAverages([
    { performance_90_day: null, performance_annualized: null },
    { performance_90_day: null, performance_annualized: null },
  ]);
  assertEquals(allNull, {
    avg90Day: 0,
    avgAnnualized: 0,
    valid90DayCount: 0,
    validAnnualizedCount: 0,
    positiveCount: 0,
  });
});
