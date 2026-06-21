#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
//
// First-party benchmark-index fetcher (issue #93).
//
// The dashboard used to fetch S&P 500 / NASDAQ / Russell 2000 data at runtime
// in the visitor's browser through arbitrary public CORS proxies
// (api.allorigins.win, corsproxy.io, thingproxy.freeboard.io) — open relays
// operated by unrelated third parties that could observe every visitor and
// tamper with the charted data. This script moves that fetch server-side: it
// calls Yahoo Finance directly (no browser, so no CORS restriction and no
// proxy) and writes a same-origin static file, docs/market-indices.json, that
// the dashboard then reads with a plain same-origin fetch.
//
// Run it from the repository root to refresh the committed data file:
//
//   deno task fetch-indices
//
// (or the raw form: deno run --allow-net --allow-read --allow-write
// scripts/fetch_market_indices.ts)
//
// The write is safe for unattended daily runs: it fails fast (non-zero exit)
// when any index returns no usable closes, refuses to overwrite the committed
// file with a regressed payload (a dropped index key, a truncated history, or a
// newest date that goes backwards), and skips the write entirely when the
// freshly-fetched data is byte-for-byte identical to what is already committed.
//
// Output shape (date -> closing price, mirroring docs/USDAUD.json):
//
//   {
//     "sp500":       { "2024-01-02": 4742.83, ... },
//     "nasdaq":      { "2024-01-02": 14765.94, ... },
//     "russell2000": { "2024-01-02": 2027.07, ... }
//   }

const OUTPUT_PATH = "docs/market-indices.json";

// Yahoo Finance index symbols, keyed by the property the dashboard expects.
const INDICES: Record<string, string> = {
  sp500: "^GSPC",
  nasdaq: "^IXIC",
  russell2000: "^RUT",
};

// History window: cover every score file the dashboard can select. Score files
// in docs/scores/ go back to 2024, so fetch from the start of 2024.
const HISTORY_START = "2024-01-01";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: unknown;
  };
}

function toUnixSeconds(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

// Convert a Yahoo chart payload into a { "YYYY-MM-DD": close } map, skipping
// any day with a null/non-finite close (Yahoo emits gaps for non-trading days).
function toPriceMap(payload: YahooChartResponse): Record<string, number> {
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  const map: Record<string, number> = {};
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== "number" || !Number.isFinite(close)) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
    map[date] = Math.round(close * 100) / 100;
  }
  return map;
}

async function fetchIndex(symbol: string): Promise<Record<string, number>> {
  const period1 = toUnixSeconds(HISTORY_START);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${
    encodeURIComponent(symbol)
  }?period1=${period1}&period2=${period2}&interval=1d`;

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (GRQ-validation benchmark fetcher)" },
  });
  if (!response.ok) {
    throw new Error(
      `Yahoo Finance request for ${symbol} failed: ${response.status} ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as YahooChartResponse;
  const map = toPriceMap(payload);
  if (Object.keys(map).length === 0) {
    throw new Error(`Yahoo Finance returned no usable closes for ${symbol}`);
  }
  return map;
}

// A full dataset: index key -> { "YYYY-MM-DD": close }.
type IndexDataset = Record<string, Record<string, number>>;

// Canonical on-disk form: 2-space-indented JSON with a trailing newline.
// The committed file is written by this same serialiser, so comparing a freshly
// serialised payload against the committed text is a reliable unchanged-content
// check (both list indices in INDICES order and dates ascending).
function serialiseDataset(data: IndexDataset): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// ISO dates (YYYY-MM-DD) sort lexically, so the lexical maximum is the newest.
function newestDate(dates: string[]): string {
  let newest = "";
  for (const date of dates) {
    if (date > newest) newest = date;
  }
  return newest;
}

interface SafetyResult {
  ok: boolean;
  reason?: string;
}

// Guard against overwriting good committed history with a regressed payload.
// A fresh dataset is unsafe when, relative to the committed one, it drops an
// index key, materially truncates an index's history, or lets an index's newest
// date go backwards. With no committed file (first run) any non-empty fresh
// dataset is accepted — the fetch loop already fails fast on empty closes.
function checkDatasetSafety(
  existing: IndexDataset | null,
  fresh: IndexDataset,
): SafetyResult {
  if (!existing) return { ok: true };

  for (const key of Object.keys(existing)) {
    const freshSeries = fresh[key];
    if (!freshSeries || Object.keys(freshSeries).length === 0) {
      return { ok: false, reason: `fresh dataset is missing index '${key}'` };
    }

    const existingDates = Object.keys(existing[key]);
    const freshDates = Object.keys(freshSeries);
    if (freshDates.length < existingDates.length) {
      return {
        ok: false,
        reason: `fresh '${key}' has ${freshDates.length} trading days, ` +
          `fewer than the committed ${existingDates.length}`,
      };
    }

    const existingNewest = newestDate(existingDates);
    const freshNewest = newestDate(freshDates);
    if (freshNewest < existingNewest) {
      return {
        ok: false,
        reason: `fresh '${key}' newest date ${freshNewest} regresses ` +
          `from the committed ${existingNewest}`,
      };
    }
  }

  return { ok: true };
}

// Read and parse the committed file, returning both the raw text (for an
// unchanged-content check) and the parsed dataset (for the safety guard). A
// missing or unparseable file yields nulls, leaving the write unguarded — the
// first run, or recovery from a corrupt file, is allowed to write fresh data.
async function readExistingDataset(
  path: string,
): Promise<{ text: string | null; data: IndexDataset | null }> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { text: null, data: null };
    }
    throw error;
  }
  try {
    return { text, data: JSON.parse(text) as IndexDataset };
  } catch {
    return { text, data: null };
  }
}

// Fetch every index, apply the safe-write guard, and refresh the committed
// docs/market-indices.json. Throws on any failure (an empty Yahoo response or a
// regressed payload) and leaves the committed file untouched in that case, so a
// graceful caller can swallow the error and keep the last-good file (#238).
async function refreshMarketIndices(): Promise<void> {
  const fresh: IndexDataset = {};
  for (const [key, symbol] of Object.entries(INDICES)) {
    console.log(`Fetching ${symbol} (${key})...`);
    fresh[key] = await fetchIndex(symbol);
    console.log(`  ${Object.keys(fresh[key]).length} trading days`);
  }

  const existing = await readExistingDataset(OUTPUT_PATH);

  const safety = checkDatasetSafety(existing.data, fresh);
  if (!safety.ok) {
    throw new Error(`Refusing to overwrite ${OUTPUT_PATH}: ${safety.reason}`);
  }

  const newText = serialiseDataset(fresh);
  if (existing.text === newText) {
    console.log(`${OUTPUT_PATH} already up to date; skipping write.`);
    return;
  }

  await Deno.writeTextFile(OUTPUT_PATH, newText);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

if (import.meta.main) {
  await refreshMarketIndices();
}

export {
  checkDatasetSafety,
  newestDate,
  refreshMarketIndices,
  serialiseDataset,
  toPriceMap,
  toUnixSeconds,
};
export type { IndexDataset, SafetyResult };
