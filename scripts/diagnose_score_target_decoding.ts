// Diagnostic for issue #556 (milestone #544): confirm whether the score→target
// decoding `reverseProfitRecommend` adds a systematic bias to the dashboard's
// Target.
//
//   - The AI emits a score in [-1, 1]; the GRQ dashboard derives Target via
//     reverseProfitRecommend(price, score) (GRQ/src/portfolio/ScoreApp.ts:473,
//     defined in GRQ/src/LearnUtilTypes.ts:19-39).
//   - Forward (training) encode:  profitRecommend(pct) = tanh((pct - 1.5) / 3).
//   - Reverse (dashboard) decode: pct = 3*atanh(score) + 1.5, then
//     target = price * (1 + pct/100), with clamps score>=1 → +50%,
//     score<=-1 → target 0, interior pct capped to ±50%.
//
// In the interior tanh/atanh are exact inverses, so the round-trip is the
// identity; the clamps are asymmetric (a 0/-100% floor vs a +50% cap). This
// script feeds the REALISED score distribution through
// profitRecommend ∘ reverseProfitRecommend, measures the round-trip Target shift
// (pp, with sign), and takes a census of how often scores land in each clamped
// region — isolating the clamp contribution.
//
// Run: deno run --allow-read scripts/diagnose_score_target_decoding.ts \
//        [docsPath] [asOf] [all]
//   docsPath default "docs"; asOf default today (YYYY-MM-DD to pin);
//   pass "all" as the third arg to include not-yet-matured score dates.
// Read-only; prints a Markdown-friendly report.

import { computeDecodingDiagnostic } from "./score_target_decoding_diagnostic.ts";

const docsPath = Deno.args[0] ?? "docs";
const asOf = Deno.args[1] ? new Date(Deno.args[1]) : new Date();
const maturedOnly = (Deno.args[2] ?? "") !== "all";

const report = await computeDecodingDiagnostic(docsPath, asOf, maturedOnly);

const pp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(6)} pp`;
const pct = (n: number) => `${n.toFixed(3)} %`;

console.log(
  `# Score→target decoding (reverseProfitRecommend) diagnostic — issue #556\n`,
);
console.log(`As-of date:            ${asOf.toISOString().slice(0, 10)}`);
console.log(
  `Score set:             ${maturedOnly ? "matured only" : "all dates"}`,
);
console.log(`Score dates:           ${report.scoreDates}`);
console.log(`Score rows:            ${report.scoreRows}`);
console.log("");
console.log(
  `## Round-trip Target shift (profitRecommend ∘ reverseProfitRecommend)`,
);
console.log(`Mean:                  ${pp(report.shift.mean)}`);
console.log(`Median:                ${pp(report.shift.median)}`);
console.log(`Min:                   ${pp(report.shift.min)}`);
console.log(`Max:                   ${pp(report.shift.max)}`);
console.log(`Std dev:               ${report.shift.stdDev.toFixed(6)} pp`);
console.log("");
console.log(`## Clamp-region census (realised scores)`);
for (const c of report.census) {
  console.log(
    `${c.region.padEnd(20)} ${String(c.count).padStart(6)}  ` +
      `${(c.fraction * 100).toFixed(2)} %`,
  );
}
console.log("");
console.log(`Mean decoded return:   ${pct(report.meanDecodedPct)}`);
console.log(
  `Saturated rows (==1):  ${report.saturatedRows} (${
    (report.fractionCapHigh * 100).toFixed(2)
  } %)`,
);
console.log(
  `Floor rows (<=-1):     ${
    Math.round(report.fractionFloorLow * report.scoreRows)
  } (${(report.fractionFloorLow * 100).toFixed(2)} %)`,
);
console.log("");
console.log(report.verdict);
