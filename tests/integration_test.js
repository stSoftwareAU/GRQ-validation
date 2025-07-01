import { assertEquals, assertExists, assertNotEquals, assertAlmostEquals } from "@std/assert";

// Mock the GRQValidator class for integration testing
class MockGRQValidator {
    constructor() {
        this.scoreData = [];
        this.marketData = {};
        this.dividendData = {};
        this.selectedFile = "2025/February/15.tsv";
        this.selectedStock = null;
        this.costOfCapital = 10;
    }

    // Setup test data
    setupTestData() {
        this.scoreData = [
            {
                stock: "NASDAQ:XP",
                score: 0.85,
                target: 18.50,
                exDividendDate: null,
                dividendPerShare: 0,
                notes: "Test stock",
                intrinsicValuePerShareBasic: 20.00,
                intrinsicValuePerShareAdjusted: 19.50
            },
            {
                stock: "NYSE:AAPL",
                score: 0.92,
                target: 200.00,
                exDividendDate: "2025-03-15",
                dividendPerShare: 0.25,
                notes: "Apple Inc",
                intrinsicValuePerShareBasic: 220.00,
                intrinsicValuePerShareAdjusted: 215.00
            }
        ];

        this.marketData = {
            "NASDAQ:XP": [
                {
                    date: new Date("2025-02-18"),
                    high: 15.18,
                    low: 14.72,
                    open: 14.72,
                    close: 15.02,
                    splitCoefficient: 1.0
                },
                {
                    date: new Date("2025-02-19"),
                    high: 15.25,
                    low: 14.85,
                    open: 15.02,
                    close: 15.10,
                    splitCoefficient: 1.0
                },
                {
                    date: new Date("2025-02-20"),
                    high: 15.30,
                    low: 14.90,
                    open: 15.10,
                    close: 15.20,
                    splitCoefficient: 1.0
                }
            ],
            "NYSE:AAPL": [
                {
                    date: new Date("2025-02-18"),
                    high: 180.50,
                    low: 179.20,
                    open: 179.20,
                    close: 180.00,
                    splitCoefficient: 1.0
                },
                {
                    date: new Date("2025-02-19"),
                    high: 181.00,
                    low: 179.80,
                    open: 180.00,
                    close: 180.50,
                    splitCoefficient: 1.0
                }
            ]
        };

        this.dividendData = {
            "NYSE:AAPL": [
                {
                    exDivDate: new Date("2025-03-15"),
                    amount: 0.25
                }
            ]
        };
    }

    // Mock methods
    getScoreDate(scoreFile) {
        const match = scoreFile.match(/(\d{4})\/(\w+)\/(\d+)\.tsv/);
        if (match) {
            const [, year, month, day] = match;
            const monthIndex = new Date(`${month} 1, ${year}`).getMonth();
            return new Date(parseInt(year), monthIndex, parseInt(day));
        }
        return new Date();
    }

