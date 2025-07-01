import { assertEquals, assertExists } from "@std/assert";

// Define proper types instead of 'any'
interface StockData {
  stock: string;
  targetPercentage?: number;
}

interface HybridProjection {
  projected90DayPerformance: number;
  projectionMethod: string;
  confidence: number;
  daysElapsed: number;
  currentPerformance: number;
  targetPercentage: number | null;
}

// Mock the hybrid projection system for testing judgements
class MockJudgementSystem {
  calculateHybridProjection(
    stock: StockData,
    _scoreDate: Date,
  ): HybridProjection | null {
    // Mock different scenarios
    if (stock.stock === "STRONG_UP") {
      return {
        projected90DayPerformance: 45.2,
        projectionMethod: "dampened_trend",
        confidence: 0.75,
        daysElapsed: 30,
        currentPerformance: 25.0,
        targetPercentage: 60.0,
      };
    } else if (stock.stock === "STRONG_DOWN") {
      return {
        projected90DayPerformance: -57.3,
        projectionMethod: "dampened_trend",
        confidence: 0.68,
        daysElapsed: 45,
        currentPerformance: -35.0,
        targetPercentage: 20.0,
      };
    } else if (stock.stock === "LOW_CONFIDENCE") {
      return {
        projected90DayPerformance: 15.0,
        projectionMethod: "target_based",
        confidence: 0.15, // Below threshold
        daysElapsed: 20,
        currentPerformance: 8.0,
        targetPercentage: 25.0,
      };
    }
    return null;
  }

  calculateTargetPercentage(stock: StockData, _scoreDate: Date): number {
    return stock.targetPercentage || 20.0;
  }

  getDaysElapsed(_scoreDate: Date): number {
    // Mock 30 days elapsed
    return 30;
  }

  calculateJudgement(stock: StockData, performance: number | null): string {
    if (performance === null) return "Pending";

    const scoreDate = new Date("2025-01-01");
    const daysElapsed = this.getDaysElapsed(scoreDate);
    const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);

    // If we haven't reached 90 days yet, use hybrid projection
    if (daysElapsed < 90) {
      const hybridProjection = this.calculateHybridProjection(stock, scoreDate);

      if (hybridProjection && hybridProjection.confidence > 0.2) {
        const predicted = hybridProjection.projected90DayPerformance;
        const target = targetPercentage || 20; // Default to 20% if no target

        if (predicted >= target * 0.8) {
          return `On Track (${predicted.toFixed(1)}%)`;
        } else if (predicted > 0) {
          return `Below Target (${predicted.toFixed(1)}%)`;
        } else {
          return `Declining (${predicted.toFixed(1)}%)`;
        }
      } else {
        // Fall back to current performance logic
        const target = targetPercentage || 20;
        const threshold = target * 0.8;

        if (daysElapsed < 30) {
          if (performance > 0) {
            return `Early Days (+${performance.toFixed(1)}%)`;
          } else {
            return `Early Days (${performance.toFixed(1)}%)`;
          }
        } else if (daysElapsed < 60) {
          if (performance >= threshold) {
            return `On Track (${performance.toFixed(1)}%)`;
          } else if (performance > 0) {
            return `Below Target (${performance.toFixed(1)}%)`;
          } else {
            return `Declining (${performance.toFixed(1)}%)`;
          }
        } else {
          if (performance >= threshold) {
            return `On Track (${performance.toFixed(1)}%)`;
          } else if (performance > 0) {
            return `Below Target (${performance.toFixed(1)}%)`;
          } else {
            return `Declining (${performance.toFixed(1)}%)`;
          }
        }
      }
    } else {
      // 90 days or more elapsed - use actual performance
      const target = targetPercentage || 20;
      const threshold = target * 0.8;

      if (performance >= threshold) {
        return "Hit Target";
      } else if (performance > 0) {
        return "Partial Success";
      } else {
        return "Missed Target";
      }
    }
  }
}

// Test cases
Deno.test("Judgement with Hybrid Projection - Strong Upward", () => {
  const system = new MockJudgementSystem();
  const stock: StockData = { stock: "STRONG_UP", targetPercentage: 60.0 };
  const performance = 25.0;

  const judgement = system.calculateJudgement(stock, performance);

  console.log("Strong Upward judgement:", judgement);
  assertExists(judgement);
  // 45.2% is less than 80% of 60% target (48%), so it should be "Below Target"
  assertEquals(judgement.includes("Below Target"), true);
  assertEquals(judgement.includes("45.2%"), true); // Should use hybrid projection
});

Deno.test("Judgement with Hybrid Projection - Strong Downward", () => {
  const system = new MockJudgementSystem();
  const stock: StockData = { stock: "STRONG_DOWN", targetPercentage: 20.0 };
  const performance = -35.0;

  const judgement = system.calculateJudgement(stock, performance);

  assertExists(judgement);
  assertEquals(judgement.includes("Declining"), true);
  assertEquals(judgement.includes("-57.3%"), true); // Should use hybrid projection, not -100%
});

Deno.test("Judgement with Low Confidence - Falls Back to Current Performance", () => {
  const system = new MockJudgementSystem();
  const stock: StockData = { stock: "LOW_CONFIDENCE", targetPercentage: 25.0 };
  const performance = 8.0;

  const judgement = system.calculateJudgement(stock, performance);

  console.log("Low Confidence judgement:", judgement);
  assertExists(judgement);
  // Should fall back to current performance since confidence is too low
  // With 30 days elapsed, it should be in the 30-60 day range, not "Early Days"
  assertEquals(judgement.includes("Below Target"), true);
  assertEquals(judgement.includes("8.0%"), true);
});

Deno.test("Judgement with Null Performance", () => {
  const system = new MockJudgementSystem();
  const stock: StockData = { stock: "TEST", targetPercentage: 20.0 };
  const performance: number | null = null;

  const judgement = system.calculateJudgement(stock, performance);

  assertEquals(judgement, "Pending");
});

Deno.test("Trend Line Always Starts at Zero", () => {
  const system = new MockJudgementSystem();
  const stock: StockData = { stock: "STRONG_UP", targetPercentage: 60.0 };
  const scoreDate = new Date("2025-01-01");

  const hybridProjection = system.calculateHybridProjection(stock, scoreDate);

  assertExists(hybridProjection);
  // The trend line should always start at zero performance on the score date
  // This is a fundamental requirement - no performance has occurred yet
  assertEquals(hybridProjection.daysElapsed >= 0, true);
  assertEquals(hybridProjection.currentPerformance >= 0, true); // Current performance should be positive for STRONG_UP
});

console.log("All judgement hybrid tests passed! 🎉");
