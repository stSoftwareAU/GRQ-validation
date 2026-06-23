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

// Per-device chart/summary window (issue #367, milestone #333). The dashboard
// chart truncates its visible benchmark series to a fixed window measured from
// the score date — 90 days on mobile, 180 on desktop — so the "Market
// Performance Comparison" summary must end on the SAME date or the two can
// disagree in direction (chart down vs summary up). These pure helpers are the
// single source of truth for that window, shared by prepareChartData (the
// chart) and getMarketPerformanceData (the summary) so they cannot drift apart.
const MOBILE_WINDOW_DAYS = 90;
const DESKTOP_WINDOW_DAYS = 180;

// Days in the visible window for the current device.
function deviceWindowDays(isMobile) {
    return isMobile ? MOBILE_WINDOW_DAYS : DESKTOP_WINDOW_DAYS;
}

// The window's end date: scoreDate + (mobile 90 / desktop 180) days, at local
// midnight. Returns null when the score date is missing or unparseable so the
// caller renders blank rather than erroring (preserves blank-on-missing).
function deviceWindowEnd(scoreDate, isMobile) {
    if (scoreDate === null || scoreDate === undefined) return null;
    const start = setDateToMidnight(new Date(scoreDate));
    if (Number.isNaN(start.getTime())) return null;
    const days = deviceWindowDays(isMobile);
    return setDateToMidnight(
        new Date(start.getTime() + days * 24 * 60 * 60 * 1000),
    );
}

