// Unreconciled-split chart behaviour (issue #831).
//
// A split the market data cannot reconcile used to fail silently on the chart:
// the factor was suppressed to 1.0 and the actuals line carried straight on,
// plotting raw post-split prices against a pre-split buy price — the ~400%
// MVIS cliff. The line must instead STOP at the unreconciled split and be
// flagged, so the gap reads as a known data problem.
//
// These exercise the shared kernels the dashboard calls:
//   - truncateAtUnreconciledSplit — drop everything from the split onward;
//   - unreconciledSplitAnnotation — the Chart.js marker that flags the stop.
import { assert, assertEquals } from "@std/assert";
import "../docs/projection.js";

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
const GRQProjection = g.GRQProjection;

const SPLIT_DATE = new Date(2026, 7, 3); // 2026-08-03

const marketPoints = [
  { date: new Date(2026, 6, 30), high: 0.25, low: 0.23 },
  { date: new Date(2026, 6, 31), high: 0.266, low: 0.234 },
  { date: SPLIT_DATE, high: 4.2315, low: 3.62 },
  { date: new Date(2026, 7, 4), high: 3.91, low: 3.6 },
];

Deno.test("truncateAtUnreconciledSplit - stops market-data points at the split", () => {
  const kept = GRQProjection.truncateAtUnreconciledSplit(
    marketPoints,
    SPLIT_DATE,
  );
  assertEquals(kept.length, 2, "only the two pre-split points survive");
  assertEquals(kept[0].date.getTime(), new Date(2026, 6, 30).getTime());
  assertEquals(kept[1].date.getTime(), new Date(2026, 6, 31).getTime());
  // The split day itself is already on the new basis, so it must not be plotted
  // against a buy price on the old one.
  assert(
    !kept.some((p: { date: Date }) => p.date.getTime() >= SPLIT_DATE.getTime()),
    "nothing from the split date onward is plotted",
  );
});

Deno.test("truncateAtUnreconciledSplit - stops Chart.js points (x) at the split too", () => {
  const chartPoints = [
    { x: new Date(2026, 6, 31), y: -68 },
    { x: SPLIT_DATE, y: 401 },
    { x: new Date(2026, 7, 4), y: 383 },
  ];
  const kept = GRQProjection.truncateAtUnreconciledSplit(
    chartPoints,
    SPLIT_DATE,
  );
  assertEquals(kept, [chartPoints[0]]);
});

Deno.test("truncateAtUnreconciledSplit - a reconciled series is returned unchanged", () => {
  // null date = nothing to stop at, so the full line is drawn.
  assertEquals(
    GRQProjection.truncateAtUnreconciledSplit(marketPoints, null),
    marketPoints,
  );
  assertEquals(
    GRQProjection.truncateAtUnreconciledSplit(marketPoints, new Date("nope")),
    marketPoints,
  );
});

Deno.test("truncateAtUnreconciledSplit - does not mutate its input and tolerates bad input", () => {
  const src = [...marketPoints];
  GRQProjection.truncateAtUnreconciledSplit(src, SPLIT_DATE);
  assertEquals(src.length, marketPoints.length, "input array is untouched");
  // A point with no usable date cannot be placed relative to the split, so it
  // is dropped rather than plotted across it.
  assertEquals(
    GRQProjection.truncateAtUnreconciledSplit(
      [{ y: 1 }, null, { date: new Date(2026, 6, 30), high: 1, low: 1 }],
      SPLIT_DATE,
    ).length,
    1,
  );
  assertEquals(
    GRQProjection.truncateAtUnreconciledSplit(undefined, SPLIT_DATE),
    undefined,
  );
});

Deno.test("unreconciledSplitAnnotation - flags the stop with a labelled line at the split", () => {
  const annotation = GRQProjection.unreconciledSplitAnnotation(
    SPLIT_DATE,
    false,
  );
  assert(annotation !== null, "an unreconciled split must be flagged");
  assertEquals(annotation.type, "line");
  assertEquals(
    annotation.xMin,
    SPLIT_DATE,
    "the marker sits on the split date",
  );
  assertEquals(annotation.xMax, SPLIT_DATE);
  assert(annotation.borderWidth > 0, "the marker is actually drawn");
  assertEquals(
    annotation.label.display,
    true,
    "the label is visible, not silent",
  );
  assertEquals(
    annotation.label.content,
    GRQProjection.UNRECONCILED_SPLIT_LABEL,
  );
  assert(
    /split/i.test(annotation.label.content),
    `the label names the cause: "${annotation.label.content}"`,
  );
  // Mobile gets the same marker at the smaller font the other annotations use.
  const mobile = GRQProjection.unreconciledSplitAnnotation(SPLIT_DATE, true);
  assert(mobile.label.font.size < annotation.label.font.size);
});

Deno.test("unreconciledSplitAnnotation - no marker when there is nothing to flag", () => {
  assertEquals(GRQProjection.unreconciledSplitAnnotation(null, false), null);
  assertEquals(
    GRQProjection.unreconciledSplitAnnotation(new Date("nope"), false),
    null,
  );
});

Deno.test("unreconciledSplitDate - null for a reconciled series, the split date otherwise", () => {
  const makePoint = (
    date: Date,
    high: number,
    low: number,
    splitCoefficient = 1.0,
  ) => ({ date, high, low, open: high, close: low, splitCoefficient });

  // A clean 2:1 split: reconciled, so the chart draws the whole line.
  const clean = [
    makePoint(new Date(2025, 0, 1), 100, 98),
    makePoint(new Date(2025, 0, 10), 50, 49, 2.0),
  ];
  assertEquals(
    GRQProjection.unreconciledSplitDate(clean, new Date(2025, 0, 1)),
    null,
  );

  // A 10:1 coefficient with no matching price drop: the line stops there.
  const distorted = [
    makePoint(new Date(2025, 0, 1), 100, 98),
    makePoint(new Date(2025, 0, 10), 99, 97, 10.0),
  ];
  assertEquals(
    GRQProjection.unreconciledSplitDate(distorted, new Date(2025, 0, 1))
      ?.getTime(),
    new Date(2025, 0, 10).getTime(),
  );

  // Breaching the cumulative bound condemns the series from its FIRST split.
  const compounded = [
    makePoint(new Date(2025, 0, 1), 10, 10),
    makePoint(new Date(2025, 0, 10), 1000, 1000, 0.01),
    makePoint(new Date(2025, 1, 10), 100000, 100000, 0.01),
  ];
  assertEquals(
    GRQProjection.unreconciledSplitDate(compounded, new Date(2025, 0, 1))
      ?.getTime(),
    new Date(2025, 0, 10).getTime(),
  );

  assertEquals(
    GRQProjection.unreconciledSplitDate(undefined, new Date()),
    null,
  );
});
