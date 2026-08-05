// Promotion guard tests (issue #821).
//
// 2026-07-05 and 2026-07-06 shipped 05.tsv/06.tsv with no sibling market-data
// CSV, so the daily promotion job published a half-populated date and every
// later PR's CI run failed on the data-presence gate for reasons unrelated to
// the PR. These tests cover the guard the promotion job calls immediately
// before its daily commit: it must refuse (exit non-zero, naming the offender)
// rather than promote a score file it cannot pair with market data.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  checkScoreDataPairing,
  collectPredictionTsvs,
  isMarketDataCsvEmpty,
  parseArgs,
  predictionTsvPath,
} from "../scripts/check_score_data_pairing.ts";

const HEADER = "date,ticker,high,low,open,close,split_coefficient,volume\n";
const WITH_DATA = HEADER +
  "2026-07-06,NYSE:SLB,46.07,44.75,44.76,45.72,1.0,1\n";

/** Builds a reader over an in-memory tree: absent keys read as missing. */
function readerFor(files: Record<string, string>) {
  return (path: string): Promise<string | null> =>
    Promise.resolve(Object.hasOwn(files, path) ? files[path] : null);
}

/** Collects log lines so the failure message can be asserted on. */
function collector(): { lines: string[]; log: (msg: string) => void } {
  const lines: string[] = [];
  return { lines, log: (msg) => lines.push(msg) };
}

Deno.test("predictionTsvPath: maps an ISO date to its committed score path", () => {
  assertEquals(
    predictionTsvPath("docs/scores", "2026-07-05"),
    "docs/scores/2026/July/05.tsv",
  );
  assertEquals(
    predictionTsvPath("docs/scores", "2026-01-31"),
    "docs/scores/2026/January/31.tsv",
  );
});

Deno.test("predictionTsvPath: rejects a malformed or impossible date", () => {
  for (const bad of ["2026-7-5", "20260705", "2026-13-01", "not-a-date", ""]) {
    let threw = false;
    try {
      predictionTsvPath("docs/scores", bad);
    } catch {
      threw = true;
    }
    assert(threw, `expected "${bad}" to be rejected`);
  }
});

Deno.test("checkScoreDataPairing: promotion proceeds when the date is paired", async () => {
  const { lines, log } = collector();
  const code = await checkScoreDataPairing({
    scoresDir: "docs/scores",
    dates: ["2026-07-05"],
    readFile: readerFor({
      "docs/scores/2026/July/05.tsv": "ticker\tscore\nNYSE:SLB\t0.9\n",
      "docs/scores/2026/July/05.csv": WITH_DATA,
    }),
    log,
  });

  assertEquals(code, 0);
  assertStringIncludes(lines.join("\n"), "2026-07-05");
});

Deno.test("checkScoreDataPairing: refuses to promote a date whose market-data CSV is missing", async () => {
  const { lines, log } = collector();
  const code = await checkScoreDataPairing({
    scoresDir: "docs/scores",
    dates: ["2026-07-05", "2026-07-06"],
    readFile: readerFor({
      "docs/scores/2026/July/05.tsv": "ticker\tscore\nNYSE:SLB\t0.9\n",
      "docs/scores/2026/July/06.tsv": "ticker\tscore\nNYSE:SLB\t0.9\n",
      "docs/scores/2026/July/06.csv": WITH_DATA,
    }),
    log,
  });

  assertEquals(code, 1);
  const output = lines.join("\n");
  assertStringIncludes(output, "docs/scores/2026/July/05.csv (missing)");
  // The paired date must not be reported as an offender.
  assert(
    !output.includes("docs/scores/2026/July/06.csv ("),
    `paired date wrongly reported:\n${output}`,
  );
});

Deno.test("checkScoreDataPairing: refuses a header-only market-data CSV", async () => {
  const { lines, log } = collector();
  const code = await checkScoreDataPairing({
    scoresDir: "docs/scores",
    dates: ["2026-07-05"],
    readFile: readerFor({
      "docs/scores/2026/July/05.tsv": "ticker\tscore\nNYSE:SLB\t0.9\n",
      "docs/scores/2026/July/05.csv": HEADER,
    }),
    log,
  });

  assertEquals(code, 1);
  assertStringIncludes(
    lines.join("\n"),
    "docs/scores/2026/July/05.csv (header-only/empty)",
  );
});

