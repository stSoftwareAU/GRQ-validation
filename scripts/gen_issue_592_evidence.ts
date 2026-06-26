// One-off visual evidence generator for issue #592.
//
// Playwright MCP was unavailable in the run environment, so this script renders
// the actuals line directly from the REAL shipped helper
// (GRQProjection.bridgeActualsAfter90) to show the day-90 gap before the fix and
// the continuous line after it. Run: deno run --allow-write --allow-read \
//   scripts/gen_issue_592_evidence.ts
import "../docs/projection.js";

// deno-lint-ignore no-explicit-any
const GRQProjection = (globalThis as any).GRQProjection;

// Representative actuals: a smooth blue run up to the day-90 target then a grey
// tail. Index 9 (day 90) is the boundary point shared after the fix.
const series = [0, 1.5, 3, 2, 4, 5.5, 6, 5, 6.5, 7, 7.5, 6.8, 8, 9, 8.6];
const BOUNDARY = 9; // points 0..9 are on/before day 90, 10..14 after.
const pts = series.map((y, i) => ({ x: i, y }));
const before90 = pts.slice(0, BOUNDARY + 1);
const after90 = pts.slice(BOUNDARY + 1);

const W = 560, H = 300, PAD = 30;
const xmin = 0, xmax = series.length - 1;
const ymin = -1, ymax = 10;
const sx = (x: number) => PAD + (x - xmin) / (xmax - xmin) * (W - 2 * PAD);
const sy = (y: number) => H - PAD - (y - ymin) / (ymax - ymin) * (H - 2 * PAD);
const poly = (data: { x: number; y: number }[]) =>
  data.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");

const BLUE = "rgb(102,126,234)";
const GREY = "rgba(108,117,125,0.7)";

function svg(title: string, greyData: { x: number; y: number }[]): string {
  const targetX = sx(BOUNDARY), targetTop = sy(ymax), targetBot = sy(ymin);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">
  <rect width="${W}" height="${H}" fill="white"/>
  <text x="${
    W / 2
  }" y="18" text-anchor="middle" font-size="14" font-weight="bold">${title}</text>
  <line x1="${targetX}" y1="${targetTop}" x2="${targetX}" y2="${targetBot}" stroke="rgba(220,53,69,0.7)" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="${targetX + 4}" y="${
    targetTop + 12
  }" font-size="10" fill="rgb(220,53,69)">90-Day Target</text>
  <polyline points="${
    poly(before90)
  }" fill="none" stroke="${BLUE}" stroke-width="3"/>
  <polyline points="${
    poly(greyData)
  }" fill="none" stroke="${GREY}" stroke-width="1.5"/>
  <text x="${PAD}" y="${H - 6}" font-size="10" fill="${BLUE}">Actual</text>
  <text x="${W - PAD - 110}" y="${
    H - 6
  }" font-size="10" fill="rgb(108,117,125)">Actual (After 90 Days)</text>
</svg>`;
}

// BEFORE: grey series starts at the next point (un-shared boundary) -> gap.
const before = svg("Before #592 — gap at the 90-Day Target split", after90);
// AFTER: helper prepends the shared day-90 boundary point -> continuous line.
const bridged = GRQProjection.bridgeActualsAfter90(before90, after90);
const after = svg("After #592 — continuous actuals across day 90", bridged);

await Deno.writeTextFile("docs/evidence/issue-592-before.svg", before);
await Deno.writeTextFile("docs/evidence/issue-592-after.svg", after);
console.log("wrote docs/evidence/issue-592-before.svg and issue-592-after.svg");
console.log("after90 len:", after90.length, "bridged len:", bridged.length);