// Choose the default score file for the dashboard (issue #275).
//
// By default we select the nearest available score date ON OR BEFORE 90 days
// ago (the latest scoreDate <= today - 90 days). This deliberately avoids the
// old absolute-nearest logic, where a score a few days MORE recent than the
// 90-day target (e.g. 87 days ago) could wrongly win over the correct earlier
// date (e.g. 90/93 days ago).
//
// Only when no score date is on/before the target do we fall back to the
// earliest available date. `today` is passed in explicitly so the function is
// pure and deterministic (and unit-testable without a browser). Returns the
// chosen score object, or null when the list is empty/invalid.
function selectDefaultScore(scores, today) {
    if (!Array.isArray(scores) || scores.length === 0) {
        return null;
    }

    // Parse a "YYYY-MM-DD" score date as LOCAL midnight. Using new Date(str)
    // would parse it as UTC midnight, which skews the "on or before" calendar
    // comparison against the local-time target by a day in some timezones.
    const parseScoreDate = (value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
        if (match) {
            return new Date(
                Number(match[1]),
                Number(match[2]) - 1,
                Number(match[3]),
            ).getTime();
        }
        // Fallback for any unexpected format: normalise to local midnight.
        return setDateToMidnight(new Date(value)).getTime();
    };

    // Target = 90 days ago, normalised to local midnight for a date-only
    // "on or before" comparison.
    const target = setDateToMidnight(today);
    target.setDate(target.getDate() - 90); // 90 days ago
    const targetTime = target.getTime();

    let selected = null;
    let selectedTime = -Infinity;
    let earliest = null;
    let earliestTime = Infinity;

    scores.forEach((score) => {
        const scoreTime = parseScoreDate(score.date);

        // Track the earliest date for the no-match fallback.
        if (scoreTime < earliestTime) {
            earliestTime = scoreTime;
            earliest = score;
        }

        // Prefer the LATEST score date on or before the 90-day target.
        if (scoreTime <= targetTime && scoreTime > selectedTime) {
            selectedTime = scoreTime;
            selected = score;
        }
    });

    return selected !== null ? selected : earliest;
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

// Cost-of-capital hurdle as a percentage: the annual cost of capital pro-rated
// over the elapsed days. `daysElapsed` is already capped at 90 by the caller
// (≈ 2.5% at 10%/yr). Single source of truth for the hurdle shared by the
// per-stock "Return above Cost of Capital" column and the portfolio total
// (issue #407).
function costOfCapitalHurdle(costOfCapital, daysElapsed) {
    return (costOfCapital / 365) * daysElapsed;
}

// Return above the cost-of-capital hurdle: the realised return less the
// pro-rated hurdle. Reused by both the per-stock column and the portfolio
// total so the totals figure equals the mean of the per-stock figures
// (issue #407). Returns null when `performance` is null/undefined.
function returnAboveCostOfCapital(performance, costOfCapital, daysElapsed) {
    if (performance === null || performance === undefined) return null;
    return performance - costOfCapitalHurdle(costOfCapital, daysElapsed);
}

// Single source of truth for the "is this stock included?" rule (issue #288),
// mirroring the Rust backend's `is_priceable` predicate (src/utils.rs). A stock
// counts towards portfolio performance ONLY when it has BOTH a usable buy price
// AND a usable current price — both present and strictly greater than 0. If
// either is missing/non-positive (delisted, merged for cash, renamed), the
// stock is excluded entirely from all portfolio calculations. The numeric guard
// rejects null/undefined/NaN and string inputs so only real positive numbers
// count as usable.
function isStockIncluded(buyPrice, currentPrice) {
    const usable = (price) => typeof price === "number" && price > 0;
    return usable(buyPrice) && usable(currentPrice);
}

// Equal-weight portfolio performance over ONLY the included stocks (issue #288).
// Each stock object provides `buyPrice`, `currentPrice` and optional
// `totalDividends`. Excluded stocks (per isStockIncluded) are dropped entirely,
// so excluding one redistributes weight equally over the remainder — e.g. two
// of three included stocks are weighted 1/2 each, not 1/3. Returns the mean of
// the included total returns, or null when no stock is included (matching the
// dashboard's guard before reporting a portfolio figure). Mirrors the backend's
// equal-weight average of `total_return_percent` over priceable stocks.
function calculateIncludedPortfolioPerformance(stocks) {
    if (!Array.isArray(stocks)) {
        return null;
    }
    const includedReturns = [];
    for (const stock of stocks) {
        const buyPrice = stock && stock.buyPrice;
        const currentPrice = stock && stock.currentPrice;
        if (!isStockIncluded(buyPrice, currentPrice)) {
            continue;
        }
        const totalReturn = calculatePerformanceReturn(
            buyPrice,
            currentPrice,
            stock.totalDividends,
        );
        if (totalReturn === null) {
            continue;
        }
        includedReturns.push(totalReturn);
    }
    if (includedReturns.length === 0) {
        return null;
    }
    const sum = includedReturns.reduce((total, value) => total + value, 0);
    return sum / includedReturns.length;
}

// Dividend yield as a percentage of the buy price — the dividend-return
// component of the total return (issue #426). Mirrors the dividend term inside
// calculatePerformanceReturn so a "Dividends working" popover can never disagree
// with the Actual figure. Returns null when the buy price is missing or
// non-positive (the same guard the total return applies).
function dividendReturnPercent(buyPrice, totalDividends) {
    if (!buyPrice || buyPrice <= 0) {
        return null;
    }
    return ((totalDividends || 0) / buyPrice) * 100;
}

// Equal-weight portfolio dividend yield over ONLY the included stocks
// (issue #426). Mirrors calculateIncludedPortfolioPerformance exactly but
// averages each stock's dividend yield instead of its total return, so this
// figure equals the dividend-return component of the portfolio Actual figure.
// Returns null when no stock is included.
function calculateIncludedPortfolioDividendYield(stocks) {
    if (!Array.isArray(stocks)) {
        return null;
    }
    const includedYields = [];
    for (const stock of stocks) {
        const buyPrice = stock && stock.buyPrice;
        const currentPrice = stock && stock.currentPrice;
        if (!isStockIncluded(buyPrice, currentPrice)) {
            continue;
        }
        const yieldPercent = dividendReturnPercent(
            buyPrice,
            stock.totalDividends,
        );
        if (yieldPercent === null) {
            continue;
        }
        includedYields.push(yieldPercent);
    }
    if (includedYields.length === 0) {
        return null;
    }
    const sum = includedYields.reduce((total, value) => total + value, 0);
    return sum / includedYields.length;
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

// Trustworthy split-adjustment thresholds (issue #292, parent #272). Agreed in
// the #291 investigation — see docs/fixes/klac-split-distortion-investigation.md.
const MAX_PLAUSIBLE_COEFFICIENT = 10.0; // a single split of <= 10:1 is plausible
const DUPLICATE_WINDOW_DAYS = 5; // splits within 5 days = the same event twice
const MAX_CUMULATIVE_FACTOR = 50.0; // cumulative factor cap over the window
const RECONCILE_TOLERANCE = 0.15; // +/-15% price-ratio cross-check
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Compute the cumulative split adjustment from `historicalDate` to "now" AND
// judge whether it can be trusted — the single "correct-or-flag" place (issue
// #292). Pure: no DOM or class state. Returns `{ factor, reliable }` where:
//   - `factor` is the de-duplicated, plausibility-checked cumulative factor
//     (kept for diagnostics);
//   - `reliable` is false when the series cannot be reconciled, so callers must
//     NOT silently apply `factor` — treat an unreliable series as no split.
// Rules: de-duplicate split events recorded within DUPLICATE_WINDOW_DAYS; flag
// any single coefficient above MAX_PLAUSIBLE_COEFFICIENT; cap the cumulative
// factor at MAX_CUMULATIVE_FACTOR; and cross-check each split against the
// observed pre/post price drop (a real N:1 split divides the price ~N-fold).
function computeSplitAdjustment(marketData, historicalDate) {
    if (!marketData || marketData.length === 0) {
        return { factor: 1.0, reliable: true };
    }

    // Sorted copy so "the price immediately before a split" is well-defined
    // regardless of input order (the cumulative product is order-independent).
    const sorted = marketData
        .filter((p) => p && p.date instanceof Date && !isNaN(p.date.getTime()))
        .slice()
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    let factor = 1.0;
    let reliable = true;
    let lastEventTime = null; // ms of the last *kept* split, for de-duplication

    for (let i = 0; i < sorted.length; i++) {
        const point = sorted[i];
        const c = point.splitCoefficient;

        // Only splits strictly after the historical date adjust the buy price.
        if (!(point.date > historicalDate)) continue;

        // Invalid / non-split coefficients mean "no adjustment" (treat as 1.0)
        // and are not, by themselves, a reliability failure.
        if (typeof c !== "number" || !isFinite(c) || c <= 1.0) continue;

        // De-duplicate: a split within DUPLICATE_WINDOW_DAYS of the last kept
        // one is the same corporate event recorded twice — apply it once.
        if (
            lastEventTime !== null &&
            (point.date.getTime() - lastEventTime) <=
                DUPLICATE_WINDOW_DAYS * MS_PER_DAY
        ) {
            continue;
        }
        lastEventTime = point.date.getTime();

        // Implausibly large single coefficient: cannot trust unguarded.
        if (c > MAX_PLAUSIBLE_COEFFICIENT) {
            reliable = false;
        }

        // Price-ratio cross-check: compare the midpoint just before the split
        // with the split point's own (post-split) midpoint. Only checkable when
        // a prior point exists; absent one we keep the data-feed invariant.
        const prev = sorted[i - 1];
        if (prev) {
            const prevMid = (prev.high + prev.low) / 2;
            const splitMid = (point.high + point.low) / 2;
            if (isFinite(prevMid) && isFinite(splitMid) && splitMid > 0) {
                const observedRatio = prevMid / splitMid;
                if (Math.abs(observedRatio / c - 1) > RECONCILE_TOLERANCE) {
                    reliable = false;
                }
            }
        }

        factor *= c;
    }

    // Cumulative-factor plausibility bound: a larger factor almost certainly
    // means duplicated or spurious coefficients.
    if (factor > MAX_CUMULATIVE_FACTOR) {
        reliable = false;
    }

    return { factor, reliable };
}

// Cumulative split adjustment from a historical date to "now". Delegates to the
// validated `computeSplitAdjustment` and refuses to apply a factor it cannot
// reconcile — an unreliable series yields 1.0 (no adjustment) rather than a
// silently wrong, inflated factor (issue #292). A missing series means no known
// splits, so the factor is 1.0.
function getSplitAdjustment(marketData, historicalDate) {
    const { factor, reliable } = computeSplitAdjustment(
        marketData,
        historicalDate,
    );
    return reliable ? factor : 1.0;
}

// Restate a historical price in current (post-split) terms by dividing out the
// cumulative split adjustment. Uses the reliable factor only, so an
// unreconcilable split never over-divides the price (issue #292).
function adjustHistoricalPriceToCurrent(price, marketData, historicalDate) {
    return price / getSplitAdjustment(marketData, historicalDate);
}

// Resolve the buy price for a stock: the split-adjusted midpoint of the first
// trading day on or within five days after the score date. Returns
// `{ price, dateUsed, reliable }`, or null when no market data falls in that
// window. `reliable` mirrors `computeSplitAdjustment` so callers (and the
// inclusion predicate, #288) can surface — rather than silently apply — a split
// series that cannot be reconciled (issue #292).
function getBuyPrice(marketData, scoreDate) {
    if (!marketData) return null;

    const { reliable } = computeSplitAdjustment(marketData, scoreDate);

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
            return { price: adjustedPrice, dateUsed: candidateDate, reliable };
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

// Equal-weight portfolio target percentage over ONLY the included stocks
// (issue #429, lifted from docs/app.js so the dashboard chart and the trend
// view share ONE target calculation). Each stock object provides `buyPrice`,
// `currentPrice` and `adjustedTarget` (the model's 90-day target restated into
// current, post-split terms). Excluded stocks (per isStockIncluded) and stocks
// with no usable target are dropped; the result is the mean of the remaining
// per-stock target percentages, or the 20.0% default when none qualify (the
// same fallback the dashboard's totals row applies). Returns 20.0 for a missing
// or empty list so callers always have a usable figure.
function calculatePortfolioTargetPercentage(stocks) {
    if (!Array.isArray(stocks)) {
        return 20.0;
    }
    let totalTarget = 0;
    let validStocks = 0;
    for (const stock of stocks) {
        const buyPrice = stock && stock.buyPrice;
        const currentPrice = stock && stock.currentPrice;
        if (!isStockIncluded(buyPrice, currentPrice)) {
            continue;
        }
        const adjustedTarget = stock.adjustedTarget;
        if (
            adjustedTarget === null || adjustedTarget === undefined ||
            Number.isNaN(adjustedTarget)
        ) {
            continue;
        }
        const targetPercentage = calculateTargetPercentage(
            buyPrice,
            adjustedTarget,
        );
        if (targetPercentage !== null) {
            totalTarget += targetPercentage;
            validStocks++;
        }
    }
    return validStocks > 0 ? totalTarget / validStocks : 20.0;
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
// share one cascade. Returns a CSS *class* token (not an inline colour) so the
// colour is theme-aware via the cascade — the dark theme remaps the same class
// to a higher-contrast colour, meeting WCAG 2 AA in both themes (issue #281).
//
// Red ("danger") must signal a genuine problem, never sit next to a positive
// return (issue #299, part of #274): when the position is in profit
// (current >= buy) the target is never red — a target below the buy price there
// is simply already met by the market, not "bad". Red is reserved for a
// position that is underwater with a target that stays below entry.
//   - any input null -> '' (default colour, inherited)
//   - in profit (current >= buy): target above current -> 'price-good' (green),
//     otherwise -> 'price-neutral' (grey)
//   - underwater (current < buy) AND target below buy -> 'price-bad' (red)
//   - otherwise -> 'price-neutral' (grey)
function getTargetPriceColor(targetPrice, currentPrice, buyPrice) {
    if (targetPrice === null || currentPrice === null || buyPrice === null) {
        return ""; // Default colour (inherits)
    }

    // In profit (current at or above buy): the realised return is positive, so
    // the target must never read as danger (issue #299). Green when the target
    // still implies upside from here, grey when it is already met/below entry.
    if (currentPrice >= buyPrice) {
        return targetPrice > currentPrice ? "price-good" : "price-neutral";
    }

    // Underwater (current below buy): a target below the buy price means the
    // model expects the price to stay below entry - genuinely bad -> red.
    if (targetPrice < buyPrice) {
        return "price-bad";
    }

    // Underwater but the target is still above entry (recovery implied) -> grey.
    return "price-neutral";
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

    const sumXY = dataPoints.reduce((sum, point) => sum + point.x * point.y, 0);
    const sumXX = dataPoints.reduce((sum, point) => sum + point.x * point.x, 0);

    // Regression through the origin. Day 0 = 0% by definition (performance is
    // measured against the buy price on the score date), so the line must pass
    // through (0,0); the slope is the least-squares slope subject to that
    // anchor, minimising Σ(y − m·x)² which gives m = Σ(x·y) / Σ(x·x).
    const adjustedIntercept = 0;
    const adjustedSlope = sumXX !== 0 ? sumXY / sumXX : 0;

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
            // The parenthetical is the projected 90-day return: label it "proj."
            // so it cannot be read as the realised gain (issue #298).
            // Judge by the sign of the predicted return first: only a negative
            // projection is "Declining". A positive projection must never read
            // as declining (issue #297).
            if (predicted < 0) {
                return `Declining (proj. ${predicted.toFixed(1)}%)`;
            }
            // predicted >= 0 here. Guard the ratio against a non-positive
            // target: when the model 90-Day Target price sits below the buy
            // price the target return % is negative, and `predicted / target`
            // would flip a healthy positive projection's sign and mislabel it
            // as "Declining". Fall back to the sign of the projection instead.
            if (target <= 0) {
                return `On Track (proj. ${predicted.toFixed(1)}%)`;
            }
            const pctOfTarget = predicted / target;
            if (pctOfTarget >= 0.95) {
                return `On Track (proj. ${predicted.toFixed(1)}%)`;
            }
            // A positive projection short of target is below target, not
            // declining.
            return `Below Target (proj. ${predicted.toFixed(1)}%)`;
        }

        // Not enough data for a reliable projection: judge current performance.
        // The parenthetical is the return so far, not a projection: label it
        // "current" so the two figures cannot be confused (issue #298).
        const threshold = target * 0.8;
        if (daysElapsed < 30) {
            return performance > 0
                ? `Early Days (current +${performance.toFixed(1)}%)`
                : `Early Days (current ${performance.toFixed(1)}%)`;
        }
        // 30-60 and 60+ days share the same thresholds.
        if (performance >= threshold) {
            return `On Track (current ${performance.toFixed(1)}%)`;
        } else if (performance > 0) {
            return `Below Target (current ${performance.toFixed(1)}%)`;
        }
        return `Declining (current ${performance.toFixed(1)}%)`;
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
    deviceWindowDays,
    deviceWindowEnd,
    selectDefaultScore,
    getDaysElapsed,
    calculatePerformanceReturn,
    costOfCapitalHurdle,
    returnAboveCostOfCapital,
    isStockIncluded,
    calculateIncludedPortfolioPerformance,
    dividendReturnPercent,
    calculateIncludedPortfolioDividendYield,
    filterDividendsWithin90Days,
    sumDividends,
    buildHybridProjectionData,
    formatCurrency,
    computeSplitAdjustment,
    getSplitAdjustment,
    adjustHistoricalPriceToCurrent,
    getBuyPrice,
    currentPriceFromLatest,
    calculateTargetPercentage,
    calculatePortfolioTargetPercentage,
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