    getDaysElapsed(scoreDate) {
        const today = new Date();
        const diffTime = Math.abs(today - scoreDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }

    getHistoricalToCurrentSplitAdjustment(stockSymbol, historicalDate) {
        const marketData = this.marketData[stockSymbol];
        if (!marketData) return 1.0;

        let cumulativeSplit = 1.0;
        for (const point of marketData) {
            if (point.date > historicalDate && point.splitCoefficient > 1.0) {
                cumulativeSplit *= point.splitCoefficient;
            }
        }
        return cumulativeSplit;
    }

    adjustHistoricalPriceToCurrent(price, stockSymbol, historicalDate) {
        const splitAdjustment = this.getHistoricalToCurrentSplitAdjustment(stockSymbol, historicalDate);
        return price / splitAdjustment;
    }

    getBuyPrice(stockSymbol, scoreDate) {
        const marketData = this.marketData[stockSymbol];
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
                return {
                    price: this.adjustHistoricalPriceToCurrent(
                        (candidateData.high + candidateData.low) / 2,
                        stockSymbol,
                        scoreDate,
                    ),
                    dateUsed: candidateDate
                };
            }
        }
        return null;
    }

    calculateTargetPercentage(stock, scoreDate) {
        const buyPrice = this.getBuyPrice(stock.stock, scoreDate);
        const adjustedTarget = this.adjustHistoricalPriceToCurrent(
            stock.target,
            stock.stock,
            scoreDate
        );
        
        if (buyPrice !== null && adjustedTarget !== null) {
            return ((adjustedTarget - buyPrice.price) / buyPrice.price) * 100;
        }
        return null;
    }

    calculateStockPerformanceWithDilution(stock, scoreDate) {
        const marketData = this.marketData[stock.stock];
        if (!marketData || marketData.length === 0) return null;

        const ninetyDayDate = new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000));
        const within90Days = marketData.filter((point) => point.date <= ninetyDayDate);
        if (within90Days.length === 0) return null;

        const lastData = within90Days[within90Days.length - 1];
        const currentPrice = (lastData.high + lastData.low) / 2;
        
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        if (buyPriceObj === null) return null;

        const priceReturn = ((currentPrice - buyPriceObj.price) / buyPriceObj.price) * 100;
        const dividends = this.getDividendsWithin90Days(stock.stock);
        const totalDividends = dividends.reduce((sum, div) => sum + div.amount, 0);
        const dividendReturn = (totalDividends / buyPriceObj.price) * 100;

        return priceReturn + dividendReturn;
    }

    getDividendsWithin90Days(stockSymbol) {
        const dividends = this.dividendData[stockSymbol] || [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000));

        return dividends.filter((dividend) => dividend.exDivDate <= ninetyDayDate);
    }

    calculatePortfolioData() {
        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000));
        const portfolioData = [];

        const allDates = new Set();
        this.scoreData.forEach((stock) => {
            const marketData = this.marketData[stock.stock];
            if (marketData) {
                marketData.forEach((point) => {
                    allDates.add(point.date.getTime());
                });
            }
        });

        allDates.add(scoreDate.getTime());
        const sortedDates = Array.from(allDates).sort((a, b) => a - b);

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

                    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
                    if (!buyPriceObj) return;

                    if (dataPoint) {
                        const currentPrice = this.adjustHistoricalPriceToCurrent(
                            (dataPoint.high + dataPoint.low) / 2,
                            stock.stock,
                            dataPoint.date,
                        );

                        const priceReturn = ((currentPrice - buyPriceObj.price) / buyPriceObj.price) * 100;
                        const dividends = this.getDividendsWithin90Days(stock.stock);
                        const dividendsUpToDate = dividends.filter((d) => d.exDivDate <= date);
                        const totalDividends = dividendsUpToDate.reduce((sum, div) => sum + div.amount, 0);
                        const dividendReturn = (totalDividends / buyPriceObj.price) * 100;
                        const totalReturn = priceReturn + dividendReturn;

                        totalPerformance += totalReturn;
                        validStocks++;
                    } else if (timestamp === scoreDate.getTime()) {
                        validStocks++;
                    }
                }
            });

            if (validStocks > 0) {
                portfolioData.push({
                    x: new Date(date.getTime()),
                    y: totalPerformance / validStocks,
                });
            }
        });

        return portfolioData;
    }

    calculatePortfolioTargetPercentage() {
        let totalTarget = 0;
        let validStocks = 0;
        const scoreDate = this.getScoreDate(this.selectedFile);

        this.scoreData.forEach((stock) => {
            if (stock.target !== null && !isNaN(stock.target)) {
                const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);
                if (targetPercentage !== null) {
                    totalTarget += targetPercentage;
                    validStocks++;
                }
            }
        });

        return validStocks > 0 ? totalTarget / validStocks : 20.0;
    }

    calculatePortfolioPerformance90Day() {
        const scoreDate = this.getScoreDate(this.selectedFile);
        let totalPerformance = 0;
        let validStocks = 0;

        this.scoreData.forEach((stock) => {
            const performance = this.calculateStockPerformanceWithDilution(stock, scoreDate);
            if (performance !== null) {
                totalPerformance += performance;
                validStocks++;
            }
        });

        return validStocks > 0 ? totalPerformance / validStocks : 0;
    }

    // Test the prepareChartData method logic
    prepareChartData() {
        const datasets = [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        const daysElapsed = this.getDaysElapsed(scoreDate);
        const ninetyDayDate = new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000));

        if (this.selectedStock) {
            // Single stock view
            const stock = this.scoreData.find((s) => s.stock === this.selectedStock);
            if (stock) {
                const marketData = this.marketData[stock.stock];
                if (marketData && marketData.length > 0) {
                    const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);
                    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
                    
                    if (!buyPriceObj) {
                        console.warn(`No buy price available for ${stock.stock}, skipping chart data`);
                        return { datasets };
                    }
                    
                    const buyPrice = buyPriceObj.price;
                    const stockDividends = this.dividendData?.[stock.stock] || [];
                    const exDivDates = stockDividends.map((d) => d.exDivDate.getTime());

                    const before90Days = [];
                    const after90Days = [];

                    marketData.forEach((point) => {
                        const adjustedPrice = this.adjustHistoricalPriceToCurrent(
                            (point.high + point.low) / 2,
                            stock.stock,
                            point.date,
                        );
                        
                        const dataPoint = {
                            x: new Date(point.date.getTime()),
                            y: ((adjustedPrice - buyPrice) / buyPrice) * 100,
                        };

                        if (point.date <= ninetyDayDate) {
                            before90Days.push(dataPoint);
                        } else {
                            after90Days.push(dataPoint);
                        }
                    });

                    if (before90Days.length > 0) {
                        datasets.push({
                            label: "Performance",
                            data: before90Days,
                            borderColor: "rgba(102, 126, 234, 1)",
                            backgroundColor: "rgba(102, 126, 234, 0.1)",
                            borderWidth: 3,
                            fill: false,
                            pointRadius: 3,
                        });
                    }

                    if (targetPercentage !== null) {
                        datasets.push({
                            label: "Target",
                            data: [{
                                x: new Date(ninetyDayDate.getTime()),
                                y: targetPercentage,
                            }],
                            borderColor: "rgba(255, 193, 7, 0.8)",
                            backgroundColor: "rgba(255, 193, 7, 0.8)",
                            borderWidth: 3,
                            pointRadius: 6,
                            pointHoverRadius: 8,
                            fill: false,
                            showLine: false,
                        });
                    }
                }
            }
        } else {
            // Portfolio view
            const portfolioData = this.calculatePortfolioData();
            
            const before90Days = [];
            const after90Days = [];
            
            portfolioData.forEach((point) => {
                if (point.x <= ninetyDayDate) {
                    before90Days.push(point);
                } else {
                    after90Days.push(point);
                }
            });
            
            if (before90Days.length > 0) {
                datasets.push({
                    label: "Performance",
                    data: before90Days,
                    borderColor: "rgba(102, 126, 234, 1)",
                    backgroundColor: "rgba(102, 126, 234, 0.1)",
                    borderWidth: 3,
                    fill: false,
                    pointRadius: 3,
                });
            }

            const portfolioTarget = this.calculatePortfolioTargetPercentage();
            if (portfolioTarget !== null) {
                datasets.push({
                    label: "Target",
                    data: [{
                        x: new Date(ninetyDayDate.getTime()),
                        y: portfolioTarget,
                    }],
                    borderColor: "rgba(255, 193, 7, 0.8)",
                    backgroundColor: "rgba(255, 193, 7, 0.8)",
                    borderWidth: 3,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    fill: false,
                    showLine: false,
                });
            }
        }

        return { datasets };
    }
}

