// Portfolio and per-stock calculation module (issue #881).
//
// The DOM-free calculation half of the dashboard, split out of the GRQValidator
// god class in docs/app.js: score-date parsing, buy prices and split
// restatement, 90-day returns and their dividend breakdown, the portfolio
// aggregates (performance, target, dividend yield, cost of capital), the trend
// and hybrid projections, the inclusion gates and the judgement. docs/app.js
// keeps the DOM wiring and rendering and reaches every figure through
// `validator.calc`.
//
// The calculator owns no state. It reads the loaded data LIVE from a `source`
// object — the GRQValidator in the browser, a plain fixture object in the Deno
// tests — so a reload in app.js is seen on the next call with no re-sync.
// The source provides: marketData, dividendData, scoreData, analysisData,
// selectedFile, costOfCapital and chartWindowDays() (the visible chart window
// in days, the one device-dependent input).
//
// Like docs/projection.js this is a PURE classic script: no module syntax, the
// class is published on `globalThis`, so the browser and the Deno tests run the
// exact same code. It calls GRQProjection, GRQVolume and (when loaded)
// GRQStarFilter, so load it after those scripts.

class PortfolioCalculator {
    constructor(source) {
        if (!source || typeof source !== "object") {
            throw new TypeError("PortfolioCalculator needs a data source object");
        }
        this.source = source;
    }

    // Live views onto the source's loaded data.
    get marketData() {
        return this.source.marketData;
    }

    get dividendData() {
        return this.source.dividendData;
    }

    get scoreData() {
        return this.source.scoreData;
    }

    get analysisData() {
        return this.source.analysisData;
    }

    get selectedFile() {
        return this.source.selectedFile;
    }

    get costOfCapital() {
        return this.source.costOfCapital;
    }

    chartWindowDays() {
        return this.source.chartWindowDays();
    }

