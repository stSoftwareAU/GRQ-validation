// Quality gate (issue #674, form 2/3 of #671): every committed prediction date
// must ship real market data.
//
// Regression context: on 2026-06-30 the dashboard fell into "Limited data mode"
// because all 161 market-data CSVs under docs/scores/2026/ had been reduced to a
// bare header row by a stray "Auto commit models" — the files still existed but
// carried no price rows. A naive file-existence check would have passed on every
// one of them. This gate iterates every committed docs/scores/**/DD.tsv and
// asserts the sibling DD.csv exists AND carries data rows beyond the header,
// mirroring the "> 1 non-blank line" rule encoded in
// src/utils.rs::is_market_data_csv_empty.

import { assert, assertEquals } from "@std/assert";

const SCORES_DIR = "docs/scores";

/**
 * Mirrors src/utils.rs::is_market_data_csv_empty: a market-data CSV counts as
 * empty when it is missing (null), blank, or contains only the header row —
 * i.e. one or fewer non-blank lines.
 */
export function isMarketDataCsvEmpty(content: string | null): boolean {
  if (content === null) return true;
  const nonBlank = content.split("\n").filter((line) => line.trim() !== "");
  return nonBlank.length <= 1;
}

/** Reads a file, returning null when it does not exist. */
async function readCsvOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/**
 * Recursively collects every day-numbered prediction TSV under docs/scores.
 * Day files are named like `07.tsv` or `4.tsv`; sibling helper files such as
 * `07-analysis.csv` are deliberately ignored.
 */
async function collectPredictionTsvs(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      found.push(...(await collectPredictionTsvs(path)));
    } else if (/^\d{1,2}\.tsv$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** Maps a prediction TSV path to its sibling market-data CSV path. */
function siblingCsv(tsvPath: string): string {
  return tsvPath.replace(/\.tsv$/, ".csv");
}

Deno.test("isMarketDataCsvEmpty: header-only CSV is treated as empty", () => {
  const headerOnly = "date,ticker,high,low,open,close,split_coefficient\n";
  assertEquals(isMarketDataCsvEmpty(headerOnly), true);
});

Deno.test("isMarketDataCsvEmpty: missing CSV (null) is treated as empty", () => {
  assertEquals(isMarketDataCsvEmpty(null), true);
});

Deno.test("isMarketDataCsvEmpty: blank/whitespace CSV is treated as empty", () => {
  assertEquals(isMarketDataCsvEmpty(""), true);
  assertEquals(isMarketDataCsvEmpty("   \n\n  \n"), true);
});

Deno.test("isMarketDataCsvEmpty: CSV with data rows beyond the header is NOT empty", () => {
  const withData = "date,ticker,high,low,open,close,split_coefficient\n" +
    "2026-01-02,NASDAQ:IBKR,177.3,173.25,173.25,173.43,1.0\n";
  assertEquals(isMarketDataCsvEmpty(withData), false);
});

Deno.test("isMarketDataCsvEmpty: trailing blank lines do not count as data rows", () => {
  const headerWithBlanks =
    "date,ticker,high,low,open,close,split_coefficient\n\n   \n";
  assertEquals(isMarketDataCsvEmpty(headerWithBlanks), true);
});

Deno.test(
  "data-presence gate: every committed prediction date has a non-empty sibling market-data CSV",
  async () => {
    const tsvs = (await collectPredictionTsvs(SCORES_DIR)).sort();

    // Guard against the gate passing vacuously if the score tree moves or empties.
    assert(
      tsvs.length > 100,
      `expected to find many prediction TSVs under ${SCORES_DIR}, found ${tsvs.length}`,
    );

    const offenders: string[] = [];
    for (const tsv of tsvs) {
      const csv = siblingCsv(tsv);
      const content = await readCsvOrNull(csv);
      if (isMarketDataCsvEmpty(content)) {
        offenders.push(
          content === null ? `${csv} (missing)` : `${csv} (header-only/empty)`,
        );
      }
    }

    assertEquals(
      offenders.length,
      0,
      `the following prediction dates are missing market data ` +
        `(empty/header-only/missing CSV):\n  ${offenders.join("\n  ")}`,
    );
  },
);
