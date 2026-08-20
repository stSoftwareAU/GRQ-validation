// Rust/JavaScript dollar-ADV parity gate (issue #838, sub-issue of #835).
//
// The pick-details sidecar written by the Rust backend carries an
// `adv_dollar_10d` column, and the dashboard's traffic light derives its lots
// from `averageDollarVolume` in docs/volume_recommend.js (the #576 single
// source of truth). There must be exactly ONE dollar-ADV definition, so both
// sides are pinned to the same committed window:
// tests/fixtures/adv_dollar_10d_parity.json.
//
// This test drives the real shipped helper over that window; the Rust half
// lives in tests/picks_sidecar_test.rs and runs the same rows through the
// sidecar writer. If either definition drifts, one of the two fails.
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import "../docs/volume_recommend.js";

interface ParityRow {
  date: string;
  low: string;
  volume: string;
}

interface ParityFixture {
  score_date: string;
  expected_adv_dollar_10d: number;
  rows: ParityRow[];
}

const g = globalThis as unknown as {
  GRQVolume: {
    WEEKDAY_WINDOW: number;
    averageDollarVolume: (
      window: Array<{ volume: unknown; lowPrice: unknown }>,
    ) => number | null;
    buildTrailingVolumeWindow: (
      series: Array<{ date: string; low: number; volume: number }>,
      asOfDate: string,
      weekdays?: number,
    ) => Array<{ volume: unknown; lowPrice: unknown }>;
  };
};

const fixture: ParityFixture = JSON.parse(
  await Deno.readTextFile("tests/fixtures/adv_dollar_10d_parity.json"),
);

const series = fixture.rows.map((row) => ({
  date: row.date,
  low: Number(row.low),
  volume: Number(row.volume),
}));

Deno.test("dollar-ADV parity fixture describes a trailing ten-weekday window", () => {
  // The fixture must keep rows OUTSIDE the trailing window, otherwise a
  // window-trimming bug on either side would go unnoticed.
  assert(
    fixture.rows.length > g.GRQVolume.WEEKDAY_WINDOW,
    "the parity fixture must carry more rows than the trailing window",
  );
  assertEquals(
    fixture.rows[fixture.rows.length - 1].date,
    fixture.score_date,
    "the last fixture row must be the score date",
  );
});

Deno.test("averageDollarVolume matches the sidecar's adv_dollar_10d for the shared window", () => {
  const window = g.GRQVolume.buildTrailingVolumeWindow(
    series,
    fixture.score_date,
  );
  assertEquals(
    window.length,
    g.GRQVolume.WEEKDAY_WINDOW,
    "the trailing window must hold exactly the last ten weekdays",
  );

  const average = g.GRQVolume.averageDollarVolume(window);
  assert(average !== null, "the shared window must yield a dollar ADV");
  assertAlmostEquals(
    average,
    fixture.expected_adv_dollar_10d,
    0.01,
    "the frontend dollar-ADV definition has drifted from the backend sidecar",
  );
});

Deno.test("dollar-ADV skips unusable days rather than counting them as zero", () => {
  // The fixture holds one zero-volume day inside the window. Both sides divide
  // by the USABLE days, so dropping that day from the fixture leaves the mean
  // unchanged — proof the zero was skipped, not averaged in as a 0.
  const withoutZeroVolume = series.filter((row) => row.volume > 0);
  const window = g.GRQVolume.buildTrailingVolumeWindow(
    withoutZeroVolume,
    fixture.score_date,
    g.GRQVolume.WEEKDAY_WINDOW - 1,
  );

  const average = g.GRQVolume.averageDollarVolume(window);
  assert(average !== null, "the usable days must still yield a dollar ADV");
  assertAlmostEquals(average, fixture.expected_adv_dollar_10d, 0.01);
});
