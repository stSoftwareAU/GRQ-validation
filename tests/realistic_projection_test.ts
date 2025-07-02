import { assertEquals } from "@std/assert";

interface ScoreData {
  stock: string;
  score: number;
  target: number;
  exDividendDate: string | null;
  dividendPerShare: number;
  notes: string;
  intrinsicValuePerShareBasic: number | null;
  intrinsicValuePerShareAdjusted: number | null;
}

interface MarketDataPoint {
  date: Date;
  high: number;
  low: number;
  open: number;
  close: number;
  splitCoefficient: number;
}

class MockGRQValidator {
  marketData: Record<string, MarketDataPoint[]> = {};
  dividendData: Record<string, unknown[]> = {};
  scoreData: ScoreData[] = [];
  selectedFile = "test.tsv";
  selectedStock: string | null = null;

  setupBehindTargetScenario(): void {
    // Setup a scenario where stock is significantly behind target
    // Current performance: 2% at 49 days, target: 50.8%
    this.marketData = {
      "NYSE:SEM": [
        {
          date: new Date("2025-05-14"), // Score date
          high: 100.0,
          low: 100.0,
          open: 100.0,
          close: 100.0,
          splitCoefficient: 1.0,
        },
        {
          date: new Date("2025-07-02"), // 49 days later
          high: 102.0,
          low: 102.0,
          open: 102.0,
          close: 102.0,
          splitCoefficient: 1.0,
        },
      ],
    };

    this.scoreData = [
      {
        stock: "NYSE:SEM",
        score: 0.8,
        target: 150.8, // Target price that gives 50.8% return
        exDividendDate: null,
        dividendPerShare: 0,
        notes: "",
        intrinsicValuePerShareBasic: null,
        intrinsicValuePerShareAdjusted: null,
      },
    ];
  }

  getScoreDate(): Date {
    return new Date("2025-05-14");
  }

  getDaysElapsed(): number {
    return 49; // 49 days elapsed
  }

  getBuyPrice(
    _stockSymbol: string,
    _scoreDate: Date,
  ): { price: number; dateUsed: Date } | null {
    return { price: 100.0, dateUsed: new Date("2025-05-14") };
  }

  calculateStockPerformance(_stock: ScoreData): number {
    return 2.0; // 2% performance
  }

  calculateTargetPercentage(_stock: ScoreData, _scoreDate: Date): number {
    return 50.8; // 50.8% target
  }

  calculateTrendLine(_stock: ScoreData, _scoreDate: Date): null {
    return null; // No trend line available
  }

  calculateHybridProjection(stock: ScoreData, scoreDate: Date) {
    const daysElapsed = this.getDaysElapsed();
    const currentPerformance = this.calculateStockPerformance(stock);
    const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);

    // Long-term: Use realistic projection based on current trajectory
    const projectionMethod = "realistic_trajectory";

    if (targetPercentage !== null) {
      // Calculate what the current trajectory suggests for 90 days
      const currentRate = currentPerformance / daysElapsed; // % per day
      const trajectoryProjection = currentRate * 90;

      // If we're significantly behind target, be realistic about missing it
      const remainingDays = 90 - daysElapsed;
      const remainingGap = targetPercentage - currentPerformance;
      const requiredDailyRate = remainingGap / remainingDays;

      let projected90DayPerformance: number;
      let confidence: number;

      // If required rate is unrealistic (>2% per day), project missing target
      if (requiredDailyRate > 2.0) {
        // Project based on current trajectory, but cap at a realistic maximum
        const realisticProjection = Math.min(
          trajectoryProjection,
          targetPercentage * 0.6,
        );
        projected90DayPerformance = Math.max(
          realisticProjection,
          currentPerformance * 1.2,
        ); // At least some improvement
        confidence = 0.7; // High confidence we're missing target
      } else {
        // Still possible to hit target, but be conservative
        projected90DayPerformance = Math.min(
          trajectoryProjection,
          targetPercentage * 0.8,
        );
        confidence = 0.6;
      }

      return {
        projected90DayPerformance,
        projectionMethod,
        confidence,
        daysElapsed,
        currentPerformance,
        targetPercentage,
      };
    }

    return null;
  }
}

