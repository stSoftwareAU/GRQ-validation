// Shared projection and scoring maths for the dashboard (issue #80).
//
// The dashboard's projection/scoring algorithms used to live only inside the
// `GRQValidator` class in docs/app.js, where the TypeScript tests could not
// reach them. The tests therefore reimplemented the algorithms as local
// `Mock*` classes and asserted on the copy — tautologies that stayed green
// even if app.js drifted or broke.
//
// These helpers extract the pure mathematical kernels so that BOTH the browser
// dashboard (via `GRQValidator`) and the Deno tests exercise the exact same
// code. The module mirrors docs/escape.js: it is loaded as a classic <script>
// in docs/index.html and imported by the Deno tests, uses no module syntax,
// and publishes its helpers on `globalThis`.

// Set a date to local midnight (00:00:00.000). Returns a fresh Date so callers
// never mutate the input.
function setDateToMidnight(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

// Calendar days elapsed between a score date and a reference date (today).
// `today` is passed in explicitly so the function is pure and deterministic.
function getDaysElapsed(scoreDate, today) {
    const diffTime = Math.abs(today.getTime() - scoreDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Total percentage return = price return + dividend return, relative to the
// buy price. Returns null when the buy price is missing or non-positive (the
// same guard the dashboard applies before reporting a performance figure).
function calculatePerformanceReturn(buyPrice, currentPrice, totalDividends) {
    if (!buyPrice || buyPrice <= 0) {
        return null;
    }
    const dividends = totalDividends || 0;
    const priceReturn = ((currentPrice - buyPrice) / buyPrice) * 100;
    const dividendReturn = (dividends / buyPrice) * 100;
    return priceReturn + dividendReturn;
}

// Dividends whose ex-dividend date falls on or before the 90-day validation
// window measured from the score date. Pure given the dividend list and score
// date; the dashboard's GRQValidator looks the list up per stock and delegates
// here so production and tests share one window filter (issue #145).
function filterDividendsWithin90Days(dividends, scoreDate) {
    const ninetyDayDate = new Date(
        scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
    );
    return (dividends || []).filter((dividend) =>
        dividend.exDivDate <= ninetyDayDate
    );
}

// Sum the cash amount of a dividend list. Returns 0 for an empty or missing
// list, mirroring the dashboard's per-stock dividend-return summation.
function sumDividends(dividends) {
    return (dividends || []).reduce((sum, div) => sum + div.amount, 0);
}

// Build the weekly trend-data series for a hybrid projection chart.
//
// `projection` is the result of GRQValidator.calculateHybridProjection (its
// projectionMethod selects the curve shape); `scoreDate` anchors day 0; and
// `trendLine` is the linear-regression result (only consulted for the
// "dampened_trend" method, where it may be null). The series always starts at
// day 0 and ends exactly at day 90, with weekly points in between. Returns an
// array of `{ x: Date, y: number }` points.
function buildHybridProjectionData(projection, scoreDate, trendLine) {
    const trendData = [];

    // Day offset from the score date, snapped to midnight to match chart axes.
    const getDayDate = (base, day) =>
        setDateToMidnight(
            new Date(base.getTime() + day * 24 * 60 * 60 * 1000),
        );

    // Append the exact 90-day endpoint when the weekly loop stops short of it.
    const ensureNinetyDayPoint = (yAt90) => {
        const lastPoint = trendData[trendData.length - 1];
        const lastPointDay = (lastPoint.x.getTime() - scoreDate.getTime()) /
            (24 * 60 * 60 * 1000);
        if (lastPointDay !== 90) {
            trendData.push({ x: getDayDate(scoreDate, 90), y: yAt90 });
        }
    };

    if (projection.projectionMethod === "dampened_trend") {
        if (trendLine) {
            const dampenFactor = projection.daysElapsed < 30 ? 0.3 : 0.5;
            const dampenedSlope = trendLine.slope * dampenFactor;
            for (let day = 0; day <= 90; day += 7) {
                trendData.push({
                    x: getDayDate(scoreDate, day),
                    y: Math.max(dampenedSlope * day, -100),
                });
            }
            ensureNinetyDayPoint(Math.max(dampenedSlope * 90, -100));
        }
    } else if (projection.projectionMethod === "realistic_trajectory") {
        const current = projection.currentPerformance;
        const daysElapsed = projection.daysElapsed;
        for (let day = 0; day <= 90; day += 7) {
            let predictedPerformance;
            if (day <= daysElapsed) {
                // Linear interpolation up to the current observation.
                predictedPerformance = (current / daysElapsed) * day;
            } else {
                // Extrapolate toward the projected 90-day figure.
                predictedPerformance = projection.projected90DayPerformance *
                    (day / 90);
            }
            predictedPerformance = Math.max(
                Math.min(predictedPerformance, 200),
                -100,
            );
            trendData.push({
                x: getDayDate(scoreDate, day),
                y: predictedPerformance,
            });
        }
        ensureNinetyDayPoint(projection.projected90DayPerformance);
    } else {
        // Target-based or mean-reversion: linear ramp from zero to the
        // projected 90-day performance.
        const projected90DayPerformance = projection.projected90DayPerformance;
        for (let day = 0; day <= 90; day += 7) {
            const progress = Math.min(day / 90, 1);
            const predictedPerformance = projected90DayPerformance * progress;
            trendData.push({
                x: getDayDate(scoreDate, day),
                y: Math.max(Math.min(predictedPerformance, 200), -100),
            });
        }
        ensureNinetyDayPoint(projected90DayPerformance);
    }

    return trendData;
}

// Format a numeric value as a USD currency string, mirroring the dashboard's
// table rendering. Returns "N/A" for null/undefined/NaN so callers never show a
// broken figure. Pure: no DOM or class state.
function formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) {
        return "N/A";
    }
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

// Cumulative split adjustment from a historical date to "now". Walks the stock's
// market data and multiplies every split (splitCoefficient > 1.0) recorded after
// `historicalDate`. A missing series means no known splits, so the factor is 1.0.
function getSplitAdjustment(marketData, historicalDate) {
    if (!marketData) return 1.0;
    let cumulativeSplit = 1.0;
    for (const point of marketData) {
        if (point.date > historicalDate && point.splitCoefficient > 1.0) {
            cumulativeSplit *= point.splitCoefficient;
        }
    }
    return cumulativeSplit;
}

// Restate a historical price in current (post-split) terms by dividing out the
// cumulative split adjustment.
function adjustHistoricalPriceToCurrent(price, marketData, historicalDate) {
    return price / getSplitAdjustment(marketData, historicalDate);
}

// Resolve the buy price for a stock: the split-adjusted midpoint of the first
// trading day on or within five days after the score date. Returns
// `{ price, dateUsed }`, or null when no market data falls in that window.
function getBuyPrice(marketData, scoreDate) {
    if (!marketData) return null;

    for (let offset = 0; offset <= 5; offset++) {
        const candidateDate = new Date(scoreDate.getTime());
        candidateDate.setDate(candidateDate.getDate() + offset);
        const candidateData = marketData.find((point) => {
            const pointDate = new Date(
                point.date.getFullYear(),
                point.date.getMonth(),
                point.date.getDate(),
            );
            return pointDate.getTime() === candidateDate.getTime();
        });
        if (candidateData) {
            const adjustedPrice = adjustHistoricalPriceToCurrent(
                (candidateData.high + candidateData.low) / 2,
                marketData,
                scoreDate,
            );
            return { price: adjustedPrice, dateUsed: candidateDate };
        }
    }
    return null;
}

// Latest observed price = midpoint of the most recent market-data point (already
// post-split). Returns null when there is no data.
function currentPriceFromLatest(marketData) {
    if (!marketData || marketData.length === 0) return null;
    const lastData = marketData[marketData.length - 1];
    return (lastData.high + lastData.low) / 2;
}

// Target return as a percentage of the buy price. Returns null when either input
// is missing, matching the dashboard's guard before reporting a target figure.
function calculateTargetPercentage(buyPrice, adjustedTarget) {
    if (buyPrice !== null && adjustedTarget !== null) {
        return ((adjustedTarget - buyPrice) / buyPrice) * 100;
    }
    return null;
}

// Fair-value display band for a stock's analysis. Pure given the analysis
// object so the dashboard (via GRQValidator) and the Deno tests share one set
// of branch rules (issue #204):
//   - both MS Fair Value and Tips Target present  -> { low, high, type: 'range' }
//   - only one present -> { value, type: 'single', source } for that source
//   - neither present, or no analysis -> null
function getFairValueRange(analysis) {
    if (!analysis) {
        return null;
    }

    const { msFairValue, tipsTarget } = analysis;

    // If we have both values, show range
    if (msFairValue !== null && tipsTarget !== null) {
        const low = Math.min(msFairValue, tipsTarget);
        const high = Math.max(msFairValue, tipsTarget);
        return { low, high, type: "range" };
    } // If we have only one value, show single target
    else if (msFairValue !== null) {
        return { value: msFairValue, type: "single", source: "MS Fair Value" };
    } else if (tipsTarget !== null) {
        return { value: tipsTarget, type: "single", source: "Tips Target" };
    }

    return null;
}

// Inline CSS colour for a target-price cell, encoding the user-facing display
// rules (issue #204). Pure given the three prices so the dashboard and tests
// share one cascade:
//   - any input null -> '' (default colour)
//   - target below buy price -> red (always bad)
//   - target above current AND in profit (current >= buy) -> green (good)
//   - otherwise -> grey (neutral)
function getTargetPriceColor(targetPrice, currentPrice, buyPrice) {
    if (targetPrice === null || currentPrice === null || buyPrice === null) {
        return ""; // Default color
    }

    // Red (Danger): Target price is below buy price - this is always bad
    if (targetPrice < buyPrice) {
        return "color: #dc3545; font-weight: bold;"; // Red - danger
    }

    // Green (Good): Target price is above current price AND we're in profit territory
    if (targetPrice > currentPrice && currentPrice >= buyPrice) {
        return "color: #28a745; font-weight: bold;"; // Green - good
    }

    // Gray (Neutral): Target price is above buy price but we're either:
    // - Below current price (target achieved), or
    // - Current price is below buy price (we're in loss territory but target is still above buy price)
    return "color: #6c757d; font-weight: bold;"; // Gray - neutral
}

// Coefficient of determination (R²) for a linear fit y = slope·x + intercept over
// the data points. Returns 0 when the data has no variance.
function calculateRSquared(dataPoints, slope, intercept) {
    const n = dataPoints.length;
    const meanY = dataPoints.reduce((sum, point) => sum + point.y, 0) / n;

    let ssRes = 0; // Sum of squared residuals.
    let ssTot = 0; // Total sum of squares.
    dataPoints.forEach((point) => {
        const predicted = slope * point.x + intercept;
        ssRes += Math.pow(point.y - predicted, 2);
        ssTot += Math.pow(point.y - meanY, 2);
    });

    return ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
}

// Linear-regression trend line over `{ x: daysSinceScore, y: totalReturn }`
// points. The line is forced through the origin (intercept 0) so day 0 reads 0%,
// the 90-day prediction is floored at -100%, and R² measures the fit. Returns
// null when fewer than three points are available (too few for a meaningful fit).
function computeTrendLine(dataPoints) {
    if (!dataPoints || dataPoints.length < 3) {
        return null;
    }

    const n = dataPoints.length;
    const sumX = dataPoints.reduce((sum, point) => sum + point.x, 0);
    const sumY = dataPoints.reduce((sum, point) => sum + point.y, 0);
    const sumXY = dataPoints.reduce((sum, point) => sum + point.x * point.y, 0);
    const sumXX = dataPoints.reduce((sum, point) => sum + point.x * point.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Force the line through zero on the score date (x = 0 -> y = 0).
    const adjustedIntercept = 0;
    const adjustedSlope = slope;

    const predicted90DayPerformance = adjustedSlope * 90 + adjustedIntercept;
    // Cannot lose more than 100% of the investment.
    const cappedPredicted90DayPerformance = Math.max(
        predicted90DayPerformance,
        -100,
    );
    const rSquared = calculateRSquared(
        dataPoints,
        adjustedSlope,
        adjustedIntercept,
    );

    return {
        slope: adjustedSlope,
        intercept: adjustedIntercept,
        predicted90DayPerformance: cappedPredicted90DayPerformance,
        dataPoints,
        rSquared,
    };
}

// Build the regression input for a stock's trend line: one
// `{ x: daysSinceScore, y: totalReturn }` per market-data point inside the
// window from the score date to `endDate`. When `endDate` is omitted the window
// runs to the LATEST market-data date (not today's date), so the trend reflects
// observed data only. Each y combines the split-adjusted price move against the
// buy price with dividends paid up to that point. Pure given its inputs; the
// dashboard's GRQValidator gathers the inputs and delegates here (issue #144).
function buildTrendLineDataPoints(
    marketData,
    scoreDate,
    buyPrice,
    dividends,
    endDate,
) {
    if (!marketData || marketData.length === 0) return [];

    const scoreDateTimestamp = scoreDate.getTime();
    // Default to the latest market-data date, never today's date.
    const trendEndDate = endDate || marketData[marketData.length - 1].date;
    const dividendList = dividends || [];

    const dataPoints = [];
    marketData.forEach((point) => {
        if (point.date >= scoreDate && point.date <= trendEndDate) {
            const daysSinceScore = (point.date.getTime() - scoreDateTimestamp) /
                (1000 * 60 * 60 * 24);
            const currentPrice = adjustHistoricalPriceToCurrent(
                (point.high + point.low) / 2,
                marketData,
                point.date,
            );

            // Performance including dividends paid up to this point.
            const priceReturn =
                ((currentPrice - buyPrice) / buyPrice) * 100;
            const dividendsUpToDate = dividendList.filter(
                (d) => d.exDivDate <= point.date,
            );
            const totalDividends = sumDividends(dividendsUpToDate);
            const dividendReturn = (totalDividends / buyPrice) * 100;

            dataPoints.push({
                x: daysSinceScore,
                y: priceReturn + dividendReturn,
            });
        }
    });
    return dataPoints;
}

// Days elapsed from the score date to the latest market-data date, capped at 90
// (the validation window). Pure given the two dates.
function daysElapsedFromMarketData(scoreDate, latestMarketDate) {
    const diffTime = Math.abs(latestMarketDate - scoreDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.min(diffDays, 90);
}

// The hybrid 90-day projection decision tree. Given the gathered inputs
// (days elapsed, current performance, target percentage, and — for the short and
// medium horizons — the regression trend line), it selects a projection method
// and figure plus a confidence. This is the pure scoring kernel; the dashboard's
// GRQValidator gathers the inputs (market data, buy price, dividends) and
// delegates the maths here so production and tests share one implementation.
function computeHybridProjection(
    { daysElapsed, currentPerformance, targetPercentage, trendLine },
) {
    let projected90DayPerformance;
    let projectionMethod;
    let confidence;

    if (daysElapsed < 30) {
        // Short-term: dampened trend to temper early volatility.
        projectionMethod = "dampened_trend";
        if (trendLine && trendLine.rSquared > 0.1) {
            const dampenedSlope = trendLine.slope * 0.3; // Dampen by 70%.
            projected90DayPerformance = Math.max(dampenedSlope * 90, -100);
            confidence = Math.min(trendLine.rSquared * 0.7, 0.8);
        } else {
            // Fall back to a target-anchored projection.
            projectionMethod = "target_based";
            if (targetPercentage !== null) {
                if (currentPerformance > 0) {
                    const gap = targetPercentage - currentPerformance;
                    projected90DayPerformance = currentPerformance + gap * 0.1;
                } else {
                    projected90DayPerformance = currentPerformance * 0.5;
                }
                projected90DayPerformance = Math.max(
                    Math.min(projected90DayPerformance, targetPercentage),
                    -100,
                );
            } else {
                projected90DayPerformance = -5;
            }
            confidence = 0.3;
        }
    } else if (daysElapsed < 60) {
        // Medium-term: dampened trend with higher confidence.
        projectionMethod = "dampened_trend";
        if (trendLine && trendLine.rSquared > 0.05) {
            const dampenedSlope = trendLine.slope * 0.5; // Dampen by 50%.
            projected90DayPerformance = Math.max(dampenedSlope * 90, -100);
            confidence = Math.min(trendLine.rSquared * 0.8, 0.9);
        } else {
            projectionMethod = "target_based";
            if (targetPercentage !== null) {
                if (currentPerformance > 0) {
                    const gap = targetPercentage - currentPerformance;
                    projected90DayPerformance = currentPerformance + gap * 0.15;
                } else {
                    projected90DayPerformance = currentPerformance * 0.6;
                }
                projected90DayPerformance = Math.max(
                    Math.min(projected90DayPerformance, targetPercentage),
                    -100,
                );
            } else {
                projected90DayPerformance = -5;
            }
            confidence = 0.5;
        }
    } else {
        // Long-term: extrapolate the current trajectory toward the target.
        projectionMethod = "realistic_trajectory";
        if (targetPercentage !== null) {
            const currentRate = currentPerformance / daysElapsed; // % per day.
            const trajectoryProjection = currentRate * 90;
            const remainingDays = 90 - daysElapsed;
            const remainingGap = targetPercentage - currentPerformance;
            const requiredDailyRate = remainingGap / remainingDays;

            if (requiredDailyRate > 2.0) {
                // Catch-up rate is unrealistic: project a miss.
                const realisticProjection = Math.min(
                    trajectoryProjection,
                    targetPercentage * 0.6,
                );
                projected90DayPerformance = Math.max(
                    realisticProjection,
                    currentPerformance * 1.2,
                );
                confidence = 0.7;
            } else if (currentPerformance > targetPercentage) {
                // Already above target: trust the trajectory.
                projected90DayPerformance = trajectoryProjection;
                confidence = 0.7;
            } else {
                // Target still reachable, but stay conservative.
                projected90DayPerformance = Math.min(
                    trajectoryProjection,
                    targetPercentage * 0.8,
                );
                confidence = 0.6;
            }
        } else {
            // No target: mean-revert toward 0% performance.
            const reversionRate = 0.4;
            projected90DayPerformance = currentPerformance * (1 - reversionRate);
            confidence = 0.3;
        }
    }

    // Keep the figure within realistic bounds.
    projected90DayPerformance = Math.max(
        Math.min(projected90DayPerformance, 200),
        -100,
    );

    return { projected90DayPerformance, projectionMethod, confidence };
}

// Map a stock's performance to a human-readable judgement string. Before day 90
// it leans on the hybrid projection (when confident enough), otherwise on the
// current performance against 80% of target; from day 90 it reports the realised
// outcome. This is the pure scoring kernel the dashboard's GRQValidator gathers
// inputs for and delegates to.
function computeJudgement(
    { performance, daysElapsed, targetPercentage, projection },
) {
    if (performance === null) return "Pending";

    const target = targetPercentage || 20; // Default to 20% if no target.

    if (daysElapsed < 90) {
        if (projection && projection.confidence > 0.2) {
            const predicted = projection.projected90DayPerformance;
            const pctOfTarget = target === 0 ? 0 : predicted / target;
            if (predicted < 0 || pctOfTarget < 0.2) {
                return `Declining (${predicted.toFixed(1)}%)`;
            } else if (pctOfTarget >= 0.95) {
                return `On Track (${predicted.toFixed(1)}%)`;
            } else if (pctOfTarget >= 0.2) {
                return `Below Target (${predicted.toFixed(1)}%)`;
            }
            return `Declining (${predicted.toFixed(1)}%)`;
        }

        // Not enough data for a reliable projection: judge current performance.
        const threshold = target * 0.8;
        if (daysElapsed < 30) {
            return performance > 0
                ? `Early Days (+${performance.toFixed(1)}%)`
                : `Early Days (${performance.toFixed(1)}%)`;
        }
        // 30-60 and 60+ days share the same thresholds.
        if (performance >= threshold) {
            return `On Track (${performance.toFixed(1)}%)`;
        } else if (performance > 0) {
            return `Below Target (${performance.toFixed(1)}%)`;
        }
        return `Declining (${performance.toFixed(1)}%)`;
    }

    // 90 days or more elapsed: report the realised outcome.
    const threshold = target * 0.8;
    if (performance >= threshold) return "Hit Target";
    if (performance > 0) return "Partial Success";
    return "Missed Target";
}

// Build a benchmark index series from a same-origin {date: close} price map
// (issue #93). The dashboard reads first-party benchmark data published under
// docs/ instead of routing Yahoo Finance requests through untrusted public CORS
// proxies, so this kernel does the slicing and shaping the proxy path used to.
//
// `priceMap` is a plain object of "YYYY-MM-DD" -> closing price. The series is
// filtered to [startDate, endDate] (inclusive, at local midnight) and sorted
// ascending by date, returning the same shape the chart consumes:
// { name, data: [{ date, close }], initialPrice, currentPrice }. Pure and
// deterministic so the Deno tests exercise the exact browser code.
function buildIndexSeriesFromMap(priceMap, indexName, startDate, endDate) {
    if (!priceMap || typeof priceMap !== "object") return null;

    const start = setDateToMidnight(new Date(startDate)).getTime();
    const end = setDateToMidnight(new Date(endDate)).getTime();

    const data = [];
    for (const [dateStr, close] of Object.entries(priceMap)) {
        if (typeof close !== "number" || !Number.isFinite(close)) continue;
        const date = setDateToMidnight(new Date(dateStr));
        const time = date.getTime();
        if (Number.isNaN(time) || time < start || time > end) continue;
        data.push({ date, close });
    }

    data.sort((a, b) => a.date.getTime() - b.date.getTime());

    return {
        name: indexName,
        data,
        initialPrice: data.length > 0 ? data[0].close : null,
        currentPrice: data.length > 0 ? data[data.length - 1].close : null,
    };
}

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// test importer can both reach the helpers, mirroring docs/escape.js.
globalThis.GRQProjection = {
    setDateToMidnight,
    getDaysElapsed,
    calculatePerformanceReturn,
    filterDividendsWithin90Days,
    sumDividends,
    buildHybridProjectionData,
    formatCurrency,
    getSplitAdjustment,
    adjustHistoricalPriceToCurrent,
    getBuyPrice,
    currentPriceFromLatest,
    calculateTargetPercentage,
    getFairValueRange,
    getTargetPriceColor,
    calculateRSquared,
    computeTrendLine,
    buildTrendLineDataPoints,
    daysElapsedFromMarketData,
    computeHybridProjection,
    computeJudgement,
    buildIndexSeriesFromMap,
};
