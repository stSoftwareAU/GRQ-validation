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

// Publish on globalThis so the browser dashboard (classic script) and the Deno
// test importer can both reach the helpers, mirroring docs/escape.js.
globalThis.GRQProjection = {
    setDateToMidnight,
    getDaysElapsed,
    calculatePerformanceReturn,
    buildHybridProjectionData,
};