Deno.test("Realistic Projection - Behind Target Scenario", async (t) => {
  const validator = new MockGRQValidator();
  validator.setupBehindTargetScenario();

  await t.step(
    "should project realistic performance when significantly behind target",
    () => {
      const stock = validator.scoreData[0];
      const scoreDate = validator.getScoreDate();
      const projection = validator.calculateHybridProjection(stock, scoreDate);

      // Verify projection exists
      assertEquals(projection !== null, true, "Should generate projection");
      if (!projection) return;

      // Verify projection method
      assertEquals(
        projection.projectionMethod,
        "realistic_trajectory",
        "Should use realistic trajectory method",
      );

      // Verify input values
      assertEquals(projection.daysElapsed, 49, "Should have 49 days elapsed");
      assertEquals(
        projection.currentPerformance,
        2.0,
        "Should have 2% current performance",
      );
      assertEquals(
        projection.targetPercentage,
        50.8,
        "Should have 50.8% target",
      );

      // Calculate expected values
      const currentRate = 2.0 / 49; // 0.0408% per day
      const trajectoryProjection = currentRate * 90; // 3.67%
      const remainingDays = 90 - 49; // 41 days
      const remainingGap = 50.8 - 2.0; // 48.8%
      const _requiredDailyRate = remainingGap / remainingDays; // 1.19% per day

      // Since required daily rate (1.19%) is not > 2.0%, it should use conservative projection
      const _expectedProjection = Math.min(trajectoryProjection, 50.8 * 0.8); // min(3.67%, 40.64%) = 3.67%

      // Verify projection is realistic (much lower than target)
      assertEquals(
        projection.projected90DayPerformance < 50.8,
        true,
        "Projection should be less than target",
      );
      assertEquals(
        projection.projected90DayPerformance > 2.0,
        true,
        "Projection should be higher than current performance",
      );
      assertEquals(
        projection.projected90DayPerformance < 10.0,
        true,
        "Projection should be realistic (< 10%)",
      );

      // Verify confidence
      assertEquals(
        projection.confidence,
        0.6,
        "Should have moderate confidence",
      );
    },
  );

  await t.step("should handle extremely behind target scenario", () => {
    // Modify to create an even worse scenario
    const stock = validator.scoreData[0];
    const scoreDate = validator.getScoreDate();

    // Mock even worse performance: 1% at 60 days with 50% target
    const originalCalculateStockPerformance =
      validator.calculateStockPerformance;
    validator.calculateStockPerformance = () => 1.0; // 1% performance
    validator.getDaysElapsed = () => 60; // 60 days elapsed

    const projection = validator.calculateHybridProjection(stock, scoreDate);

    // Restore original methods
    validator.calculateStockPerformance = originalCalculateStockPerformance;
    validator.getDaysElapsed = () => 49;

    assertEquals(projection !== null, true, "Should generate projection");
    if (!projection) return;

    // Calculate expected values for this scenario
    const currentRate = 1.0 / 60; // 0.0167% per day
    const trajectoryProjection = currentRate * 90; // 1.5%
    const remainingDays = 90 - 60; // 30 days
    const remainingGap = 50.8 - 1.0; // 49.8%
    const _requiredDailyRate = remainingGap / remainingDays; // 1.66% per day

    // Since required daily rate (1.66%) is not > 2.0%, it should use conservative projection
    const _expectedProjection = Math.min(trajectoryProjection, 50.8 * 0.8); // min(1.5%, 40.64%) = 1.5%

    // Verify projection is very low
    assertEquals(
      projection.projected90DayPerformance < 5.0,
      true,
      "Projection should be very low (< 5%)",
    );
    assertEquals(
      projection.projected90DayPerformance > 1.0,
      true,
      "Projection should be higher than current performance",
    );
  });

  await t.step("should handle unrealistic catch-up scenario", () => {
    // Modify to create a scenario where required daily rate > 2%
    const stock = validator.scoreData[0];
    const scoreDate = validator.getScoreDate();

    // Mock scenario: 1% at 80 days with 50% target (requires 2.45% per day)
    const originalCalculateStockPerformance =
      validator.calculateStockPerformance;
    const originalGetDaysElapsed = validator.getDaysElapsed;
    validator.calculateStockPerformance = () => 1.0; // 1% performance
    validator.getDaysElapsed = () => 80; // 80 days elapsed

    const projection = validator.calculateHybridProjection(stock, scoreDate);

    // Restore original methods
    validator.calculateStockPerformance = originalCalculateStockPerformance;
    validator.getDaysElapsed = originalGetDaysElapsed;

    assertEquals(projection !== null, true, "Should generate projection");
    if (!projection) return;

    // Calculate expected values for this scenario
    const currentRate = 1.0 / 80; // 0.0125% per day
    const trajectoryProjection = currentRate * 90; // 1.125%
    const remainingDays = 90 - 80; // 10 days
    const remainingGap = 50.8 - 1.0; // 49.8%
    const _requiredDailyRate = remainingGap / remainingDays; // 4.98% per day

    // Since required daily rate (4.98%) > 2.0%, it should use realistic projection
    const realisticProjection = Math.min(trajectoryProjection, 50.8 * 0.6); // min(1.125%, 30.48%) = 1.125%
    const expectedProjection = Math.max(realisticProjection, 1.0 * 1.2); // max(1.125%, 1.2) = 1.2

    // Verify projection is realistic and confidence is high
    assertEquals(
      projection.projected90DayPerformance,
      expectedProjection,
      "Should use realistic projection",
    );
    assertEquals(
      projection.confidence,
      0.7,
      "Should have high confidence for unrealistic catch-up",
    );
  });

  await t.step(
    "should return 'Declining' judgement for far behind target scenario",
    () => {
      // Simulate the judgement logic
      const stock = validator.scoreData[0];
      const scoreDate = validator.getScoreDate();
      const projection = validator.calculateHybridProjection(stock, scoreDate);
      if (!projection) throw new Error("No projection");
      const predicted = projection.projected90DayPerformance;
      const target = projection.targetPercentage || 20;
      const pctOfTarget = target === 0 ? 0 : predicted / target;
      console.log(
        "DEBUG: predicted=",
        predicted,
        "target=",
        target,
        "pctOfTarget=",
        pctOfTarget,
      );
      let judgement;
      if (predicted < 0 || pctOfTarget < 0.2) {
        judgement = `Declining (${predicted.toFixed(1)}%)`;
      } else if (pctOfTarget >= 0.95) {
        judgement = `On Track (${predicted.toFixed(1)}%)`;
      } else if (pctOfTarget >= 0.2) {
        judgement = `Below Target (${predicted.toFixed(1)}%)`;
      } else {
        judgement = `Declining (${predicted.toFixed(1)}%)`;
      }
      // Should be 'Declining' for this scenario
      if (!judgement.startsWith("Declining")) {
        throw new Error("Judgement should be 'Declining' for this scenario");
      }
    },
  );
});