    calculatePortfolioData() {
        console.log("calculatePortfolioData called");
        console.log("calculatePortfolioData - marketData available:", !!this.marketData);
        if (this.marketData) {
            console.log("calculatePortfolioData - marketData stocks:", Object.keys(this.marketData));
        }
        
        const scoreDate = this.getScoreDate(this.selectedFile);
        // Dividend markers span the VISIBLE chart window, matching the credit
        // the series now carries past day 90 (issue #817).
        const windowEndDate = new Date(
            scoreDate.getTime() + (this.chartWindowDays() * 24 * 60 * 60 * 1000),
        );
        const portfolioData = [];

        // Get all unique dates from market data (include all dates, not just 90 days)
        const allDates = new Set();
        if (this.marketData) {
            this.scoreData.forEach((stock) => {
                const marketData = this.marketData[stock.stock];
                if (marketData) {
                    marketData.forEach((point) => {
                        // Include all dates, not just within 90 days
                        allDates.add(point.date.getTime());
                    });
                }
            });
        } else {
            console.log("calculatePortfolioData - no marketData available, cannot calculate portfolio performance");
        }

        // Add the score date to ensure we start at zero
        allDates.add(scoreDate.getTime());

        const sortedDates = Array.from(allDates).sort((a, b) => a - b);
        console.log("calculatePortfolioData - unique dates found:", sortedDates.length);

        // Simple debug: Check if dividend data is loaded
        console.log("Dividend data loaded:", !!this.dividendData);
        if (this.dividendData) {
            console.log(
                "Stocks with dividends:",
                Object.keys(this.dividendData),
            );
        }

        sortedDates.forEach((timestamp) => {
            const date = new Date(timestamp);
            let totalPerformance = 0;
            let validStocks = 0;

            this.scoreData.forEach((stock) => {
                const marketData = this.marketData[stock.stock];
                if (marketData) {
                    const dataPoint = marketData.find(
                        (point) => point.date.getTime() === timestamp,
                    );

                    // Calculate buy price using market data on score date
                    const scoreDate = this.getScoreDate(this.selectedFile);
                    // Exclude unpriceable stocks entirely (issue #289): a stock
                    // with no usable buy/current price must not drag the
                    // portfolio series (and the shared trend line) down or
                    // inject NaN from a null buy price. The remaining included
                    // stocks are re-weighted by averaging over validStocks.
                    if (!this.isStockPriceable(stock.stock, scoreDate)) {
                        return;
                    }
                    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
                    const buyPrice = buyPriceObj ? buyPriceObj.price : null;
                    const buyPriceDateUsed = buyPriceObj ? buyPriceObj.dateUsed : null;
                    const target = this.adjustHistoricalPriceToCurrent(
                        stock.target,
                        stock.stock,
                        scoreDate,
                    );

                    if (dataPoint) {
                        // Use split-adjusted price for current price calculation
                        const currentPrice = this
                            .adjustHistoricalPriceToCurrent(
                                (dataPoint.high + dataPoint.low) / 2,
                                stock.stock,
                                dataPoint.date,
                            );

                        // Credit the dividends gone ex by this date, taken from
                        // the VISIBLE chart window (issue #817) rather than a
                        // fixed 90 days — otherwise the 180-day view plots a
                        // day-91-to-180 ex-date price fall with no offsetting
                        // credit. Points on or before day 90 are unaffected.
                        const dividends = this.getDividendsWithinChartWindow(
                            stock.stock,
                        );
                        const totalDividends = GRQProjection.sumDividendsToDate(
                            dividends,
                            date,
                        );

                        // Total return (price + dividends) via the shared
                        // projection kernel (issue #424) so the chart, the
                        // summary and the portfolio mean can never disagree.
                        // Honour the helper's null guard (buyPrice <= 0) the
                        // same way the summary path does.
                        const totalReturn = GRQProjection
                            .calculatePerformanceReturn(
                                buyPrice,
                                currentPrice,
                                totalDividends,
                            );

                        if (totalReturn !== null) {
                            totalPerformance += totalReturn;
                            validStocks++;
                        }
                    } else if (timestamp === scoreDate.getTime()) {
                        // For the score date, performance is 0%
                        validStocks++;
                        // totalPerformance remains 0
                    }
                }
            });

            if (validStocks > 0) {
                const portfolioPoint = {
                    x: new Date(date.getTime()), // Create clean Date object
                    y: totalPerformance / validStocks,
                };

                // Check if this is an ex-dividend date for any stock
                const dividendsOnDate = [];
                if (this.dividendData) {
                    Object.entries(this.dividendData).forEach(
                        ([stock, dividends]) => {
                            dividends.forEach((d) => {
                                // Only mark dividends inside the visible window
                                if (d.exDivDate <= windowEndDate) {
                                    const dDateOnly = new Date(
                                        d.exDivDate.getFullYear(),
                                        d.exDivDate.getMonth(),
                                        d.exDivDate.getDate(),
                                    );
                                    const pointDateOnly = new Date(
                                        date.getFullYear(),
                                        date.getMonth(),
                                        date.getDate(),
                                    );

                                    if (
                                        dDateOnly.getTime() ===
                                            pointDateOnly.getTime()
                                    ) {
                                        dividendsOnDate.push(
                                            `${stock}: $${d.amount.toFixed(2)}`,
                                        );
                                    }
                                }
                            });
                        },
                    );
                }
                if (dividendsOnDate.length > 0) {
                    portfolioPoint.dividend = dividendsOnDate.join(", ");
                    console.log(
                        "Found ex-dividend date:",
                        date.toDateString(),
                        "with dividends:",
                        dividendsOnDate,
                    );
                }

                portfolioData.push(portfolioPoint);
            }
        });

        console.log(
            "Portfolio data points with dividends:",
            portfolioData.filter((p) => p.dividend).length,
        );

        return portfolioData;
    }

    calculateCostOfCapitalData() {
        // Per-device visible window, shared with the chart and summary via the
        // single source of truth (issue #367) — the user's per-device 90/180
        // toggle choice (issue #449, #466): both default to 180 (issue #711).
        const maxDays = this.chartWindowDays();
        const maxDate = new Date(
            this.getScoreDate(this.selectedFile).getTime() + (maxDays * 24 * 60 * 60 * 1000)
        );

        const scoreDate = this.getScoreDate(this.selectedFile);

        // Get all unique dates from market data (limited to the visible window).
        const allDates = new Set();
        this.scoreData.forEach((stock) => {
            const marketData = this.marketData[stock.stock];
            if (marketData) {
                marketData.forEach((point) => {
                    // Only include dates within the visible window.
                    if (point.date <= maxDate) {
                        allDates.add(point.date.getTime());
                    }
                });
            }
        });

        const sortedDates = Array.from(allDates)
            .sort((a, b) => a - b)
            .map((timestamp) => new Date(timestamp));

        // Accrue the hurdle to the end of the visible window with NO 90-day cap
        // (issue #717): the chart line keeps rising (~4.9% at day 180 for
        // 10%/yr) rather than running flat after day 90. The 90-day cap on the
        // judgement metrics is intentional and lives elsewhere.
        return GRQProjection.calculateCostOfCapitalSeries(
            scoreDate,
            sortedDates,
            this.costOfCapital,
        );
    }

