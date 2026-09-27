// Tests for the DOM-free portfolio calculator split out of the GRQValidator
// god class (issue #881).
//
// docs/portfolio_calc.js publishes `GRQPortfolioCalc.PortfolioCalculator`,
// which reads its data from a plain `source` object. These tests drive the REAL
// shipped class with fixture sources — no DOM, no app.js source extraction —
// which is exactly what the split makes possible.

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import "../docs/projection.js";
import "../docs/volume_recommend.js";
import "../docs/portfolio_calc.js";

interface MarketPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

interface Dividend {
  exDivDate: Date;
  amount: number;
}

interface Source {
  marketData: Record<string, MarketPoint[]> | null;
  dividendData: Record<string, Dividend[]> | null;
  scoreData: { stock: string; score?: number; target?: number | null }[];
  analysisData: Record<string, { avgStars: number | null }> | null;
  selectedFile: string;
  costOfCapital: number;
  chartWindowDays: () => number;
}

interface Calculator {
  getScoreDate(file: string): Date;
  calculateStockPerformance(stock: { stock: string }): number | null;
  isStockPriceable(symbol: string, scoreDate: Date): boolean;
  calculatePortfolioPerformance90Day(): number;
  calculatePortfolioDividendYield(): number;
  calculatePortfolioTargetPercentage(): number;
  calculateCostOfCapitalData(): { x: Date; y: number }[];
  calculateHybridProjection(
    stock: { stock: string },
    scoreDate: Date,
  ): unknown;
}

const Calc = (globalThis as unknown as {
  GRQPortfolioCalc: {
    PortfolioCalculator: new (source: unknown) => Calculator;
  };
}).GRQPortfolioCalc;