Deno.test("checkScoreDataPairing: a requested date with no score file fails loud", async () => {
  const { lines, log } = collector();
  const code = await checkScoreDataPairing({
    scoresDir: "docs/scores",
    dates: ["2026-07-05"],
    readFile: readerFor({}),
    log,
  });

  assertEquals(code, 1);
  assertStringIncludes(
    lines.join("\n"),
    "docs/scores/2026/July/05.tsv (missing prediction file)",
  );
});

Deno.test("checkScoreDataPairing: an invalid --date argument fails loud rather than passing vacuously", async () => {
  const { lines, log } = collector();
  const code = await checkScoreDataPairing({
    scoresDir: "docs/scores",
    dates: ["05-07-2026"],
    readFile: readerFor({}),
    log,
  });

  assertEquals(code, 1);
  assertStringIncludes(lines.join("\n"), "05-07-2026");
});

Deno.test("checkScoreDataPairing: with no dates it sweeps the whole committed tree", async () => {
  const { lines, log } = collector();
  const code = await checkScoreDataPairing({
    scoresDir: "docs/scores",
    dates: [],
    listTsvs: () =>
      Promise.resolve([
        "docs/scores/2026/July/05.tsv",
        "docs/scores/2026/July/06.tsv",
      ]),
    readFile: readerFor({
      "docs/scores/2026/July/05.tsv": "ticker\tscore\n",
      "docs/scores/2026/July/06.tsv": "ticker\tscore\n",
      "docs/scores/2026/July/06.csv": WITH_DATA,
    }),
    log,
  });

  assertEquals(code, 1);
  assertStringIncludes(lines.join("\n"), "docs/scores/2026/July/05.csv");
});

Deno.test("checkScoreDataPairing: an empty score tree is a fault, not a pass", async () => {
  const { lines, log } = collector();
  const code = await checkScoreDataPairing({
    scoresDir: "docs/scores",
    dates: [],
    listTsvs: () => Promise.resolve([]),
    readFile: readerFor({}),
    log,
  });

  assertEquals(code, 1);
  assertStringIncludes(lines.join("\n"), "no prediction files");
});

Deno.test("collectPredictionTsvs: finds day-numbered TSVs and ignores helper files", async () => {
  const found = await collectPredictionTsvs("docs/scores/2026/July");
  assert(
    found.includes("docs/scores/2026/July/05.tsv"),
    `expected 05.tsv in ${found.join(", ")}`,
  );
  assert(
    !found.some((p) => p.endsWith("-analysis.csv") || p.endsWith(".csv")),
    "helper CSVs must not be collected as prediction files",
  );
});

Deno.test("checkScoreDataPairing: the committed tree passes the guard", async () => {
  const { log } = collector();
  assertEquals(
    await checkScoreDataPairing({ scoresDir: "docs/scores", dates: [], log }),
    0,
  );
});

Deno.test("parseArgs: collects repeated --date and an overridden --scores-dir", () => {
  const options = parseArgs([
    "--date",
    "2026-07-05",
    "--date",
    "2026-07-06",
    "--scores-dir",
    "other/scores",
  ]);
  assertEquals(options.dates, ["2026-07-05", "2026-07-06"]);
  assertEquals(options.scoresDir, "other/scores");
});

Deno.test("parseArgs: defaults to a whole-tree sweep of docs/scores", () => {
  const options = parseArgs([]);
  assertEquals(options.dates, []);
  assertEquals(options.scoresDir, "docs/scores");
});

Deno.test("parseArgs: rejects an unknown flag and a value-less --date", () => {
  for (const argv of [["--oops"], ["--date"]]) {
    let threw = false;
    try {
      parseArgs(argv);
    } catch {
      threw = true;
    }
    assert(threw, `expected ${argv.join(" ")} to be rejected`);
  }
});

Deno.test("isMarketDataCsvEmpty: shared with the data-presence gate", () => {
  assertEquals(isMarketDataCsvEmpty(null), true);
  assertEquals(isMarketDataCsvEmpty(HEADER), true);
  assertEquals(isMarketDataCsvEmpty(WITH_DATA), false);
});