    getDividendsWithin90Days(stockSymbol) {
        // Window filtering lives in the shared projection module (issue #145)
        // so production and the Deno tests exercise the same kernel.
        const dividends = this.dividendData?.[stockSymbol] || [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        return GRQProjection.filterDividendsWithin90Days(dividends, scoreDate);
    }

    // Dividends inside the VISIBLE chart window, for the chart series only
    // (issue #817). The 90-day filter above still governs every judged figure
    // (Gain/Loss, Judgement, the tables and their workings), but a 180-day chart
    // that filtered at 90 days plotted the ex-date price fall of a day-91-to-180
    // dividend with no offsetting credit — SITC's US$1.00 special dividend
    // (ex 2026-08-03) read ~17 pp too low on every prediction dated day 91-180
    // before it.
    getDividendsWithinChartWindow(stockSymbol) {
        const dividends = this.dividendData?.[stockSymbol] || [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        return GRQProjection.filterDividendsWithinDays(
            dividends,
            scoreDate,
            this.chartWindowDays(),
        );
    }

    calculateProgressVsCostOfCapitalValue(stock, performance) {
        if (performance === null) return null;

        // Use market data-based days elapsed for cost of capital calculation to match working
        const daysElapsed = this.getDaysElapsedFromMarketData(this.getScoreDate(this.selectedFile));

        // Subtract the shared cost-of-capital hurdle (issue #407) so the
        // per-stock column and the portfolio total use one hurdle definition.
        return GRQProjection.returnAboveCostOfCapital(
            performance,
            this.costOfCapital,
            daysElapsed,
        );
    }

    // Portfolio Return above Cost of Capital = average Gain/Loss − shared hurdle
    // (issue #407). Reuses the equal-weighted average Gain/Loss and the same
    // single hurdle applied per-stock, so this total equals the mean of the
    // per-stock "Return above Cost of Capital" values shown in that column.
    calculatePortfolioReturnAboveCostOfCapital() {
        const portfolioPerformance90Day = this
            .calculatePortfolioPerformance90Day();
        return this.calculateProgressVsCostOfCapitalValue(
            null,
            portfolioPerformance90Day,
        );
    }

    calculateJudgement(stock, performance) {
        if (performance === null) return "Pending";

        const scoreDate = this.getScoreDate(this.selectedFile);
        const daysElapsed = this.getDaysElapsed(scoreDate);
        const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);

        // Before day 90 the judgement leans on the hybrid projection; gather it
        // so the shared kernel (issue #100) can apply the decision thresholds.
        const projection = daysElapsed < 90
            ? this.calculateHybridProjection(stock, scoreDate)
            : null;

        return GRQProjection.computeJudgement({
            performance,
            daysElapsed,
            targetPercentage,
            projection,
        });
    }

    getScoreDate(scoreFile) {
        // Extract date from filename like "2025/June/20.tsv"
        const match = scoreFile.match(/(\d{4})\/(\w+)\/(\d+)\.tsv/);
        if (match) {
            const [, year, month, day] = match;
            const monthIndex = new Date(`${month} 1, ${year}`)
                .getMonth();
            const date = new Date(parseInt(year), monthIndex, parseInt(day));
            return this.setDateToMidnight(date);
        }
        throw new Error("Invalid score file: " + scoreFile);
    }

    // Helper function to set dates to midnight to avoid timezone issues
    setDateToMidnight(date) {
        // return date;
        const newDate = new Date(date);
        newDate.setHours(0, 0, 0, 0);
        return newDate;
    }

    getDaysElapsed(scoreDate) {
        // Delegate to the shared projection module (issue #80) so the browser
        // and the Deno tests exercise identical maths.
        return GRQProjection.getDaysElapsed(scoreDate, new Date());
    }

    // New method to calculate days elapsed based on actual market data availability
    getDaysElapsedFromMarketData(scoreDate) {
        if (!this.marketData || Object.keys(this.marketData).length === 0) {
            // Fall back to calendar days if no market data
            return this.getDaysElapsed(scoreDate);
        }

        // Find the latest market data date across all stocks
        let latestMarketDate = scoreDate;
        
        this.scoreData.forEach((stock) => {
            const marketData = this.marketData[stock.stock];
            if (marketData && marketData.length > 0) {
                const stockLatestDate = marketData[marketData.length - 1].date;
                if (stockLatestDate > latestMarketDate) {
                    latestMarketDate = stockLatestDate;
                }
            }
        });

        // Day-count maths (capped at 90) lives in the shared projection module
        // (issue #100).
        return GRQProjection.daysElapsedFromMarketData(
            scoreDate,
            latestMarketDate,
        );
    }

    calculateStockPerformance(stock) {
        const marketData = this.marketData[stock.stock];
        if (!marketData || marketData.length === 0) return null;

        const scoreDate = this.getScoreDate(this.selectedFile);

        // Price at the 90-day validation horizon (issue #539) — the basis the
        // whole tool compares against, never today's live price. Read on the
        // buy price's CURRENT split basis (issue #569): when a reconcilable
        // split falls between the horizon and the series end, the raw horizon
        // midpoint sits on a different split basis than the restated buy price,
        // inflating/deflating the return. horizonPriceCurrentBasis divides that
        // post-horizon factor out so both prices share one basis.
        const currentPrice = GRQProjection.horizonPriceCurrentBasis(
            marketData,
            scoreDate,
        );
        if (currentPrice === null) return null;

        // Get the price on the score date as the buy price (adjusted to current price level)
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        if (!buyPriceObj || !buyPriceObj.price || buyPriceObj.price <= 0) {
            return null;
        }
        const buyPrice = buyPriceObj.price;

        // Add dividend return within 90 days
        const dividends = this.getDividendsWithin90Days(stock.stock);
        const totalDividends = dividends.reduce(
            (sum, div) => sum + div.amount,
            0,
        );

        // Total return (price + dividends) via the shared projection module
        // (issue #80) so production and tests share one implementation.
        return GRQProjection.calculatePerformanceReturn(
            buyPrice,
            currentPrice,
            totalDividends,
        );
    }

    calculatePortfolioTargetPercentage() {
        // Portfolio target = equal-weight mean of the included stocks' target
        // percentages. The maths lives in the shared projection module
        // (issue #429) so the dashboard chart and the trend view call ONE
        // function. Build the per-stock inputs via the shared
        // buildPortfolioTargetStocks() helper, then delegate; the shared helper
        // applies the same inclusion gate (issue #289) and 20.0% fallback.
        return GRQProjection.calculatePortfolioTargetPercentage(
            this.buildPortfolioTargetStocks(),
        );
    }

    // Build the per-stock {buyPrice, currentPrice, score, adjustedTarget, stock}
    // inputs for the shared portfolio-target helpers (issue #429, #629). Single
    // source of truth so the headline (calculatePortfolioTargetPercentage) and
    // the "show the working" popover (calculatePortfolioTargetWorking) consume
    // IDENTICAL inputs — the popover per-stock %, its Total and the headline
    // reconcile by construction. The target is the split/dilution-adjusted value
    // (current basis), never the raw `stock.target`.
    buildPortfolioTargetStocks() {
        const scoreDate = this.getScoreDate(this.selectedFile);
        // Apply the active minimum-star filter (issue #655) here too: the target
        // dot recomputes over the SAME filtered subset as the table and the
        // chart performance line. This path builds raw inputs for the shared
        // projection kernel rather than going through isStockPriceable, so the
        // star gate is applied explicitly. With the filter off every stock
        // passes and the target is unchanged.
        const includedStocks = this.scoreData.filter((stock) =>
            this.meetsStarFilter(stock.stock)
        );
        return includedStocks.map((stock) => {
            const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
            const hasTarget = stock.target !== null && !isNaN(stock.target);
            return {
                stock: stock.stock,
                buyPrice: buyPriceObj ? buyPriceObj.price : null,
                currentPrice: GRQProjection.currentPriceFromLatest(
                    this.marketData[stock.stock],
                ),
                // Raw AI model score so the shared gate can drop negative-score
                // names from the equal-weight target average (issue #627).
                score: stock.score,
                adjustedTarget: hasTarget
                    ? this.adjustHistoricalPriceToCurrent(
                        stock.target,
                        stock.stock,
                        scoreDate,
                    )
                    : null,
            };
        });
    }

    isStockLowVolume(stockSymbol, scoreDate) {
        const series = this.marketData ? this.marketData[stockSymbol] : null;
        if (!series) {
            return false;
        }
        const window = GRQVolume.buildTrailingVolumeWindow(series, scoreDate);
        return GRQVolume.isLowVolume(window);
    }

    // Volume-capped prediction score (issue #578): folds low volume into the
    // valuation so an illiquid name can never surface as a strong recommendation,
    // mirroring GRQ training's Math.min(volumeRecommend, priceRecommend, 1). Falls
    // back to the raw score when volume is unknown (no market data loaded, or a
    // pre-volume-column CSV), matching the exclusion path's "insufficient data ⇒
    // not flagged" rule. The shared #576 helper is the single source of truth.
    volumeCappedScore(stockSymbol, baseScore, scoreDate) {
        const series = this.marketData ? this.marketData[stockSymbol] : null;
        if (!series) {
            return baseScore;
        }
        const window = GRQVolume.buildTrailingVolumeWindow(series, scoreDate);
        return GRQVolume.volumeCappedScore(baseScore, window);
    }

    isStockPriceable(stockSymbol, scoreDate) {
        const buyPriceObj = this.getBuyPrice(stockSymbol, scoreDate);
        const buyPrice = buyPriceObj ? buyPriceObj.price : null;
        const currentPrice = GRQProjection.currentPriceFromLatest(
            this.marketData[stockSymbol],
        );
        // Negative-score names are excluded too (issue #627): a raw AI model
        // score <= 0 predicts a fall, so we would hold cash. Look the raw score
        // up from the loaded score data and feed it through the same single
        // inclusion gate; an unknown score never excludes.
        const scoreRecord = (this.scoreData || []).find(
            (s) => s.stock === stockSymbol,
        );
        const score = scoreRecord ? scoreRecord.score : null;
        // Low-volume names are excluded from the portfolio and from EVERY
        // aggregate (issue #577): this single gate feeds the chart Actual /
        // "Actual (After 90 Days)" line, the totals row and the dividend
        // figures, so an illiquid name neither helps nor hurts any of them.
        return GRQProjection.isStockIncluded(
            buyPrice,
            currentPrice,
            buyPriceObj ? buyPriceObj.reliable !== false : true,
            this.isStockLowVolume(stockSymbol, scoreDate),
            score,
        ) && this.meetsStarFilter(stockSymbol);
    }

    // Whether a stock clears the active minimum-star filter (issue #655). The
    // shared GRQStarFilter threshold (foundation #654) is 0 ("All"/off) or a
    // whole star 1–5. With the filter off every stock passes, so this gate is a
    // no-op and the portfolio view is byte-for-byte unchanged. When a threshold
    // is active a stock passes only when its combined star rating
    // (analysisData[ticker].avgStars, populated by loadAnalysisData) is at least
    // the threshold; a missing entry or a null/undefined avgStars (no rating) is
    // excluded. Folded into isStockPriceable so the SAME filtered set feeds the
    // holdings table and every aggregate (chart line, target dot, trend line,
    // totals row) — no divergence between the numbers and the table.
    meetsStarFilter(stockSymbol) {
        const minStars =
            (typeof GRQStarFilter !== "undefined" &&
                    typeof GRQStarFilter.getMinStars === "function")
                ? GRQStarFilter.getMinStars()
                : 0;
        const analysis = this.analysisData
            ? this.analysisData[stockSymbol]
            : null;
        const avgStars = analysis ? analysis.avgStars : null;
        return GRQProjection.meetsStarThreshold(avgStars, minStars);
    }

    calculatePortfolioPerformance90Day() {
        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        );

        let totalPerformance = 0;
        let validStocks = 0;

        this.scoreData.forEach((stock) => {
            // Exclude unpriceable stocks from the totals row (issue #289); the
            // remaining included stocks are re-weighted by averaging over
            // validStocks only.
            if (!this.isStockPriceable(stock.stock, scoreDate)) {
                return;
            }
            const marketData = this.marketData[stock.stock];
            if (marketData) {
                // Find the price at 90 days (or closest available date)
                let ninetyDayData = null;

                // First try to find exact 90-day date
                ninetyDayData = marketData.find((point) => {
                    const pointDate = new Date(
                        point.date.getFullYear(),
                        point.date.getMonth(),
                        point.date.getDate(),
                    );
                    const targetDate = new Date(
                        ninetyDayDate.getFullYear(),
                        ninetyDayDate.getMonth(),
                        ninetyDayDate.getDate(),
                    );
                    return pointDate.getTime() === targetDate.getTime();
                });

                // If not found, find the closest date within 90 days
                if (!ninetyDayData) {
                    const within90Days = marketData.filter((point) =>
                        point.date <= ninetyDayDate
                    );
                    if (within90Days.length > 0) {
                        // Get the latest data point within 90 days
                        ninetyDayData = within90Days[within90Days.length - 1];
                    }
                }

                if (ninetyDayData) {
                    // Use centralized method for performance calculation
                    const performance = this.calculateStockPerformanceWithDilution(stock, scoreDate);
                    
                    if (performance !== null) {
                        totalPerformance += performance;
                        validStocks++;
                    }
                }
            }
        });

        return validStocks > 0 ? totalPerformance / validStocks : 0;
    }

