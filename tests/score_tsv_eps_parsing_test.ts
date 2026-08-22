// Score TSV `eps` / `AnalystTargetPrice` parsing (issue #837).
//
// The score TSVs carry `eps` (column 9) and `AnalystTargetPrice` (column 10),
// but the dashboard parser used to stop at `intrinsicValuePerShareAdjusted` and
// silently drop both. These tests run the REAL shipped `loadScoreData` body from
// docs/app.js against fixture rows, so a wrong column index, a `NaN` leaking in
// place of `null`, or a short pre-`eps` row shifting a field is caught here.
import { assert, assertEquals } from "@std/assert";

interface ParsedStock {
  stock: string;
  score: number;
  target: number;
  exDividendDate: string | null;
  dividendPerShare: number;
  notes: string;
  intrinsicValuePerShareBasic: number | null;
  intrinsicValuePerShareAdjusted: number | null;
  eps: number | null;
  analystTargetPrice: number | null;
}

// Extract a class method body from app.js source and rebuild it as a callable
// function so the test runs the REAL shipped body (app.js bootstraps a live DOM
// at import time and cannot be imported headlessly). Brace-matched, not grepped.
function extractMethod(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`method ${signature} not found`);
  const open = src.indexOf("{", start);
  if (open === -1) throw new Error(`opening brace for ${signature} not found`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
}

// Run the real loadScoreData over `tsv`, with `fetch` shadowed by a stub that
// serves the fixture text.
async function parseScoreTsv(tsv: string): Promise<ParsedStock[]> {
  const src = await Deno.readTextFile(
    new URL("../docs/app.js", import.meta.url),
  );
  const body = extractMethod(src, "async loadScoreData() {");
  const factory = new Function("fetch", `return async function() ${body};`);
  const loadScoreData = factory(
    () => Promise.resolve({ text: () => Promise.resolve(tsv) }),
  ) as (this: unknown) => Promise<void>;

  const ctx = {
    selectedFile: "2026/April/02.tsv",
    scoreData: [] as ParsedStock[],
    filteredStocks: [] as ParsedStock[],
  };
  await loadScoreData.call(ctx);
  return ctx.scoreData;
}

const HEADER =
  "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes\tintrinsicValuePerShareBasic\tintrinsicValuePerShareAdjusted\teps\tAnalystTargetPrice";

Deno.test("loadScoreData parses eps and analystTargetPrice from a full row", async () => {
  const rows = await parseScoreTsv(
    `${HEADER}\n` +
      "NYSE:DD\t0.915\t49.79\t2026-05-15\t0.3575\t\t65.49\t47.19\t1.9006\t55.87",
  );

  assertEquals(rows.length, 1);
  assertEquals(rows[0].eps, 1.9006);
  assertEquals(rows[0].analystTargetPrice, 55.87);
});

Deno.test("loadScoreData keeps a negative eps (real data has them)", async () => {
  const rows = await parseScoreTsv(
    `${HEADER}\n` +
      "NASDAQ:VIAV\t0.915\t47.66\t\t\t\t45.78\t51.85\t-0.1802\t30.93",
  );

  assertEquals(rows[0].eps, -0.1802);
  assertEquals(rows[0].analystTargetPrice, 30.93);
});

Deno.test("loadScoreData yields null for blank eps / analystTargetPrice cells", async () => {
  const rows = await parseScoreTsv(
    `${HEADER}\n` +
      "NYSE:AAA\t0.500\t10.00\t\t\t\t9.00\t8.00\t\t",
  );

  assertEquals(rows[0].eps, null);
  assertEquals(rows[0].analystTargetPrice, null);
});

Deno.test("loadScoreData yields null (never NaN) for non-numeric eps / analystTargetPrice cells", async () => {
  const rows = await parseScoreTsv(
    `${HEADER}\n` +
      "NYSE:AAA\t0.500\t10.00\t\t\t\t9.00\t8.00\tN/A\tunknown",
  );

  assertEquals(rows[0].eps, null);
  assertEquals(rows[0].analystTargetPrice, null);
  assert(!Number.isNaN(rows[0].eps as unknown as number));
  assert(!Number.isNaN(rows[0].analystTargetPrice as unknown as number));
});

Deno.test("loadScoreData handles a short pre-eps row without shifting earlier fields", async () => {
  // A 2024-era file: eight columns, no eps / AnalystTargetPrice.
  const legacyHeader =
    "Stock\tScore\tTarget\tExDividendDate\tDividendPerShare\tNotes\tintrinsicValuePerShareBasic\tintrinsicValuePerShareAdjusted";
  const rows = await parseScoreTsv(
    `${legacyHeader}\n` +
      "NASDAQ:CRTO\t0.979\t46.96\t\t0\tWatch list\t-295505.33\t1963411.49",
  );

  assertEquals(rows[0].eps, null);
  assertEquals(rows[0].analystTargetPrice, null);
  // Earlier fields are untouched by the new columns.
  assertEquals(rows[0].stock, "NASDAQ:CRTO");
  assertEquals(rows[0].notes, "Watch list");
  assertEquals(rows[0].intrinsicValuePerShareBasic, -295505.33);
  assertEquals(rows[0].intrinsicValuePerShareAdjusted, 1963411.49);
});

Deno.test("loadScoreData exposes eps and analystTargetPrice on every parsed stock", async () => {
  const rows = await parseScoreTsv(
    `${HEADER}\n` +
      "NYSE:AAA\t0.500\t10.00\t\t\t\t9.00\t8.00\t1.25\t12.00\n" +
      "NYSE:BBB\t0.400\t20.00\t\t\t\t19.00\t18.00",
  );

  assertEquals(rows.length, 2);
  for (const row of rows) {
    assert("eps" in row, "eps missing from parsed stock");
    assert(
      "analystTargetPrice" in row,
      "analystTargetPrice missing from parsed stock",
    );
  }
  assertEquals(rows[1].eps, null);
});