function midnight(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function pt(date: string, price: number): MarketPoint {
  return {
    date: midnight(date),
    high: price,
    low: price,
    open: price,
    close: price,
    splitCoefficient: 1.0,
  };
}

// Score date 2026-01-01 (from the file name below), horizon 2026-04-01.
const FILE = "2026/January/01.tsv";
const SCORE = midnight("2026-01-01");

function source(overrides: Partial<Source> = {}): Source {
  return {
    marketData: {
      // +20% over the window.
      "NYSE:AAA": [pt("2026-01-02", 100), pt("2026-03-30", 120)],
      // -10% over the window.
      "NYSE:BBB": [pt("2026-01-02", 50), pt("2026-03-30", 45)],
    },
    dividendData: {},
    scoreData: [
      { stock: "NYSE:AAA", score: 0.5, target: 130 },
      { stock: "NYSE:BBB", score: 0.5, target: 55 },
    ],
    analysisData: null,
    selectedFile: FILE,
    costOfCapital: 10,
    chartWindowDays: () => 90,
    ...overrides,
  };
}

Deno.test("PortfolioCalculator is published on globalThis.GRQPortfolioCalc", () => {
  assertEquals(typeof Calc.PortfolioCalculator, "function");
});

Deno.test("PortfolioCalculator rejects a missing data source", () => {
  assertThrows(() => new Calc.PortfolioCalculator(null), TypeError);
  assertThrows(() => new Calc.PortfolioCalculator(undefined), TypeError);
});

Deno.test("getScoreDate parses the score file name to local midnight", () => {
  const calc = new Calc.PortfolioCalculator(source());
  assertEquals(calc.getScoreDate(FILE).getTime(), SCORE.getTime());
});

Deno.test("getScoreDate throws on a file name that is not a score file", () => {
  const calc = new Calc.PortfolioCalculator(source());
  assertThrows(() => calc.getScoreDate("not-a-score.csv"), Error, "Invalid");
});

Deno.test("calculateStockPerformance returns the 90-day total return", () => {
  const calc = new Calc.PortfolioCalculator(source());
  assertAlmostEquals(
    calc.calculateStockPerformance({ stock: "NYSE:AAA" })!,
    20,
  );
  assertAlmostEquals(
    calc.calculateStockPerformance({ stock: "NYSE:BBB" })!,
    -10,
  );
});

Deno.test("calculateStockPerformance is null for a stock with no market data", () => {
  const calc = new Calc.PortfolioCalculator(source());
  assertEquals(calc.calculateStockPerformance({ stock: "NYSE:ZZZ" }), null);
});

Deno.test("the calculator reads the source live, so a data reload is seen", () => {
  const src = source({ marketData: {} });
  const calc = new Calc.PortfolioCalculator(src);
  // Nothing priceable yet: the aggregate guard returns 0.
  assertEquals(calc.calculatePortfolioDividendYield(), 0);
  // The dashboard reassigns marketData after an async load.
  src.marketData = source().marketData;
  assertAlmostEquals(calc.calculatePortfolioPerformance90Day(), 5);
});

Deno.test("calculatePortfolioPerformance90Day is the equal-weight mean of included stocks", () => {
  const calc = new Calc.PortfolioCalculator(source());
  // (20 + -10) / 2 = 5.
  assertAlmostEquals(calc.calculatePortfolioPerformance90Day(), 5);
});

Deno.test("calculatePortfolioPerformance90Day drops negative-score and unpriceable stocks", () => {
  const calc = new Calc.PortfolioCalculator(source({
    scoreData: [
      { stock: "NYSE:AAA", score: 0.5 },
      { stock: "NYSE:BBB", score: -0.2 }, // predicts a fall: held as cash
      { stock: "NYSE:ZZZ", score: 0.5 }, // no market data: unpriceable
    ],
  }));
  assert(!calc.isStockPriceable("NYSE:BBB", SCORE));
  assert(!calc.isStockPriceable("NYSE:ZZZ", SCORE));
  assertAlmostEquals(calc.calculatePortfolioPerformance90Day(), 20);
});

Deno.test("calculatePortfolioPerformance90Day is 0 when nothing is included", () => {
  const calc = new Calc.PortfolioCalculator(source({ scoreData: [] }));
  assertEquals(calc.calculatePortfolioPerformance90Day(), 0);
});

Deno.test("calculatePortfolioDividendYield averages dividend ÷ buy price over included stocks", () => {
  const calc = new Calc.PortfolioCalculator(source({
    // $2 on a $100 buy price = 2%; BBB pays nothing = 0%. Mean = 1%.
    dividendData: {
      "NYSE:AAA": [{ exDivDate: midnight("2026-02-01"), amount: 2 }],
    },
  }));
  assertAlmostEquals(calc.calculatePortfolioDividendYield(), 1);
});

Deno.test("calculatePortfolioDividendYield ignores dividends beyond the 90-day window", () => {
  const calc = new Calc.PortfolioCalculator(source({
    dividendData: {
      "NYSE:AAA": [{ exDivDate: midnight("2026-06-01"), amount: 2 }],
    },
  }));
  assertEquals(calc.calculatePortfolioDividendYield(), 0);
});

Deno.test("calculatePortfolioTargetPercentage is the mean target over included stocks", () => {
  const calc = new Calc.PortfolioCalculator(source());
  // AAA: 130 vs 100 = +30%; BBB: 55 vs 50 = +10%. Mean = 20%.
  assertAlmostEquals(calc.calculatePortfolioTargetPercentage(), 20);
});

Deno.test("calculateCostOfCapitalData spans the source's chart window", () => {
  const market = {
    "NYSE:AAA": [
      pt("2026-01-02", 100),
      pt("2026-03-30", 120),
      pt(
        "2026-05-15",
        130,
      ),
    ],
  };
  const narrow = new Calc.PortfolioCalculator(source({
    marketData: market,
    scoreData: [{ stock: "NYSE:AAA" }],
    chartWindowDays: () => 90,
  })).calculateCostOfCapitalData();
  const wide = new Calc.PortfolioCalculator(source({
    marketData: market,
    scoreData: [{ stock: "NYSE:AAA" }],
    chartWindowDays: () => 180,
  })).calculateCostOfCapitalData();
  // 2026-05-15 is day 134: outside a 90-day window, inside a 180-day one.
  assert(narrow.every((p) => p.x <= midnight("2026-04-01")));
  assert(wide.some((p) => p.x.getTime() === midnight("2026-05-15").getTime()));
  // The hurdle rises with time.
  assert(wide[wide.length - 1].y > wide[0].y);
});

Deno.test("calculateHybridProjection is null for a stock with no market data", () => {
  const calc = new Calc.PortfolioCalculator(source());
  assertEquals(
    calc.calculateHybridProjection({ stock: "NYSE:ZZZ" }, SCORE),
    null,
  );
});