    getHistoricalToCurrentSplitAdjustment(
        stockSymbol,
        historicalDate,
    ) {
        // Split-adjustment maths lives in the shared projection module
        // (issue #100).
        return GRQProjection.getSplitAdjustment(
            this.marketData[stockSymbol],
            historicalDate,
        );
    }

    adjustHistoricalPriceToCurrent(
        price,
        stockSymbol,
        historicalDate,
    ) {
        return GRQProjection.adjustHistoricalPriceToCurrent(
            price,
            this.marketData[stockSymbol],
            historicalDate,
        );
    }

    getBuyPrice(stockSymbol, scoreDate) {
        // Buy-price resolution (5-day forward search + split adjustment) lives
        // in the shared projection module (issue #100).
        return GRQProjection.getBuyPrice(
            this.marketData[stockSymbol],
            scoreDate,
        );
    }

    // Date of the first split this stock's series cannot reconcile, or null
    // when the series is trustworthy (issue #831). The chart stops the actuals
    // there and flags it, instead of plotting raw prices across an unadjusted
    // split.
    unreconciledSplitDate(stockSymbol, scoreDate) {
        if (!this.marketData) return null;
        return GRQProjection.unreconciledSplitDate(
            this.marketData[stockSymbol],
            scoreDate,
        );
    }

