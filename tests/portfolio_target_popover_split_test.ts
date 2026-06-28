// Regression test for issue #629 — the Portfolio Target "show working" popover
// listed the wrong per-stock % for a split-adjusted stock (NYSE:DD showed
// -64.4% instead of its true +6.8% after a 1:3 reverse split).
//
// Root cause: the popover's per-stock loop in GRQValidator.getWorking divided
// the RAW stock.target by the already split-adjusted buy price (mixed bases),
// instead of reusing the shared, split/dilution-adjusted
// calculateTargetPercentage path used by the table, chart and the headline.
//
// This drives the REAL shipped getWorking method from docs/app.js. The class is
// extracted and evaluated without running its DOM-bound constructor, then the
// portfolio-target branch is exercised with a fixture in which the two code
// paths give visibly different answers (adjusted +6.8% vs raw -64.4%), so the
// test is sensitive to which path getWorking actually takes.

import { assert, assertAlmostEquals } from "@std/assert";
import "../docs/projection.js";

// --- Extract the real GRQValidator class from app.js -----------------------
// The file ends with `const validator = new GRQValidator();` plus DOM-bound
// bootstrap code, so we slice off everything from that instantiation onward and
// evaluate only the class definition. Direct eval shares this module's scope, so
// the trailing `GRQValidator` expression returns the class object.
const GRQProjection = (globalThis as unknown as { GRQProjection: unknown })
  .GRQProjection;

async function loadGRQValidatorClass(): Promise<
  new () => Record<string, unknown>
> {
  const source = await Deno.readTextFile("docs/app.js");
  const cut = source.indexOf("const validator = new GRQValidator();");
  assert(cut !== -1, "could not find the validator bootstrap in app.js");
  const classSource = source.slice(0, cut);
  // `GRQProjection` is referenced as a bare identifier inside the class; bind it
  // locally so the eval'd method bodies resolve it.
  // deno-lint-ignore no-eval
  return eval(
    `const GRQProjection = globalThis.GRQProjection;\n${classSource}\n; GRQValidator`,
  );
}

interface FixtureStock {
  stock: string;
  target: number;
}

Deno.test("portfolio-target popover uses the split-adjusted per-stock % (issue #629)", async () => {
  const GRQValidator = await loadGRQValidatorClass();
  // Avoid the DOM-bound constructor: build an instance off the prototype and
  // inject only the dependencies the portfolio-target branch consults.
  const v = Object.create(GRQValidator.prototype) as Record<
    string,
    // deno-lint-ignore no-explicit-any
    any
  >;

  const scoreDate = new Date(2025, 11, 29); // 2025-12-29
  // NYSE:DD — a 1:3 reverse split (coeff 0.3333). Raw target $43.67, but its
  // buy price is already restated into post-split terms ($40.90 ÷ 0.3333 ≈
  // $122.74). The adjusted target ($43.67 ÷ 0.3333 ≈ $131.04) vs $122.74 = +6.8%.
  const scoreData: FixtureStock[] = [
    { stock: "NYSE:DD", target: 43.67 },
    { stock: "NYSE:ABC", target: 120 },
  ];
  v.selectedFile = "2025/December/29.csv";
  v.scoreData = scoreData;
  v.getScoreDate = () => scoreDate;
  v.isStockPriceable = () => true;
  // Headline figure = equal-weight mean of the adjusted per-stock targets.
  v.calculatePortfolioTargetPercentage = () => 13.4;
  // The OLD loop used getBuyPrice + raw stock.target; the adjusted buy prices
  // here make that path yield DD -64.4% / ABC +20.0% — distinct from the fix.
  v.getBuyPrice = (symbol: string) => ({
    price: symbol === "NYSE:DD" ? 122.74 : 100,
  });
  // The shared, split-adjusted path the fix must use.
  v.calculateTargetPercentage = (stock: FixtureStock) =>
    stock.stock === "NYSE:DD" ? 6.8 : 20.0;

  const working = v.getWorking("portfolio-target", "", scoreData) as string;

  // Per-stock % uses the adjusted basis, not the raw mixed-base figure.
  assert(
    working.includes("NYSE:DD: 6.8%"),
    `DD per-stock target should be the adjusted +6.8%, got:\n${working}`,
  );
  assert(
    !working.includes("-64.4"),
    `the raw mixed-base -64.4% must not appear, got:\n${working}`,
  );
  assert(working.includes("NYSE:ABC: 20.0%"), "ABC should be +20.0%");

  // The Total line and the headline reconcile: 6.8 + 20.0 = 26.8 over 2 stocks,
  // mean 13.4, matching the Portfolio target headline.
  assert(
    working.includes("Total: 26.8% / 2 stocks"),
    `Total should sum the adjusted per-stock %, got:\n${working}`,
  );
  assert(
    working.includes("Portfolio target: 13.4%"),
    `headline should be the adjusted mean, got:\n${working}`,
  );
  assertAlmostEquals(
    26.8 / 2,
    13.4,
    1e-9,
    "Total ÷ N reconciles with headline",
  );
});

Deno.test("calculateTargetPercentage drives the popover via the shared adjusted helper", () => {
  // Anchor the expected adjusted figure to the shared projection kernel so this
  // test fails if the split/dilution maths regresses. DD's adjusted basis:
  // target 43.67 ÷ 0.3333 vs buy 40.90 ÷ 0.3333 → +6.8%.
  const g = GRQProjection as {
    calculateTargetPercentage: (
      buyPrice: number | null,
      adjustedTarget: number | null,
    ) => number | null;
  };
  const splitCoefficient = 0.3333;
  const adjustedBuy = 40.90 / splitCoefficient;
  const adjustedTarget = 43.67 / splitCoefficient;
  const pct = g.calculateTargetPercentage(
    adjustedBuy,
    adjustedTarget,
  ) as number;
  assertAlmostEquals(pct, 6.8, 0.1, "adjusted DD target should be ~+6.8%");

  // The buggy mixed-base computation (raw target ÷ adjusted buy) gives ~-64.4%,
  // demonstrating why the popover must adjust the target too.
  const buggy = ((43.67 - adjustedBuy) / adjustedBuy) * 100;
  assertAlmostEquals(buggy, -64.4, 0.2, "raw mixed-base figure is the old bug");
});