// Integration tests
Deno.test("Integration Tests - Complete Application Logic", async (t) => {
    const validator = new MockGRQValidator();
    validator.setupTestData();
    
    const scoreDate = validator.getScoreDate(validator.selectedFile);

    await t.step("should calculate buy prices correctly for all stocks", () => {
        const xpBuyPrice = validator.getBuyPrice("NASDAQ:XP", scoreDate);
        const aaplBuyPrice = validator.getBuyPrice("NYSE:AAPL", scoreDate);
        
        assertExists(xpBuyPrice, "NASDAQ:XP buy price should not be null");
        assertExists(aaplBuyPrice, "NYSE:AAPL buy price should not be null");
        
        assertEquals(xpBuyPrice.price, 14.95, "NASDAQ:XP buy price should be 14.95");
        assertEquals(aaplBuyPrice.price, 179.85, "NYSE:AAPL buy price should be 179.85");
    });

    await t.step("should calculate target percentages correctly", () => {
        const xpTarget = validator.calculateTargetPercentage(
            { stock: "NASDAQ:XP", target: 18.50 }, 
            scoreDate
        );
        const aaplTarget = validator.calculateTargetPercentage(
            { stock: "NYSE:AAPL", target: 200.00 }, 
            scoreDate
        );
        
        assertExists(xpTarget, "NASDAQ:XP target should not be null");
        assertExists(aaplTarget, "NYSE:AAPL target should not be null");
        
        assertAlmostEquals(xpTarget, 23.75, 0.01, "NASDAQ:XP target should be 23.75%");
        assertAlmostEquals(aaplTarget, 11.21, 0.01, "NYSE:AAPL target should be 11.21%");
    });

    await t.step("should calculate performance correctly", () => {
        const xpPerformance = validator.calculateStockPerformanceWithDilution(
            { stock: "NASDAQ:XP", target: 18.50 }, 
            scoreDate
        );
        const aaplPerformance = validator.calculateStockPerformanceWithDilution(
            { stock: "NYSE:AAPL", target: 200.00 }, 
            scoreDate
        );
        
        assertExists(xpPerformance, "NASDAQ:XP performance should not be null");
        assertExists(aaplPerformance, "NYSE:AAPL performance should not be null");
        
        assertAlmostEquals(xpPerformance, 1.00, 0.01, "NASDAQ:XP performance should be 1.00%");
        assertAlmostEquals(aaplPerformance, 0.44, 0.01, "NYSE:AAPL performance should be 0.44%");
    });

    await t.step("should calculate portfolio target correctly", () => {
        const portfolioTarget = validator.calculatePortfolioTargetPercentage();
        
        assertExists(portfolioTarget, "Portfolio target should not be null");
        assertAlmostEquals(portfolioTarget, 17.48, 0.01, "Portfolio target should be 17.48%");
    });

    await t.step("should calculate portfolio performance correctly", () => {
        const portfolioPerformance = validator.calculatePortfolioPerformance90Day();
        
        assertExists(portfolioPerformance, "Portfolio performance should not be null");
        assertAlmostEquals(portfolioPerformance, 0.72, 0.01, "Portfolio performance should be 0.72%");
    });

    await t.step("should generate portfolio chart data correctly", () => {
        const chartData = validator.prepareChartData();
        
        assertExists(chartData, "Chart data should not be null");
        assertExists(chartData.datasets, "Chart datasets should exist");
        assertEquals(chartData.datasets.length, 2, "Should have 2 datasets (Performance and Target)");
        
        const performanceDataset = chartData.datasets.find(d => d.label === "Performance");
        const targetDataset = chartData.datasets.find(d => d.label === "Target");
        
        assertExists(performanceDataset, "Should have performance dataset");
        assertExists(targetDataset, "Should have target dataset");
        assertNotEquals(performanceDataset.data.length, 0, "Performance dataset should have data");
        assertEquals(targetDataset.data.length, 1, "Target dataset should have one point");
        
        assertAlmostEquals(targetDataset.data[0].y, 17.48, 0.01, "Target should be 17.48%");
    });

    await t.step("should generate single stock chart data correctly", () => {
        validator.selectedStock = "NASDAQ:XP";
        const chartData = validator.prepareChartData();
        
        assertExists(chartData, "Chart data should not be null");
        assertExists(chartData.datasets, "Chart datasets should exist");
        assertEquals(chartData.datasets.length, 2, "Should have 2 datasets (Performance and Target)");
        
        const performanceDataset = chartData.datasets.find(d => d.label === "Performance");
        const targetDataset = chartData.datasets.find(d => d.label === "Target");
        
        assertExists(performanceDataset, "Should have performance dataset");
        assertExists(targetDataset, "Should have target dataset");
        assertNotEquals(performanceDataset.data.length, 0, "Performance dataset should have data");
        assertEquals(targetDataset.data.length, 1, "Target dataset should have one point");
        
        assertAlmostEquals(targetDataset.data[0].y, 23.75, 0.01, "Target should be 23.75%");
    });

    await t.step("should handle dividends correctly", () => {
        const aaplDividends = validator.getDividendsWithin90Days("NYSE:AAPL");
        const xpDividends = validator.getDividendsWithin90Days("NASDAQ:XP");
        
        assertEquals(aaplDividends.length, 1, "AAPL should have 1 dividend");
        assertEquals(xpDividends.length, 0, "XP should have 0 dividends");
        assertEquals(aaplDividends[0].amount, 0.25, "AAPL dividend should be $0.25");
    });

    await t.step("should handle null buy prices gracefully", () => {
        // Test with non-existent stock
        const nonExistentPerformance = validator.calculateStockPerformanceWithDilution(
            { stock: "NONEXISTENT", target: 100.00 }, 
            scoreDate
        );
        assertEquals(nonExistentPerformance, null, "Should return null for non-existent stock");
        
        const nonExistentTarget = validator.calculateTargetPercentage(
            { stock: "NONEXISTENT", target: 100.00 }, 
            scoreDate
        );
        assertEquals(nonExistentTarget, null, "Should return null for non-existent stock");
    });
});

// Run all tests
if (import.meta.main) {
    console.log("Running integration tests...");
    await Deno.runTests();
} 