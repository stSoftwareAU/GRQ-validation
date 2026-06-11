#!/usr/bin/env -S deno run --allow-net --allow-write
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
//   deno run --allow-net --allow-write scripts/fetch_market_indices.ts
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
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${
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

async function main(): Promise<void> {
  const out: Record<string, Record<string, number>> = {};
  for (const [key, symbol] of Object.entries(INDICES)) {
    console.log(`Fetching ${symbol} (${key})...`);
    out[key] = await fetchIndex(symbol);
    console.log(`  ${Object.keys(out[key]).length} trading days`);
  }

  await Deno.writeTextFile(OUTPUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

if (import.meta.main) {
  await main();
}

export { toPriceMap, toUnixSeconds };