    // Centralized method to calculate target percentage with proper stock dilution handling
    calculateTargetPercentage(stock, scoreDate) {
        const buyPrice = this.getBuyPrice(stock.stock, scoreDate);
        const adjustedTarget = this.adjustHistoricalPriceToCurrent(
            stock.target,
            stock.stock,
            scoreDate
        );

        // Target-percentage maths lives in the shared projection module
        // (issue #100).
        return GRQProjection.calculateTargetPercentage(
            buyPrice !== null ? buyPrice.price : null,
            adjustedTarget,
        );
    }

    // Decompose a stock's 90-day total return into its price and dividend
    // components (issue #426). Single source of truth for both the totals-row
    // Actual/Dividends figures and their "show-the-working" popovers, so a
    // popover can never disagree with the plotted/summarised value. Returns null
    // when the stock has no usable market data or buy price.
    getStockReturnBreakdown(stock, scoreDate) {
        const marketData = this.marketData[stock.stock];
        if (!marketData || marketData.length === 0) return null;

        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        );

        // Find the last price within 90 days
        const within90Days = marketData.filter((point) =>
            point.date <= ninetyDayDate
        );
        if (within90Days.length === 0) return null;

        // Read the horizon midpoint on the CURRENT (end-of-series) split basis
        // that getBuyPrice uses for the buy price (issue #569). Reading it RAW
        // while dividing by a current-basis buy price leaves a spurious split
        // factor in the Actual whenever a reconcilable split falls between the
        // 90-day horizon and the end of the data series; horizonPriceCurrentBasis
        // divides that factor out so both prices share one basis.
        const currentPrice = GRQProjection.horizonPriceCurrentBasis(
            marketData,
            scoreDate,
        );

        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        if (buyPriceObj === null || !buyPriceObj.price || buyPriceObj.price <= 0) {
            return null;
        }
        const buyPrice = buyPriceObj.price;

