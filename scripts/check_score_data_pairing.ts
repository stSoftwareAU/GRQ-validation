#!/usr/bin/env -S deno run --allow-read
//
// Daily promotion guard: a score date is never promoted without market data
// (issue #821).
//
// The external "scorer" job checks out this repo and commits the day's
// docs/scores/... files. On 2026-07-05 and 2026-07-06 it published 05.tsv and
// 06.tsv for dates on which it had fetched no market data — the sibling
// 05.csv/06.csv were never written — so the half-populated dates reached main
// and the data-presence gate (tests/market_data_presence_test.ts) failed on
// every later PR for reasons unrelated to that PR.
//
// This is the stable entry point the scorer invokes immediately BEFORE its
// daily commit, alongside `deno task refresh-indices`:
//
//   deno task check-score-data --date 2026-08-05   # the date being promoted
//   deno task check-score-data                     # sweep the whole tree
//
// Contract — the mirror image of the refresh-indices wrapper, which must never
// block the commit: this guard exists to block it. It exits non-zero and names
// every offending path whenever a prediction TSV has no sibling market-data CSV
// carrying rows beyond the header, so the job refuses to promote rather than
// committing a date it cannot pair. Absence of an offender is not enough on its
// own: an empty score tree, a missing prediction file for a requested date, and
// a malformed --date all fail loud too.

const DEFAULT_SCORES_DIR = "docs/scores";

// Month directory names as committed under docs/scores/YYYY/, in calendar order.
const MONTH_DIRS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Reads a file, returning null when it does not exist. */
export async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/**
 * Mirrors src/utils.rs::is_market_data_csv_empty and the data-presence gate: a
 * market-data CSV counts as empty when it is missing (null), blank, or carries
 * only the header row — i.e. one or fewer non-blank lines.
 */
export function isMarketDataCsvEmpty(content: string | null): boolean {
  if (content === null) return true;
  return content.split("\n").filter((line) => line.trim() !== "").length <= 1;
}

/** Maps a prediction TSV path to its sibling market-data CSV path. */
export function siblingCsv(tsvPath: string): string {
  return tsvPath.replace(/\.tsv$/, ".csv");
}

/**
 * Maps an ISO date to the score path the promotion job writes, e.g.
 * 2026-07-05 -> docs/scores/2026/July/05.tsv. Throws on any date that is
 * malformed or does not exist, so a typo can never pass vacuously.
 */
export function predictionTsvPath(scoresDir: string, isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`invalid date "${isoDate}": expected YYYY-MM-DD`);
  }
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error(`invalid date "${isoDate}": month out of range`);
  }
  const dayNumber = Number(day);
  const daysInMonth = new Date(Number(year), monthIndex + 1, 0).getDate();
  if (dayNumber < 1 || dayNumber > daysInMonth) {
    throw new Error(`invalid date "${isoDate}": day out of range`);
  }
  return `${scoresDir}/${year}/${MONTH_DIRS[monthIndex]}/${day}.tsv`;
}

/**
 * Recursively collects every day-numbered prediction TSV under a score tree.
 * Day files are named like `07.tsv`; sibling helper files such as
 * `07-analysis.csv` are deliberately ignored.
 */
export async function collectPredictionTsvs(dir: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      found.push(...(await collectPredictionTsvs(path)));
    } else if (/^\d{1,2}\.tsv$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found.sort();
}

export interface PairingCheckOptions {
  /** Root of the committed score tree. */
  scoresDir?: string;
  /** Dates being promoted; empty sweeps the whole tree. */
  dates?: string[];
  /** File reader, injectable for testing. */
  readFile?: (path: string) => Promise<string | null>;
  /** Prediction-TSV lister used for a whole-tree sweep, injectable for testing. */
  listTsvs?: (dir: string) => Promise<string[]>;
  /** Message sink, injectable for testing. */
  log?: (msg: string) => void;
}

/**
 * Verifies every prediction date under check ships a non-empty sibling
 * market-data CSV. Resolves to the process exit code: 0 when the promotion may
 * proceed, 1 when it must be refused.
 */
export async function checkScoreDataPairing(
  options: PairingCheckOptions = {},
): Promise<number> {
  const {
    scoresDir = DEFAULT_SCORES_DIR,
    dates = [],
    readFile = readFileOrNull,
    listTsvs = collectPredictionTsvs,
    log = console.error,
  } = options;

  const offenders: string[] = [];
  let tsvPaths: string[];

  if (dates.length > 0) {
    tsvPaths = [];
    for (const date of dates) {
      try {
        tsvPaths.push(predictionTsvPath(scoresDir, date));
      } catch (err) {
        offenders.push(err instanceof Error ? err.message : String(err));
      }
    }
  } else {
    tsvPaths = await listTsvs(scoresDir);
    // An empty sweep means the tree moved or emptied — never a silent pass.
    if (tsvPaths.length === 0) {
      offenders.push(`${scoresDir} contains no prediction files (.tsv)`);
    }
  }

  for (const tsv of tsvPaths) {
    // A requested date must actually have been written before it is promoted.
    if (await readFile(tsv) === null) {
      offenders.push(`${tsv} (missing prediction file)`);
      continue;
    }
    const csv = siblingCsv(tsv);
    const content = await readFile(csv);
    if (isMarketDataCsvEmpty(content)) {
      offenders.push(
        content === null ? `${csv} (missing)` : `${csv} (header-only/empty)`,
      );
    }
  }

  if (offenders.length > 0) {
    log(
      "check_score_data_pairing: REFUSING to promote — the following " +
        "prediction dates have no market data:\n  " + offenders.join("\n  "),
    );
    return 1;
  }

  const scope = dates.length > 0
    ? dates.join(", ")
    : `${tsvPaths.length} committed prediction dates`;
  log(`check_score_data_pairing: market data paired for ${scope}`);
  return 0;
}

/** Parses `--date YYYY-MM-DD` (repeatable) and `--scores-dir PATH`. */
export function parseArgs(argv: string[]): PairingCheckOptions {
  const dates: string[] = [];
  let scoresDir = DEFAULT_SCORES_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--date" || arg === "--scores-dir") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      if (arg === "--date") dates.push(value);
      else scoresDir = value;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return { scoresDir, dates };
}

if (import.meta.main) {
  let options: PairingCheckOptions;
  try {
    options = parseArgs(Deno.args);
  } catch (err) {
    console.error(
      `check_score_data_pairing: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    console.error(
      "usage: check_score_data_pairing.ts [--date YYYY-MM-DD]... [--scores-dir PATH]",
    );
    Deno.exit(2);
  }
  Deno.exit(await checkScoreDataPairing(options));
}
