// One-off visual evidence generator for issue #817.
//
// Playwright MCP was unavailable in the run environment, so this renders the
// 180-day actuals line directly from the REAL shipped kernels
// (GRQProjection.filterDividendsWithinDays / sumDividendsToDate /
// calculatePerformanceReturn) over REAL published data, exactly as
// docs/app.js's prepareChartData now composes them.
//
// SITC itself cannot be drawn yet: its US$1.00 dividend went ex 2026-08-03 but
// the committed market-data CSVs still end 2026-07-31, so the ex-date price
// fall is not published. NASDAQ:IMPP on the 2026-02-17 prediction is the same
// shape with data on both sides — a US$0.546875 dividend (~15% of the
// US$3.545 buy price) gone ex on day 128, inside the 180-day chart window and
// outside the 90-day judgement window.
//
// Run: deno run --allow-read --allow-write scripts/gen_issue_817_evidence.ts
import "../docs/projection.js";

// deno-lint-ignore no-explicit-any
const GRQProjection = (globalThis as any).GRQProjection;

const TICKER = "NASDAQ:IMPP";
const SCORE_DATE = new Date("2026-02-17T00:00:00");
const WINDOW_DAYS = 180;
const DAY = 24 * 60 * 60 * 1000;
const MARKET_CSV = "docs/scores/2026/February/17.csv";
const DIVIDEND_CSV = "docs/scores/2026/February/17-dividends.csv";

/** Split a CSV into rows of trimmed fields, dropping the header. */
function rows(text: string): string[][] {
  return text.trimEnd().split("\n").slice(1).map((line) =>
    line.split(",").map((f) => f.trim())
  );
}

const prices = rows(await Deno.readTextFile(MARKET_CSV))
  .filter((r) => r[1] === TICKER)
  .map((r) => ({
    date: new Date(`${r[0]}T00:00:00`),
    mid: (Number(r[2]) + Number(r[3])) / 2,
  }))
  .filter((p) => p.date.getTime() <= SCORE_DATE.getTime() + WINDOW_DAYS * DAY);

const dividends = rows(await Deno.readTextFile(DIVIDEND_CSV))
  .filter((r) => r[1] === TICKER)
  .map((r) => ({
    exDivDate: new Date(`${r[0]}T00:00:00`),
    amount: Number(r[2]),
  }));

if (prices.length === 0) {
  throw new Error(`No ${TICKER} prices in ${MARKET_CSV}`);
}
const buyPrice = prices[0].mid;

// BEFORE: the fixed 90-day filter — a day-128 dividend is never credited.
const judged = GRQProjection.filterDividendsWithin90Days(dividends, SCORE_DATE);
// AFTER: the visible-window filter (issue #817).
const windowed = GRQProjection.filterDividendsWithinDays(
  dividends,
  SCORE_DATE,
  WINDOW_DAYS,
);

const seriesFor = (list: typeof dividends) =>
  prices.map((p) => ({
    x: (p.date.getTime() - SCORE_DATE.getTime()) / DAY,
    y: GRQProjection.calculatePerformanceReturn(
      buyPrice,
      p.mid,
      GRQProjection.sumDividendsToDate(list, p.date),
    ) as number,
  }));

const before = seriesFor(judged);
const after = seriesFor(windowed);

const W = 640, H = 320, PAD = 40;
const xmax = WINDOW_DAYS;
const ys = [...before, ...after].map((p) => p.y);
const ymin = Math.min(...ys) - 3, ymax = Math.max(...ys) + 3;
const sx = (x: number) => PAD + (x / xmax) * (W - 2 * PAD);
const sy = (y: number) =>
  H - PAD - ((y - ymin) / (ymax - ymin)) * (H - 2 * PAD);
const poly = (data: { x: number; y: number }[]) =>
  data.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");

const exDay = Math.round(
  (windowed[0].exDivDate.getTime() - SCORE_DATE.getTime()) / DAY,
);

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="IMPP 180-day actuals: uncredited vs credited day-128 dividend">
  <title>${TICKER} 180-day actuals — day-128 dividend, before and after issue #817</title>
  <rect width="${W}" height="${H}" fill="white"/>
  <text x="${PAD}" y="20" font-size="13" fill="rgb(33,37,41)">${TICKER} — prediction 2026-02-17, 180-day chart window</text>
  <line x1="${PAD}" y1="${sy(0)}" x2="${W - PAD}" y2="${
    sy(0)
  }" stroke="rgb(200,200,200)" stroke-width="1"/>
  <line x1="${sx(90)}" y1="${PAD - 10}" x2="${sx(90)}" y2="${
    H - PAD
  }" stroke="rgb(220,53,69)" stroke-dasharray="4 3" stroke-width="1"/>
  <text x="${
    sx(90) + 4
  }" y="${PAD}" font-size="10" fill="rgb(220,53,69)">day 90</text>
  <line x1="${sx(exDay)}" y1="${PAD - 10}" x2="${sx(exDay)}" y2="${
    H - PAD
  }" stroke="rgb(0,123,255)" stroke-dasharray="4 3" stroke-width="1"/>
  <text x="${
    sx(exDay) - 74
  }" y="${PAD}" font-size="10" fill="rgb(0,123,255)">ex-div day ${exDay}</text>
  <polyline points="${
    poly(before)
  }" fill="none" stroke="rgb(173,181,189)" stroke-width="2"/>
  <polyline points="${
    poly(after)
  }" fill="none" stroke="rgb(102,126,234)" stroke-width="3"/>
  <text x="${PAD}" y="${
    H - 20
  }" font-size="11" fill="rgb(173,181,189)">Before #817 — dividend filtered at 90 days, ex-date fall uncredited</text>
  <text x="${PAD}" y="${
    H - 6
  }" font-size="11" fill="rgb(102,126,234)">After #817 — dividend credited from its ex-date inside the visible window</text>
</svg>`;

await Deno.writeTextFile("docs/evidence/issue-817-dividend-window.svg", svg);

const last = (s: { y: number }[]) => s[s.length - 1].y;
console.log(
  `buy price: $${buyPrice.toFixed(4)} on ${
    prices[0].date.toISOString().slice(0, 10)
  }`,
);
console.log(
  `dividend: $${windowed[0].amount} ex ${
    windowed[0].exDivDate.toISOString().slice(0, 10)
  } (day ${exDay})`,
);
console.log(
  `90-day filter credits ${judged.length} dividend(s); 180-day window credits ${windowed.length}`,
);
console.log(
  `final point: before ${last(before).toFixed(2)}% -> after ${
    last(after).toFixed(2)
  }% (+${(last(after) - last(before)).toFixed(2)} pp)`,
);
console.log("wrote docs/evidence/issue-817-dividend-window.svg");