        // Dividend cash within the 90-day window, then split into the
        // price-return and dividend-return components via the shared helpers
        // (issue #424) so production and tests share one implementation.
        const dividends = this.getDividendsWithin90Days(stock.stock);
        const totalDividends = GRQProjection.sumDividends(dividends);
        const priceReturn = ((currentPrice - buyPrice) / buyPrice) * 100;
        const dividendReturn = GRQProjection.dividendReturnPercent(
            buyPrice,
            totalDividends,
        );
        const totalReturn = GRQProjection.calculatePerformanceReturn(
            buyPrice,
            currentPrice,
            totalDividends,
        );

        return {
            buyPrice,
            currentPrice,
            totalDividends,
            priceReturn,
            dividendReturn,
            totalReturn,
        };
    }

    // Centralized method to calculate stock performance with proper dilution handling
    calculateStockPerformanceWithDilution(stock, scoreDate) {
        const breakdown = this.getStockReturnBreakdown(stock, scoreDate);
        return breakdown === null ? null : breakdown.totalReturn;
    }

    // Equal-weighted dividend component of the Actual figure (issue #426): the
    // mean of each included stock's dividend yield (dividends ÷ buy price). This
    // is the dividend slice of calculatePortfolioPerformance90Day, so Actual =
    // average price return + this value. Returns 0 when nothing is included,
    // mirroring calculatePortfolioPerformance90Day's guard.
    calculatePortfolioDividendYield() {
        const scoreDate = this.getScoreDate(this.selectedFile);
        let totalYield = 0;
        let validStocks = 0;

        this.scoreData.forEach((stock) => {
            if (!this.isStockPriceable(stock.stock, scoreDate)) {
                return;
            }
            const breakdown = this.getStockReturnBreakdown(stock, scoreDate);
            if (breakdown !== null) {
                totalYield += breakdown.dividendReturn;
                validStocks++;
            }
        });

        return validStocks > 0 ? totalYield / validStocks : 0;
    }

    // Calculate linear regression for trend prediction
    calculateTrendLine(stock, scoreDate, endDate) {
        const marketData = this.marketData[stock.stock];
        if (!marketData || marketData.length === 0) {
            console.log(`calculateTrendLine - ${stock.stock}: No market data available`);
            return null;
        }

        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);

        if (!buyPriceObj || buyPriceObj.price <= 0) {
            console.log(`calculateTrendLine - ${stock.stock}: No valid buy price. Buy price obj:`, buyPriceObj);
            return null;
        }

        console.log(`calculateTrendLine - ${stock.stock}: Buy price: $${buyPriceObj.price.toFixed(2)}`);

        // Data-window / end-date selection lives in the shared projection module
        // (issue #144) so production and the Deno tests exercise the same window:
        // score date to the latest market-data date (not today) unless endDate set.
        const dataPoints = GRQProjection.buildTrendLineDataPoints(
            marketData,
            scoreDate,
            buyPriceObj.price,
            this.getDividendsWithin90Days(stock.stock),
            endDate,
        );

        console.log(`calculateTrendLine - ${stock.stock}: Data points collected: ${dataPoints.length}`);
        if (dataPoints.length > 0) {
            console.log(`calculateTrendLine - ${stock.stock}: First data point:`, dataPoints[0]);
            console.log(`calculateTrendLine - ${stock.stock}: Last data point:`, dataPoints[dataPoints.length - 1]);
        }

        // Need at least 3 data points for meaningful regression
        if (dataPoints.length < 3) {
            console.log(`calculateTrendLine - ${stock.stock}: Insufficient data points (${dataPoints.length} < 3)`);
            return null;
        }

        // Linear-regression maths lives in the shared projection module
        // (issue #100) so production and the Deno tests share one fit.
        const trendLine = GRQProjection.computeTrendLine(dataPoints);

        console.log(`calculateTrendLine - ${stock.stock}: Slope: ${trendLine.slope.toFixed(4)}, Intercept: ${trendLine.intercept}, R²: ${trendLine.rSquared.toFixed(4)}, Predicted 90-day: ${trendLine.predicted90DayPerformance.toFixed(1)}%`);

        return trendLine;
    }

    // Calculate linear regression for portfolio trend prediction
    calculatePortfolioTrendLine() {
        const scoreDate = this.getScoreDate(this.selectedFile);
        const scoreDateTimestamp = scoreDate.getTime();
        // Use the latest market data date instead of today's date
        const portfolioData = this.calculatePortfolioData();
        const today = portfolioData && portfolioData.length > 0 ? portfolioData[portfolioData.length - 1].x : new Date();
        // Get portfolio data points from score date to today (but only if we have at least 3 data points)
        const dataPoints = [];
        
        console.log("Portfolio trend line - total portfolio data points:", portfolioData.length);
        
        portfolioData.forEach((point) => {
            if (point.x >= scoreDate && point.x <= today) {
                const daysSinceScore = (point.x.getTime() - scoreDateTimestamp) / (1000 * 60 * 60 * 24);
                dataPoints.push({
                    x: daysSinceScore,
                    y: point.y
                });
            }
        });

        console.log("Portfolio trend line - filtered data points:", dataPoints.length);
        if (dataPoints.length > 0) {
            console.log("Portfolio trend line - first point:", dataPoints[0]);
            console.log("Portfolio trend line - last point:", dataPoints[dataPoints.length - 1]);
        }

        // Need at least 3 data points for meaningful regression
        if (dataPoints.length < 3) {
            console.log("Portfolio trend line - insufficient data points:", dataPoints.length);
            return null;
        }

        // Regression through the origin (issue #303). Day 0 = 0% by definition
        // (portfolio performance is measured against the buy prices on the score
        // date), so the line must pass through (0,0); the slope is the
        // least-squares slope subject to that anchor, m = Σ(x·y) / Σ(x·x). This
        // delegates to the single shared kernel in docs/projection.js so the
        // portfolio and single-stock trend lines cannot drift apart (issue #273).
        const trend = GRQProjection.computeTrendLine(dataPoints);
        if (!trend) {
            console.log("Portfolio trend line - regression returned null");
            return null;
        }

        console.log("Portfolio trend line - slope:", trend.slope, "intercept:", trend.intercept, "R²:", trend.rSquared, "Predicted 90-day:", trend.predicted90DayPerformance);

        return {
            slope: trend.slope,
            intercept: trend.intercept,
            predicted90DayPerformance: trend.predicted90DayPerformance,
            dataPoints,
            rSquared: trend.rSquared
        };
    }

    getNextExDividendDate(stockSymbol) {
        const dividends = this.dividendData?.[stockSymbol] || [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        );

        const nextExDividend = dividends.find((dividend) =>
            dividend.exDivDate > scoreDate && dividend.exDivDate <= ninetyDayDate
        );

        if (nextExDividend) {
            return nextExDividend.exDivDate.toISOString().split('T')[0];
        } else {
            return "N/A";
        }
    }

    // Calculate hybrid projection for 90-day performance
    calculateHybridProjection(stock, scoreDate) {
        const marketData = this.marketData[stock.stock];
        if (!marketData || marketData.length === 0) {
            console.log(`calculateHybridProjection - ${stock.stock}: No market data available`);
            return null;
        }

        const scoreDateTimestamp = scoreDate.getTime();
        // Use the latest market data date instead of today's date
        const latestMarketDate = marketData && marketData.length > 0 ? marketData[marketData.length - 1].date : new Date();
        const daysElapsed = Math.floor((latestMarketDate.getTime() - scoreDateTimestamp) / (1000 * 60 * 60 * 24));
        
        console.log(`calculateHybridProjection - ${stock.stock}: Days elapsed: ${daysElapsed} (using latest market data date: ${latestMarketDate.toISOString().split('T')[0]})`);
        
        // Get buy price
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        if (!buyPriceObj || buyPriceObj.price <= 0) {
            console.log(`calculateHybridProjection - ${stock.stock}: No valid buy price`);
            return null;
        }

        // Calculate current performance
        const currentPerformance = this.calculateStockPerformance(stock);
        if (currentPerformance === null) {
            console.log(`calculateHybridProjection - ${stock.stock}: Cannot calculate current performance`);
            return null;
        }

        // Get target percentage
        const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);
        
        console.log(`calculateHybridProjection - ${stock.stock}: Current performance: ${currentPerformance.toFixed(1)}%, Target: ${targetPercentage ? targetPercentage.toFixed(1) : 'N/A'}%`);

        // The dampened-trend horizons (under 60 days elapsed) need the
        // regression line; the long-term trajectory derives its shape from the
        // projection figures alone.
        const trendLine = daysElapsed < 60
            ? this.calculateTrendLine(stock, scoreDate)
            : null;

        // The hybrid decision tree lives in the shared projection module
        // (issue #100) so production and the Deno tests share one kernel.
        const { projected90DayPerformance, projectionMethod, confidence } =
            GRQProjection.computeHybridProjection({
                daysElapsed,
                currentPerformance,
                targetPercentage,
                trendLine,
            });

        console.log(`calculateHybridProjection - ${stock.stock}: Final projection: ${projected90DayPerformance.toFixed(1)}% (method: ${projectionMethod}, confidence: ${confidence.toFixed(2)})`);

        return {
            projected90DayPerformance,
            projectionMethod,
            confidence,
            daysElapsed,
            currentPerformance,
            targetPercentage
        };
    }

    // Calculate hybrid projection data points for chart
    calculateHybridProjectionData(stock, scoreDate) {
        const projection = this.calculateHybridProjection(stock, scoreDate);
        if (!projection) return null;

        // The dampened-trend curve needs the regression line; the other
        // methods derive their shape purely from the projection figures.
        const trendLine = projection.projectionMethod === "dampened_trend"
            ? this.calculateTrendLine(stock, scoreDate)
            : null;

        // Delegate the weekly trend-shape generation to the shared projection
        // module (issue #80) so production and the Deno tests share one
        // implementation.
        const trendData = GRQProjection.buildHybridProjectionData(
            projection,
            scoreDate,
            trendLine,
        );

        return {
            data: trendData,
            projection: projection
        };
    }
}

globalThis.GRQPortfolioCalc = { PortfolioCalculator };
