class GRQValidator {
    constructor() {
        this.scoreData = null;
        this.marketData = null;
        this.dividendData = null;
        this.selectedFile = null;
        this.filteredStocks = [];
        this.selectedStock = null; // Track selected stock for single view
        this.chart = null;
        this.costOfCapital = 10; // 10% annual cost of capital

        this.initializeEventListeners();
        this.loadIndex();
    }


    // Helper function to format currency values with thousand separators
    formatCurrency(value) {
        if (value === null || value === undefined || isNaN(value)) {
            return "N/A";
        }
        const money= new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);

        return money;
    }

    // Centralized method to get Bootstrap breakpoint
    getBootstrapBreakpoint() {
        const width = window.innerWidth;
        if (width >= 1400) return 'xxl';
        if (width >= 1200) return 'xl';
        if (width >= 992) return 'lg';
        if (width >= 768) return 'md';
        if (width >= 576) return 'sm';
        return 'xs';
    }

    // Centralized method to check if device is mobile
    isMobileDevice() {
        const breakpoint = this.getBootstrapBreakpoint();
        return breakpoint === 'xs' || breakpoint === 'sm';
    }

    initializeEventListeners() {
        document
            .getElementById("scoreFileSelect")
            .addEventListener("change", (e) => {
                this.selectedFile = e.target.value;
                this.selectedStock = null; // Reset to aggregate view
                if (this.selectedFile) {
                    this.loadScoreFile();
                }
            });

        // Remove stock filter event listener - no longer needed

        // Add back to aggregate view button
        document.getElementById("backToAggregate").addEventListener(
            "click",
            () => {
                this.selectedStock = null;
                this.updateDisplay();
            },
        );

        // Global click handler to manage popover behavior
        document.addEventListener("click", (event) => {
            const popoverTrigger = event.target.closest(
                '[data-bs-toggle="popover"]',
            );
            const popoverContent = event.target.closest(".popover");

            // Don't do anything if clicking inside the popover content
            if (popoverContent) {
                return;
            }

            // Close all existing popovers
            const popovers = document.querySelectorAll(
                '[data-bs-toggle="popover"]',
            );
            popovers.forEach((element) => {
                const popover = bootstrap.Popover.getInstance(element);
                if (popover && element.hasAttribute("aria-describedby")) {
                    popover.hide();
                }
            });

            // If we clicked on a popover trigger, show the new one after a brief delay
            if (popoverTrigger) {
                setTimeout(() => {
                    const popover = bootstrap.Popover.getInstance(
                        popoverTrigger,
                    );
                    if (popover) {
                        popover.show();
                    }
                }, 10);
            }
        });
    }

    async loadIndex() {
        try {
            // Add cache-busting parameter to force fresh fetch
            const timestamp = new Date().getTime();
            const response = await fetch(
                `scores/index.json?t=${timestamp}`,
            );
            const indexData = await response.json();

            const select = document.getElementById("scoreFileSelect");
            select.innerHTML =
                '<option value="">Select a score file...</option>';

            indexData.scores.forEach((score) => {
                const option = document.createElement("option");
                option.value = score.file;
                option.textContent =
                    `${score.date} (${score.month} ${score.day})`;
                select.appendChild(option);
            });

            if (indexData.scores.length > 0) {
                // Find the score file closest to 90 days ago
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() - 90); // 90 days ago
                
                let closestScore = indexData.scores[0]; // Default to first score
                let smallestDifference = Infinity;
                
                indexData.scores.forEach((score) => {
                    const scoreDate = new Date(score.date);
                    const difference = Math.abs(scoreDate.getTime() - targetDate.getTime());
                    
                    if (difference < smallestDifference) {
                        smallestDifference = difference;
                        closestScore = score;
                    }
                });
                
                console.log(`Auto-selecting score file closest to 90 days ago: ${closestScore.date} (${closestScore.month} ${closestScore.day})`);
                
                this.selectedFile = closestScore.file;
                select.value = this.selectedFile;
                await this.loadScoreFile();
            }
        } catch (error) {
            this.showError(
                "Failed to load score files: " + error.message,
            );
        }
    }

    async loadScoreFile() {
        this.showLoading();

        try {
            await this.loadScoreData();
            await this.loadMarketData();
            this.updateDisplay();
        } catch (error) {
            this.showError("Failed to load data: " + error.message);
        }
    }

    async loadScoreData() {
        // Add cache-busting parameter
        const timestamp = new Date().getTime();
        const response = await fetch(
            `scores/${this.selectedFile}?t=${timestamp}`,
        );
        const text = await response.text();

        const lines = text.trim().split("\n");
        // Remove unused headers variable

        this.scoreData = lines.slice(1).map((line) => {
            const values = line.split("\t");
            return {
                stock: values[0],
                score: parseFloat(values[1]),
                target: parseFloat(values[2]),
                exDividendDate: values[3] || null,
                dividendPerShare: values[4] ? parseFloat(values[4]) : 0,
                notes: values[5] || "",
                intrinsicValuePerShareBasic: values[6]
                    ? parseFloat(values[6])
                    : null,
                intrinsicValuePerShareAdjusted: values[7]
                    ? parseFloat(values[7])
                    : null,
            };
        });

        // Initialize filtered stocks to all stocks (no filtering)
        this.filteredStocks = [...this.scoreData];
    }

    async loadMarketData() {
        const csvFile = this.selectedFile.replace(".tsv", ".csv");

        try {
            // Add cache-busting parameter
            const timestamp = new Date().getTime();
            const response = await fetch(
                `scores/${csvFile}?t=${timestamp}`,
            );
            const text = await response.text();

            if (!text.trim()) {
                this.marketData = null;
                return;
            }

            const lines = text.split("\n").filter((line) => line.trim());
            // Remove unused headers variable

            this.marketData = {};

            lines.slice(1).forEach((line) => {
                const values = line.split(",");
                const date = values[0];
                const ticker = values[1];
                const high = parseFloat(values[2]);
                const low = parseFloat(values[3]);
                const open = parseFloat(values[4]);
                const close = parseFloat(values[5]);
                const splitCoefficient = parseFloat(values[6]);

                if (!this.marketData[ticker]) {
                    this.marketData[ticker] = [];
                }

                // Set market data dates to noon to avoid timezone issues
                const marketDate = this.setDateToMidnight(new Date(date));

                this.marketData[ticker].push({
                    date: marketDate,
                    high,
                    low,
                    open,
                    close,
                    splitCoefficient,
                });
            });

            // Load dividend data
            await this.loadDividendData();
        } catch (error) {
            console.warn(
                "No market data available yet:",
                error.message,
            );
            this.marketData = null;
        }
    }

    async loadDividendData() {
        const dividendFile = this.selectedFile.replace(
            ".tsv",
            "-dividends.csv",
        );

        try {
            // Add cache-busting parameter
            const timestamp = new Date().getTime();
            const response = await fetch(
                `scores/${dividendFile}?t=${timestamp}`,
            );
            const text = await response.text();

            if (!text.trim()) {
                this.dividendData = null;
                return;
            }

            const lines = text.split("\n").filter((line) => line.trim());
            // Remove unused headers variable

            this.dividendData = {};

            lines.slice(1).forEach((line) => {
                const values = line.split(",");
                const exDivDate = values[0];
                const ticker = values[1];
                const amount = parseFloat(values[2]);

                if (!this.dividendData[ticker]) {
                    this.dividendData[ticker] = [];
                }

                // Set dividend dates to noon to avoid timezone issues
                const dividendDate = this.setDateToMidnight(new Date(exDivDate));

                this.dividendData[ticker].push({
                    exDivDate: dividendDate,
                    amount,
                });
            });
        } catch (error) {
            console.warn(
                "No dividend data available:",
                error.message,
            );
            this.dividendData = null;
        }
    }

    updateDisplay() {
        if (!this.scoreData) {
            this.showError("No score data available");
            return;
        }

        if (
            !this.marketData ||
            Object.keys(this.marketData).length === 0
        ) {
            this.showBasicScoreTable();
            return;
        }

        this.hideMessages();
        
        // Show the chart since we have market data
        const chartContainer = document.getElementById("performanceChart").parentElement;
        if (chartContainer) {
            chartContainer.style.display = "block";
        }

        // Remove the no-market-data message if it exists
        const existingMessage = document.querySelector(".no-market-data-message");
        if (existingMessage) {
            existingMessage.remove();
        }

        this.updateChart();
        this.updateStockTable();

        // Show/hide back button based on view mode
        document.getElementById("backToAggregate").style.display =
            this.selectedStock ? "block" : "none";

        // Apply CSS class for detailed view
        const tableContainer = document.querySelector(
            ".table-responsive",
        );
        if (this.selectedStock) {
            tableContainer.classList.add("stock-detail-view");
        } else {
            tableContainer.classList.remove("stock-detail-view");
        }
    }

    updateChart() {
        const ctx = document
            .getElementById("performanceChart")
            .getContext("2d");

        if (this.chart) {
            this.chart.destroy();
        }

        const chartData = this.prepareChartData();
        let chartTitle;
        if (this.selectedStock) {
            const stock = this.scoreData.find((s) =>
                s.stock === this.selectedStock
            );
            if (stock) {
                chartTitle = `Stock Performance: ${this.selectedStock} (Score: ${
                    stock.score.toFixed(3)
                }, Target: $${stock.target.toFixed(2)})`;
            } else {
                chartTitle = `Stock Performance: ${this.selectedStock}`;
            }
        } else {
            chartTitle = "Portfolio Performance Over Time";
        }

        // Debug logging for chart data
        console.log("Chart data for rendering:", JSON.stringify(chartData, null, 2));
        console.log("Number of datasets:", chartData.datasets.length);
        chartData.datasets.forEach((dataset, index) => {
            console.log(`Dataset ${index}:`, {
                label: dataset.label,
                dataPoints: dataset.data.length,
                firstPoint: dataset.data[0],
                lastPoint: dataset.data[dataset.data.length - 1]
            });
        });

        // Update the HTML title element as well
        const htmlTitleElement = document.getElementById("chartTitle");
        if (htmlTitleElement) {
            htmlTitleElement.textContent = chartTitle;
        }

        const breakpoint = this.getBootstrapBreakpoint();
        const isMobile = this.isMobileDevice();

        // Debug logging
        console.log("updateChart - Bootstrap breakpoint:", breakpoint);
        console.log("updateChart - isMobile:", isMobile);
        console.log("updateChart - window.innerWidth:", window.innerWidth);
        console.log("updateChart - legend display:", !isMobile);

        this.chart = new Chart(ctx, {
            type: "line",
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        top: 20,
                        bottom: 20,
                        left: 10,
                        right: 30
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: chartTitle,
                        font: {
                            size: isMobile ? 14 : 16,
                            weight: 'bold',
                        },
                        color: '#333',
                        padding: {
                            top: 10,
                            bottom: 10,
                        },
                        align: 'start',
                    },
                    legend: {
                        display: !isMobile, // This should hide the legend on mobile
                        position: "bottom",
                        align: "center",
                        fullSize: false,
                        reverse: false,
                        labels: {
                            boxWidth: isMobile ? 12 : 16,
                            padding: isMobile ? 8 : 12,
                            font: {
                                size: isMobile ? 10 : 12,
                            },
                            usePointStyle: true,
                        },
                    },
                    tooltip: {
                        mode: "index",
                        intersect: false,
                        callbacks: {
                            title: function (context) {
                                const date = new Date(context[0].parsed.x);
                                return date.toLocaleDateString();
                            },
                            label: function (context) {
                                const label = context.dataset.label || "";
                                const value = context.parsed.y;
                                const dataPoint = context.raw;

                                let tooltipText = "";
                                if (label.includes("Target")) {
                                    tooltipText = `${label}: ${
                                        value.toFixed(1)
                                    }%`;
                                } else if (
                                    label.includes("Price") &&
                                    !label.includes("Performance")
                                ) {
                                    tooltipText = `${label}: $${
                                        value.toFixed(2)
                                    }`;
                                } else if (label.includes("Actual")) {
                                    tooltipText = `${label}: $${
                                        value.toFixed(2)
                                    }`;
                                } else {
                                    tooltipText = `${label}: ${
                                        value.toFixed(1)
                                    }%`;
                                }

                                // Add dividend information if available
                                if (dataPoint && dataPoint.dividend) {
                                    if (
                                        typeof dataPoint.dividend === "number"
                                    ) {
                                        tooltipText += ` (Ex-Dividend: $${
                                            dataPoint.dividend.toFixed(2)
                                        })`;
                                    } else {
                                        tooltipText +=
                                            ` (Ex-Dividend: ${dataPoint.dividend})`;
                                    }
                                }

                                return tooltipText;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: "time",
                        time: {
                            unit: "day",
                            displayFormats: {
                                day: isMobile ? "MMM d" : "MMM dd, yyyy",
                            },
                        },
                        title: {
                            display: true,
                            text: "Date",
                            font: {
                                size: isMobile ? 10 : 12,
                            },
                        },
                        ticks: {
                            maxTicksLimit: isMobile ? 6 : 10,
                            font: {
                                size: isMobile ? 8 : 10,
                            },
                        },
                        // Extend x-axis to show full 90-day period when trend line is present
                        min: this.selectedStock ? this.getScoreDate(this.selectedFile) : undefined,
                        max: this.selectedStock ? new Date(this.getScoreDate(this.selectedFile).getTime() + (95 * 24 * 60 * 60 * 1000)) : undefined,
                    },
                    y: {
                        type: "linear",
                        display: true, // Show for both single stock and aggregate view
                        position: "left",
                        beginAtZero: true,
                        title: {
                            display: true, // Show for both views
                            text: "Performance (%)",
                            font: {
                                size: isMobile ? 10 : 12,
                            },
                        },
                        ticks: {
                            font: {
                                size: isMobile ? 8 : 10,
                            },
                            callback: function (value) {
                                return value + "%";
                            },
                        },
                        // Add padding to ensure target dot is fully visible
                        afterFit: function(axis) {
                            axis.paddingTop = 20;
                            axis.paddingBottom = 20;
                        },
                    },
                    y1: {
                        type: "linear",
                        display: false, // Hide the right Y-axis since we're not using price values
                        position: "right",
                        beginAtZero: true,
                        title: {
                            display: false,
                            text: "Price ($)",
                            font: {
                                size: isMobile ? 10 : 12,
                            },
                        },
                        ticks: {
                            font: {
                                size: isMobile ? 8 : 10,
                            },
                            callback: function (value) {
                                return "$" + value.toFixed(2);
                            },
                        },
                        grid: {
                            drawOnChartArea: false,
                        },
                    },
                },
                plugins: {
                    annotation: {
                        annotations: {
                            line1: {
                                type: "line",
                                xMin: this.setDateToMidnight(this.getScoreDate(this.selectedFile)),
                                xMax: this.setDateToMidnight(this.getScoreDate(this.selectedFile)),
                                borderColor: "rgba(255, 193, 7, 0.8)",
                                borderWidth: 2,
                                label: {
                                    content: "Score Date",
                                    enabled: true,
                                    font: {
                                        size: isMobile ? 8 : 10,
                                    },
                                },
                            },
                            line2: {
                                type: "line",
                                yMin: 0,
                                yMax: 0,
                                borderColor: "rgba(108, 117, 125, 0.5)",
                                borderWidth: 1,
                            },
                            // Add 90-day target line
                            line3: {
                                type: "line",
                                xMin: this.setDateToMidnight(new Date(
                                    this.getScoreDate(this.selectedFile)
                                        .getTime() +
                                        (90 * 24 * 60 * 60 * 1000),
                                )),
                                xMax: this.setDateToMidnight(new Date(
                                    this.getScoreDate(this.selectedFile)
                                        .getTime() +
                                        (90 * 24 * 60 * 60 * 1000),
                                )),
                                borderColor: "rgba(220, 53, 69, 0.8)",
                                borderWidth: 2,
                                label: {
                                    content: "90-Day Target",
                                    enabled: true,
                                    font: {
                                        size: isMobile ? 8 : 10,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        // Force hide legend on mobile after chart creation
        if (isMobile) {
            console.log("Forcing legend to be hidden on mobile");
            // Try multiple approaches to hide the legend
            setTimeout(() => {
                if (this.chart && this.chart.options.plugins.legend) {
                    this.chart.options.plugins.legend.display = false;
                    this.chart.update();
                }
                
                // Also try to hide any legend elements via CSS
                const legendElements = document.querySelectorAll('.chartjs-legend, .chart-container canvas + div');
                legendElements.forEach(el => {
                    el.style.display = 'none';
                    el.style.visibility = 'hidden';
                });
            }, 100);
        } else {
            // Ensure legend is at bottom for desktop devices
            console.log("Ensuring legend is positioned at bottom for desktop");
            setTimeout(() => {
                if (this.chart && this.chart.options.plugins.legend) {
                    this.chart.options.plugins.legend.position = "bottom";
                    this.chart.options.plugins.legend.align = "center";
                    this.chart.update();
                }
            }, 100);
        }
    }

    prepareChartData() {
        const breakpoint = this.getBootstrapBreakpoint();
        const isMobile = this.isMobileDevice();
        
        // On mobile, limit to 90 days for better readability
        const maxDays = isMobile ? 90 : 180;
        const maxDate = this.setDateToMidnight(new Date(
            this.getScoreDate(this.selectedFile).getTime() + (maxDays * 24 * 60 * 60 * 1000)
        ));

        // Debug logging for mobile data limitation
        if (isMobile) {
            console.log("Mobile detected - limiting chart data to 90 days for better readability");
            console.log("Max date for chart data:", maxDate.toISOString().split('T')[0]);
        }

        const datasets = [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        const daysElapsed = this.getDaysElapsed(scoreDate);
        const ninetyDayDate = this.setDateToMidnight(new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        ));

        console.log("prepareChartData - selectedStock:", this.selectedStock);
        console.log("prepareChartData - scoreDate:", scoreDate.toISOString().split('T')[0]);
        console.log("prepareChartData - daysElapsed:", daysElapsed);

        if (this.selectedStock) {
            // Single stock view
            const stock = this.scoreData.find((s) =>
                s.stock === this.selectedStock
            );
            if (stock) {
                const marketData = this.marketData[stock.stock];
                console.log(`prepareChartData - ${stock.stock} market data points:`, marketData ? marketData.length : 0);
                if (marketData && marketData.length > 0) {
                    const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);
                    const filteredMarketData = marketData.filter(point => point.date <= maxDate);
                    console.log(`prepareChartData - ${stock.stock} filtered market data points:`, filteredMarketData.length);
                    const before90Days = [];
                    const after90Days = [];
                    const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
                    console.log(`prepareChartData - ${stock.stock} buy price:`, buyPriceObj);
                    if (!buyPriceObj || !buyPriceObj.price || buyPriceObj.price <= 0) {
                        console.warn(`No valid buy price for ${stock.stock}, skipping chart data`);
                        return { datasets };
                    }
                    const buyPrice = buyPriceObj.price;
                    const stockDividends = this.dividendData?.[stock.stock] || [];
                    const exDivDates = stockDividends.map((d) => d.exDivDate.getTime());
                    filteredMarketData.forEach((point) => {
                        const adjustedPrice = this.adjustHistoricalPriceToCurrent(
                            (point.high + point.low) / 2,
                            stock.stock,
                            point.date,
                        );
                        let yValue = ((adjustedPrice - buyPrice) / buyPrice) * 100;
                        if (isNaN(yValue) || yValue === null) return; // skip invalid
                        const dataPoint = {
                            x: new Date(point.date.getTime()),
                            y: yValue,
                        };
                        
                        // Check if this is an ex-dividend date
                        const pointDateOnly = new Date(
                            point.date.getFullYear(),
                            point.date.getMonth(),
                            point.date.getDate(),
                        );
                        const isExDivDate = stockDividends.some((dividend) => {
                            const divDateOnly = new Date(
                                dividend.exDivDate.getFullYear(),
                                dividend.exDivDate.getMonth(),
                                dividend.exDivDate.getDate(),
                            );
                            return divDateOnly.getTime() === pointDateOnly.getTime();
                        });
                        
                        if (isExDivDate) {
                            dataPoint.dividend = true;
                        }
                        
                        if (point.date <= ninetyDayDate) {
                            before90Days.push(dataPoint);
                        } else {
                            after90Days.push(dataPoint);
                        }
                    });
                    console.log(`prepareChartData - ${stock.stock} before90Days points:`, before90Days.length);
                    console.log(`prepareChartData - ${stock.stock} after90Days points:`, after90Days.length);
                    // Filter out any invalid y values (defensive)
                    const cleanBefore90 = before90Days.filter(p => typeof p.y === 'number' && !isNaN(p.y));
                    const cleanAfter90 = after90Days.filter(p => typeof p.y === 'number' && !isNaN(p.y));
                    console.log(`prepareChartData - ${stock.stock} cleanBefore90 points:`, cleanBefore90.length);
                    console.log(`prepareChartData - ${stock.stock} cleanAfter90 points:`, cleanAfter90.length);
                    if (cleanBefore90.length > 0) {
                        datasets.push({
                            label: "Performance",
                            data: cleanBefore90,
                            borderColor: "rgba(102, 126, 234, 1)",
                            backgroundColor: "rgba(102, 126, 234, 0.1)",
                            borderWidth: 3,
                            fill: false,
                            pointRadius: cleanBefore90.map((point) => point.dividend ? 8 : 3),
                            pointBackgroundColor: cleanBefore90.map((point) =>
                                point.dividend ? "rgba(0, 123, 255, 1)" : "rgba(102, 126, 234, 1)"
                            ),
                        });
                    }
                    if (cleanAfter90.length > 0 && !isMobile) {
                        datasets.push({
                            label: "Performance (After 90 Days)",
                            data: cleanAfter90,
                            borderColor: "rgba(108, 117, 125, 0.5)",
                            backgroundColor: "rgba(108, 117, 125, 0.1)",
                            borderWidth: 1,
                            fill: false,
                            pointRadius: cleanAfter90.map((point) => point.dividend ? 8 : 3),
                            pointBackgroundColor: cleanAfter90.map((point) =>
                                point.dividend ? "rgba(108, 117, 125, 0.8)" : "rgba(108, 117, 125, 0.5)"
                            ),
                        });
                    }
                    // Add target dot for single stock view
                    if (targetPercentage !== null) {
                        datasets.push({
                            label: "Target",
                            data: [{
                                x: ninetyDayDate,
                                y: targetPercentage
                            }],
                            borderColor: "rgba(255, 193, 7, 1)",
                            backgroundColor: "rgba(255, 193, 7, 1)",
                            borderWidth: 0,
                            fill: false,
                            pointRadius: 8,
                            pointStyle: "circle",
                            showLine: false, // Only show the point, not a line
                        });
                    }
                    // ... existing target and trend line logic ...
                }
            }
        } else {
            // Portfolio view
            const portfolioData = this.calculatePortfolioData();
            console.log("prepareChartData - portfolio data points:", portfolioData.length);
            const before90Days = [];
            const after90Days = [];
            portfolioData.forEach((point) => {
                if (point.x <= ninetyDayDate) {
                    before90Days.push(point);
                } else {
                    after90Days.push(point);
                }
            });
            console.log("prepareChartData - portfolio before90Days points:", before90Days.length);
            console.log("prepareChartData - portfolio after90Days points:", after90Days.length);
            // Filter out any invalid y values
            const cleanBefore90 = before90Days.filter(p => typeof p.y === 'number' && !isNaN(p.y));
            const cleanAfter90 = after90Days.filter(p => typeof p.y === 'number' && !isNaN(p.y));
            console.log("prepareChartData - portfolio cleanBefore90 points:", cleanBefore90.length);
            console.log("prepareChartData - portfolio cleanAfter90 points:", cleanAfter90.length);
            if (cleanBefore90.length > 0) {
                datasets.push({
                    label: "Performance",
                    data: cleanBefore90,
                    borderColor: "rgba(102, 126, 234, 1)",
                    backgroundColor: "rgba(102, 126, 234, 0.1)",
                    borderWidth: 3,
                    fill: false,
                    pointRadius: 3,
                });
            }
            if (cleanAfter90.length > 0 && !isMobile) {
                datasets.push({
                    label: "Performance (After 90 Days)",
                    data: cleanAfter90,
                    borderColor: "rgba(108, 117, 125, 0.5)",
                    backgroundColor: "rgba(108, 117, 125, 0.1)",
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 3,
                });
            }
            // Add target dot for portfolio view
            const portfolioTarget = this.calculatePortfolioTargetPercentage();
            if (portfolioTarget !== null) {
                datasets.push({
                    label: "Target",
                    data: [{
                        x: ninetyDayDate,
                        y: portfolioTarget
                    }],
                    borderColor: "rgba(255, 193, 7, 1)",
                    backgroundColor: "rgba(255, 193, 7, 1)",
                    borderWidth: 0,
                    fill: false,
                    pointRadius: 8,
                    pointStyle: "circle",
                    showLine: false, // Only show the point, not a line
                });
            }
            // ... existing target logic ...
        }

        // Add hybrid projection for stocks that haven't reached 90 days yet
        if (this.selectedStock) {
            const stock = this.scoreData.find((s) => s.stock === this.selectedStock);
            if (stock) {
                console.log("Attempting to generate hybrid projection for:", this.selectedStock);
                const hybridData = this.calculateHybridProjectionData(stock, scoreDate);
                console.log("Hybrid projection result:", hybridData);
                
                if (hybridData && hybridData.projection.confidence > 0.2) {
                    console.log("Hybrid projection confidence:", hybridData.projection.confidence, "- generating projection data");
                    
                    const trendData = hybridData.data;
                    const projection = hybridData.projection;
                    
                    console.log("Generated hybrid projection data points:", trendData.length);
                    console.log("First projection point:", trendData[0]);
                    console.log("Last projection point:", trendData[trendData.length - 1]);
                    
                    // Choose color based on projection method and direction
                    let borderColor, backgroundColor, label;
                    if (projection.projectionMethod === "dampened_trend") {
                        if (projection.projected90DayPerformance > 0) {
                            borderColor = "rgba(40, 167, 69, 0.8)"; // Green for upward
                            backgroundColor = "rgba(40, 167, 69, 0.1)";
                            label = "Hybrid Projection (Upward)";
                        } else {
                            borderColor = "rgba(220, 53, 69, 0.8)"; // Red for downward
                            backgroundColor = "rgba(220, 53, 69, 0.1)";
                            label = "Hybrid Projection (Downward)";
                        }
                    } else {
                        borderColor = "rgba(138, 43, 226, 0.8)"; // Purple for target-based
                        backgroundColor = "rgba(138, 43, 226, 0.1)";
                        label = "Hybrid Projection (Target-Based)";
                    }
                    
                    datasets.push({
                        label: label,
                        data: trendData,
                        borderColor: borderColor,
                        backgroundColor: backgroundColor,
                        borderWidth: 2,
                        borderDash: [5, 5], // Dashed line
                        fill: false,
                        pointRadius: 0,
                        tension: 0.1,
                    });
                    
                    // Add a visible dot at the 90-day mark
                    const ninetyDayPoint = trendData[trendData.length - 1]; // Last point is at 90 days
                    datasets.push({
                        label: "Hybrid 90-Day Point",
                        data: [ninetyDayPoint],
                        borderColor: borderColor.replace("0.8", "1"), // Solid color
                        backgroundColor: backgroundColor.replace("0.1", "1"),
                        borderWidth: 0,
                        fill: false,
                        pointRadius: 6,
                        pointStyle: "circle",
                        showLine: false, // Only show the point, not a line
                    });
                } else {
                    if (!hybridData) {
                        console.log("Hybrid projection not generated - calculateHybridProjectionData returned null");
                    } else {
                        console.log("Hybrid projection not generated - confidence too low:", hybridData.projection.confidence, "(threshold: 0.2)");
                    }
                }
            }
        } else {
            // Portfolio view - use market data-based days elapsed
            const marketDataDaysElapsed = this.getDaysElapsedFromMarketData(scoreDate);
            console.log("Portfolio view - market data days elapsed:", marketDataDaysElapsed);
            
            // Always show trend line if we have less than 90 days of market data
            if (marketDataDaysElapsed < 90) {
                console.log("Attempting to generate portfolio trend line");
                const portfolioTrendLine = this.calculatePortfolioTrendLine();
                if (portfolioTrendLine) {
                    console.log("Portfolio trend line result:", portfolioTrendLine);
                    // Create trend line data points - extend to exactly 90 days
                    const trendData = [];
                    for (let day = 0; day <= 90; day += 7) {
                        const predictedPerformance = Math.max(portfolioTrendLine.slope * day + portfolioTrendLine.intercept, -100);
                        trendData.push({
                            x: new Date(scoreDate.getTime() + (day * 24 * 60 * 60 * 1000)),
                            y: predictedPerformance
                        });
                    }
                    // Ensure we have exactly 90 days as the last point
                    const lastPoint = trendData[trendData.length - 1];
                    const lastPointDay = (lastPoint.x.getTime() - scoreDate.getTime()) / (24 * 60 * 60 * 1000);
                    if (lastPointDay !== 90) {
                        const predictedPerformance90 = Math.max(portfolioTrendLine.slope * 90 + portfolioTrendLine.intercept, -100);
                        const trendDate = this.setDateToMidnight(new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000)));
                        trendData.push({
                            x: trendDate,
                            y: predictedPerformance90
                        });
                    }
                    console.log("Generated portfolio trend data points:", trendData.length);
                    console.log("First portfolio trend point:", trendData[0]);
                    console.log("Last portfolio trend point:", trendData[trendData.length - 1]);
                    // Style based on R² and days elapsed - higher confidence for late-stage predictions
                    let borderColor, backgroundColor, label;
                    const daysElapsed = marketDataDaysElapsed;
                    const rSquared = portfolioTrendLine.rSquared;
                    
                    // Adjust confidence threshold based on days elapsed
                    let confidenceThreshold = 0.05; // Default threshold
                    if (daysElapsed >= 60) {
                        confidenceThreshold = 0.01; // Much more lenient for late-stage predictions
                    } else if (daysElapsed >= 30) {
                        confidenceThreshold = 0.03; // Moderate threshold for mid-stage
                    }
                    
                    if (rSquared >= confidenceThreshold) {
                        borderColor = "rgba(138, 43, 226, 0.8)"; // Purple
                        backgroundColor = "rgba(138, 43, 226, 0.1)";
                        label = "Portfolio Trend Prediction";
                        console.log("Portfolio trend line - high confidence (R²:", rSquared.toFixed(3), ", days:", daysElapsed, ", threshold:", confidenceThreshold, ")");
                    } else {
                        borderColor = "rgba(108, 117, 125, 0.6)"; // Gray
                        backgroundColor = "rgba(108, 117, 125, 0.1)";
                        label = "Portfolio Trend (Low Confidence)";
                        console.log("Portfolio trend line - low confidence (R²:", rSquared.toFixed(3), ", days:", daysElapsed, ", threshold:", confidenceThreshold, ")");
                    }
                    datasets.push({
                        label: label,
                        data: trendData,
                        borderColor: borderColor,
                        backgroundColor: backgroundColor,
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        pointRadius: 0,
                        tension: 0.1,
                    });
                    // Add a visible dot at the 90-day mark
                    const ninetyDayPoint = trendData[trendData.length - 1];
                    datasets.push({
                        label: label + " 90-Day Point",
                        data: [ninetyDayPoint],
                        borderColor: borderColor.replace("0.8", "1").replace("0.6", "1"),
                        backgroundColor: backgroundColor.replace("0.1", "1"),
                        borderWidth: 0,
                        fill: false,
                        pointRadius: 6,
                        pointStyle: "circle",
                        showLine: false,
                    });
                } else {
                    console.log("Portfolio trend line not generated - calculatePortfolioTrendLine returned null");
                }
            } else {
                console.log("Portfolio view - 90 days or more of market data available, no trend line needed");
            }
        }

        // Add cost of capital line (remove dots)
        const costOfCapitalData = this.calculateCostOfCapitalData();
        if (costOfCapitalData.length > 0) {
            datasets.push({
                label: "Cost of Capital",
                data: costOfCapitalData,
                borderColor: "rgba(108, 117, 125, 0.8)",
                backgroundColor: "rgba(108, 117, 125, 0.1)",
                borderWidth: 2,
                fill: false,
                pointRadius: 0, // No points, just a line
            });
        }

        console.log("prepareChartData - final datasets count:", datasets.length);
        datasets.forEach((dataset, index) => {
            console.log(`prepareChartData - dataset ${index} (${dataset.label}):`, dataset.data.length, "points");
        });

        return { datasets };
    }

    calculatePortfolioData() {
        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        );
        const portfolioData = [];

        // Get all unique dates from market data (include all dates, not just 90 days)
        const allDates = new Set();
        this.scoreData.forEach((stock) => {
            const marketData = this.marketData[stock.stock];
            if (marketData) {
                marketData.forEach((point) => {
                    // Include all dates, not just within 90 days
                    allDates.add(point.date.getTime());
                });
            }
        });

        // Add the score date to ensure we start at zero
        allDates.add(scoreDate.getTime());

        const sortedDates = Array.from(allDates).sort((a, b) => a - b);

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

                        // Calculate price return
                        const priceReturn =
                            ((currentPrice - buyPrice) / buyPrice) * 100;

                        // Add dividend return up to this date (but only count dividends within 90 days)
                        const dividends = this.getDividendsWithin90Days(
                            stock.stock,
                        );
                        const dividendsUpToDate = dividends.filter((d) =>
                            d.exDivDate <= date
                        );
                        const totalDividends = dividendsUpToDate.reduce(
                            (sum, div) => sum + div.amount,
                            0,
                        );
                        const dividendReturn = (totalDividends / buyPrice) *
                            100;

                        // Total return including dividends
                        const totalReturn = priceReturn + dividendReturn;

                        totalPerformance += totalReturn;
                        validStocks++;
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
                                // Only count dividends within 90 days
                                if (d.exDivDate <= ninetyDayDate) {
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
        const breakpoint = this.getBootstrapBreakpoint();
        const isMobile = this.isMobileDevice();
        
        // On mobile, limit to 90 days for better readability
        const maxDays = isMobile ? 90 : 180;
        const maxDate = new Date(
            this.getScoreDate(this.selectedFile).getTime() + (maxDays * 24 * 60 * 60 * 1000)
        );

        // Debug logging for cost of capital mobile limitation
        if (isMobile) {
            console.log("Mobile detected - limiting cost of capital line to 90 days");
            console.log("Cost of capital max date:", maxDate.toISOString().split('T')[0]);
        }

        const scoreDate = this.getScoreDate(this.selectedFile);
        const costOfCapitalData = [];

        // Get all unique dates from market data (limit based on mobile/desktop)
        const allDates = new Set();
        this.scoreData.forEach((stock) => {
            const marketData = this.marketData[stock.stock];
            if (marketData) {
                marketData.forEach((point) => {
                    // Only include dates within the mobile/desktop limit
                    if (point.date <= maxDate) {
                        allDates.add(point.date.getTime());
                    }
                });
            }
        });

        const sortedDates = Array.from(allDates).sort((a, b) => a - b);

        sortedDates.forEach((timestamp) => {
            const date = new Date(timestamp);
            const daysSinceScore = (date - scoreDate) /
                (1000 * 60 * 60 * 24);
            // Cap cost of capital at 90 days to match portfolio view
            const cappedDaysSinceScore = Math.min(daysSinceScore, 90);
            const costOfCapitalReturn = (this.costOfCapital / 365) *
                cappedDaysSinceScore;

            costOfCapitalData.push({
                x: new Date(date.getTime()), // Create clean Date object
                y: costOfCapitalReturn,
            });
        });

        return costOfCapitalData;
    }

    getColor(index, alpha = 1) {
        const colors = [
            `rgba(220, 53, 69, ${alpha})`, // Red
            `rgba(40, 167, 69, ${alpha})`, // Green
            `rgba(255, 193, 7, ${alpha})`, // Yellow
            `rgba(23, 162, 184, ${alpha})`, // Cyan
            `rgba(111, 66, 193, ${alpha})`, // Purple
        ];
        return colors[index % colors.length];
    }

    updateStockTable() {
        const tbody = document.getElementById("stockTableBody");
        tbody.innerHTML = "";

        // Remove any existing summary elements first
        const existingSummary = document.querySelector(
            ".portfolio-summary",
        );
        if (existingSummary) {
            existingSummary.remove();
        }

        // Determine which stocks to show
        const stocksToShow = this.selectedStock
            ? this.scoreData.filter((stock) =>
                stock.stock === this.selectedStock
            )
            : this.scoreData;

        if (this.selectedStock) {
            // Single stock view - show as card instead of table
            const stock = stocksToShow[0];
            if (stock) {
                const performance = this.calculateStockPerformance(stock);
                const judgement = this.calculateJudgement(
                    stock,
                    performance,
                );
                const dividends = this.getDividendsWithin90Days(
                    stock.stock,
                );
                const totalDividends = dividends.reduce(
                    (sum, div) => sum + div.amount,
                    0,
                );

                // Calculate buy price using market data on score date
                const scoreDate = this.getScoreDate(this.selectedFile);
                const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
                const buyPrice = buyPriceObj ? buyPriceObj.price : null;
                const buyPriceDateUsed = buyPriceObj ? buyPriceObj.dateUsed : null;
                const target = this.adjustHistoricalPriceToCurrent(
                    stock.target,
                    stock.stock,
                    scoreDate,
                );

                // Hide the table and show card
                const tableContainer = document.querySelector(
                    ".table-responsive",
                );
                tableContainer.style.display = "none";

                // Create or update stock detail card
                let stockCard = document.getElementById(
                    "stockDetailCard",
                );
                if (!stockCard) {
                    stockCard = document.createElement("div");
                    stockCard.id = "stockDetailCard";
                    stockCard.className = "card mb-4";
                    tableContainer.parentNode.insertBefore(
                        stockCard,
                        tableContainer,
                    );
                }

                stockCard.innerHTML = `
            <div class="card-header">
              <h5 class="card-title mb-0">${stock.stock} - Detailed Information</h5>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="col-md-6">
                  <h6 class="text-muted text-uppercase mb-3">Basic Information</h6>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Score:</strong></div>
                    <div class="col-6">${stock.score.toFixed(3)}</div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Buy Price:</strong></div>
                    <div class="col-6">
                        <span class="clickable-value" 
                            data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                            data-bs-title="Buy Price - ${stock.stock}" 
                            data-field="buy-price" 
                            data-stock="${stock.stock}"
                            style="${buyPrice === null ? 'color: #c00; font-weight: bold;' : ''}"
                        >${this.formatCurrency(buyPrice)}</span>
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>90-Day Target:</strong></div>
                    <div class="col-6">
                        <span class="clickable-value" 
                            data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                            data-bs-title="90-Day Target - ${stock.stock}" 
                            data-field="target" 
                            data-stock="${stock.stock}"
                            style="${target === null ? 'color: #c00; font-weight: bold;' : ''}"
                        >${this.formatCurrency(target)}</span>
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Target Percentage:</strong></div>
                    <div class="col-6"><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Target Percentage - ${stock.stock}" data-field="target-percentage" data-stock="${stock.stock}">${
    buyPrice !== null && buyPrice > 0 && target !== null
        ? ((target - buyPrice) / buyPrice * 100).toFixed(1) + "%"
        : "N/A"
}</span></div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Current Price:</strong></div>
                    <div class="col-6">
                        <span class="clickable-value" 
                            data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                            data-bs-title="Current Price - ${stock.stock}" 
                            data-field="current-price" 
                            data-stock="${stock.stock}"
                        >${this.formatCurrency(this.getCurrentPrice(stock.stock))}</span>
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Performance:</strong></div>
                    <div class="col-6">
                      <span class="clickable-value ${
                    this.getPerformanceClass(performance)
                }" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Gain/Loss - ${stock.stock}" data-field="gain-loss" data-stock="${stock.stock}">${
    performance !== null ? performance.toFixed(1) + "%" : "N/A"
}</span>
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Progress vs Cost of Capital:</strong></div>
                    <div class="col-6">
                      <span class="clickable-value ${
                    this.getPerformanceClass(this.calculateProgressVsCostOfCapitalValue(stock, performance))
                }" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Progress vs Cost of Capital - ${stock.stock}" data-field="progress-vs-cost" data-stock="${stock.stock}">${
                    this.calculateProgressVsCostOfCapital(
                        stock,
                        performance,
                    )
                }</span>
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Judgement:</strong></div>
                    <div class="col-6">
                      <span class="badge ${this.getJudgementClass(judgement)}">
                        <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Judgement - ${stock.stock}" data-field="judgement" data-stock="${stock.stock}">${judgement}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div class="col-md-6">
                  <h6 class="text-muted text-uppercase mb-3">Valuation & Dividends</h6>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Intrinsic Value (Basic):</strong></div>
                    <div class="col-6">
                        <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                        data-bs-title="Intrinsic Value (Basic) - ${stock.stock}" data-field="intrinsic-basic" data-stock="${stock.stock}">${this.formatCurrency(this.adjustHistoricalPriceToCurrent(stock.intrinsicValuePerShareBasic, stock.stock, this.getScoreDate(this.selectedFile)))}</span></div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Intrinsic Value (Adjusted):</strong></div>
                    <div class="col-6">
                        <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                        data-bs-title="Intrinsic Value (Adjusted) - ${stock.stock}" data-field="intrinsic-adjusted" data-stock="${stock.stock}">${this.formatCurrency(this.adjustHistoricalPriceToCurrent(stock.intrinsicValuePerShareAdjusted, stock.stock, this.getScoreDate(this.selectedFile)))}</span></div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Ex-Dividend Date:</strong></div>
                    <div class="col-6">${this.getNextExDividendDate(stock.stock)}</div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Average Dividend (90-day):</strong></div>
                    <div class="col-6"><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Average Dividend (90-day) - ${stock.stock}" data-field="avg-dividend" data-stock="${stock.stock}">${
                    dividends.length > 0
                        ? "$" + (totalDividends / dividends.length).toFixed(4)
                        : "N/A"
                }</span></div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Total Dividends (90-day):</strong></div>
                    <div class="col-6">
                      <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Total Dividends (90-day) - ${stock.stock}" data-field="total-dividend" data-stock="${stock.stock}">${
                    dividends.length > 0
                        ? `$${
                            totalDividends.toFixed(2)
                        } (${dividends.length} div${
                            dividends.length > 1 ? "s" : ""
                        })`
                        : "None"
                }</span>
                    </div>
                  </div>
                </div>
              </div>
              ${
                    stock.notes
                        ? `
                <div class="row mt-3">
                  <div class="col-12">
                    <h6 class="text-muted text-uppercase mb-2">Notes</h6>
                    <div class="stock-notes p-3 bg-light rounded">
                      ${stock.notes}
                    </div>
                  </div>
                </div>
              `
                        : ""
                }
            </div>
          `;
            }
        } else {
            // Aggregate view - show table
            const tableContainer = document.querySelector(
                ".table-responsive",
            );
            tableContainer.style.display = "block";

            // Remove stock detail card if it exists
            const stockCard = document.getElementById(
                "stockDetailCard",
            );
            if (stockCard) {
                stockCard.remove();
            }

            // Update table headers for aggregate view
            const thead = document.querySelector(
                "#stockTable thead tr",
            );
            thead.innerHTML = `
          <th>Stock</th>
          <th>Buy Price</th>
          <th>90-Day Target</th>
          <th>Current Price</th>
          <th>Gain/Loss (%)</th>
          <th>Progress vs Cost of Capital</th>
          <th>Status/Projection</th>
          <th>Dividends</th>
        `;

            let totalPerformance = 0;
            let validStocks = 0;

            stocksToShow.forEach((stock) => {
                const row = document.createElement("tr");
                const scoreDate = this.getScoreDate(this.selectedFile);
                const ninetyDayDate = new Date(
                    scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
                );
                const marketData = this.marketData[stock.stock];
                // Split-adjusted buy price and target
                // buy price should be the (high + low) / 2 on the score date
                const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
                const buyPrice = buyPriceObj ? buyPriceObj.price : null;
                const buyPriceDateUsed = buyPriceObj ? buyPriceObj.dateUsed : null;
                const target = this.adjustHistoricalPriceToCurrent(
                    stock.target,
                    stock.stock,
                    scoreDate,
                );
                // Current price (already post-split, no adjustment needed)
                let currentPrice = null;
                if (marketData && marketData.length > 0) {
                    const within90Days = marketData.filter((point) =>
                        point.date <= ninetyDayDate
                    );
                    if (within90Days.length > 0) {
                        const lastData = within90Days[within90Days.length - 1];
                        currentPrice = (lastData.high + lastData.low) / 2; // No split adjustment needed
                    }
                }
                // Gain/loss calculation (split-adjusted)
                let performance = this.calculateStockPerformanceWithDilution(stock, scoreDate);
                const judgement = this.calculateJudgement(
                    stock,
                    performance,
                );
                // Get dividend information (only within 90 days)
                const dividends = this.getDividendsWithin90Days(
                    stock.stock,
                );
                const totalDividends = dividends.reduce(
                    (sum, div) => sum + div.amount,
                    0,
                );
                const dividendInfo = dividends.length > 0
                    ? `$${totalDividends.toFixed(2)} (${dividends.length} div${
                        dividends.length > 1 ? "s" : ""
                    })`
                    : "None";
                // Aggregate view
                row.innerHTML = `
            <td class="clickable-stock" onclick="validator.showStockDetails('${stock.stock}')">${stock.stock}</td>
            <td>
                <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Buy Price - ${stock.stock}" 
                    data-field="buy-price" data-stock="${stock.stock}" 
                    style="${buyPrice === null ? 'color: #c00; font-weight: bold;' : ''}"
                >${this.formatCurrency(buyPrice)}</span>
            </td>
            <td>
            <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="90-Day Target - ${stock.stock}" data-field="target" data-stock="${stock.stock}">${this.formatCurrency(target)
                }</span></td>
            <td>
                <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                   data-bs-title="Current Price - ${stock.stock}" data-field="current-price" data-stock="${stock.stock}">${this.formatCurrency(currentPrice)}
                </span>
            </td>
            <td><span class="clickable-value ${
                    this.getPerformanceClass(performance)
                }" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Gain/Loss - ${stock.stock}" data-field="gain-loss" data-stock="${stock.stock}">${
    performance !== null ? performance.toFixed(1) + "%" : "N/A"
}</span></td>
            <td><span class="clickable-value ${
                    this.getPerformanceClass(this.calculateProgressVsCostOfCapitalValue(stock, performance))
                }" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Progress vs Cost of Capital - ${stock.stock}" data-field="progress-vs-cost" data-stock="${stock.stock}">${
                    this.calculateProgressVsCostOfCapital(
                        stock,
                        performance,
                    )
                }</span></td>
            <td><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Status/Projection - ${stock.stock}" data-field="status-projection" data-stock="${stock.stock}"><span class="badge ${
                    this.getJudgementClass(judgement)
                }">${judgement}</span></span></td>
            <td><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Dividends - ${stock.stock}" data-field="dividend-info" data-stock="${stock.stock}">${dividendInfo}</span></td>
          `;
                // Add highlighting for selected stock in aggregate view
                if (this.selectedStock === stock.stock) {
                    row.classList.add("table-primary");
                }
                tbody.appendChild(row);
            });

            // Add totals row for aggregate view
            const scoreFile = this.selectedFile;
            const scoreDate = this.getScoreDate(scoreFile);
            const marketDataDaysElapsed = this.getDaysElapsedFromMarketData(scoreDate);
            const portfolioPerformance90Day = this
                .calculatePortfolioPerformance90Day();
            const portfolioTarget = this
                .calculatePortfolioTargetPercentage();

            // Use market data-based days elapsed (already capped at 90)
            const actualDaysElapsed = marketDataDaysElapsed;

            const totalsRow = document.createElement("tr");
            totalsRow.classList.add("table-info", "fw-bold");
            totalsRow.innerHTML = `
          <td>Days Elapsed: ${actualDaysElapsed}</td>
          <td>-</td>
          <td><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Portfolio Target" data-field="portfolio-target" data-stock="">${
                portfolioTarget.toFixed(1)
            }%</span></td>
          <td>-</td>
          <td class="${this.getPerformanceClass(portfolioPerformance90Day)}">${
                portfolioPerformance90Day.toFixed(1)
            }%</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
        `;

            tbody.appendChild(totalsRow);
        }

        // Dispose of existing popovers
        const existingPopovers = document.querySelectorAll(
            '.clickable-value[data-bs-toggle="popover"]',
        );
        existingPopovers.forEach((element) => {
            const popover = bootstrap.Popover.getInstance(element);
            if (popover) {
                popover.dispose();
            }
        });

        // Loop through all .clickable-value elements
        const clickableValues = document.querySelectorAll(
            ".clickable-value",
        );
        clickableValues.forEach((value) => {
            const field = value.getAttribute("data-field");
            const stock = value.getAttribute("data-stock");

            // Generate the popover content using the actual values for that stock/field
            let working;
            if (field === "portfolio-target") {
                // Special handling for portfolio target - no specific stock
                working = this.getWorking(field, "", this.scoreData);
            } else {
                working = this.getWorking(field, stock, this.scoreData);
            }

            // Set the data-bs-content attribute
            value.setAttribute("data-bs-content", working);

            // Initialize the Bootstrap popover
            new bootstrap.Popover(value, {
                trigger: "manual",
                html: false,
                container: "body",
            });
        });

    }

    updateBasicStockTable() {
        const tbody = document.getElementById("stockTableBody");
        tbody.innerHTML = "";

        // Remove any existing summary elements first
        const existingSummary = document.querySelector(".portfolio-summary");
        if (existingSummary) {
            existingSummary.remove();
        }

        // Show the table container
        const tableContainer = document.querySelector(".table-responsive");
        tableContainer.style.display = "block";

        // Remove stock detail card if it exists
        const stockCard = document.getElementById("stockDetailCard");
        if (stockCard) {
            stockCard.remove();
        }

        // Update table headers for basic view (no market data)
        const thead = document.querySelector("#stockTable thead tr");
        thead.innerHTML = `
            <th>Stock</th>
            <th>Score</th>
            <th>90-Day Target</th>
            <th>Ex-Dividend Date</th>
            <th>Dividend Per Share</th>
            <th>Intrinsic Value (Basic)</th>
            <th>Intrinsic Value (Adjusted)</th>
            <th>Notes</th>
        `;

        // Show all stocks with basic score data
        this.scoreData.forEach((stock) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${stock.stock}</td>
                <td>${stock.score.toFixed(3)}</td>
                <td>${this.formatCurrency(stock.target)}</td>
                <td>${stock.exDividendDate || "N/A"}</td>
                <td>${stock.dividendPerShare ? this.formatCurrency(stock.dividendPerShare) : "N/A"}</td>
                <td>${stock.intrinsicValuePerShareBasic ? this.formatCurrency(stock.intrinsicValuePerShareBasic) : "N/A"}</td>
                <td>${stock.intrinsicValuePerShareAdjusted ? this.formatCurrency(stock.intrinsicValuePerShareAdjusted) : "N/A"}</td>
                <td>${stock.notes || ""}</td>
            `;
            tbody.appendChild(row);
        });

        // Add summary row
        const summaryRow = document.createElement("tr");
        summaryRow.classList.add("table-info", "fw-bold");
        const scoreDate = this.getScoreDate(this.selectedFile);
        const daysElapsed = this.getDaysElapsed(scoreDate);
        summaryRow.innerHTML = `
            <td>Score Date: ${scoreDate.toISOString().split('T')[0]} (${daysElapsed} days ago)</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
        `;
        tbody.appendChild(summaryRow);
    }

    getDividendsWithin90Days(stockSymbol) {
        const dividends = this.dividendData?.[stockSymbol] || [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        );

        return dividends.filter((dividend) =>
            dividend.exDivDate <= ninetyDayDate
        );
    }

    getCurrentPrice(stockSymbol) {
        const marketData = this.marketData[stockSymbol];
        if (!marketData || marketData.length === 0) return "N/A";

        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        );

        // Find the last price within 90 days
        const within90Days = marketData.filter((point) =>
            point.date <= ninetyDayDate
        );
        if (within90Days.length === 0) return "N/A";

        const lastData = within90Days[within90Days.length - 1];
        const currentPrice = (lastData.high + lastData.low) / 2; // Already post-split
        return "$" + currentPrice.toFixed(2);
    }

    calculateProgressVsCostOfCapital(stock, performance) {
        if (performance === null) return "N/A";

        const value = this.calculateProgressVsCostOfCapitalValue(stock, performance);
        return value.toFixed(1) + "%";
    }

    calculateProgressVsCostOfCapitalValue(stock, performance) {
        if (performance === null) return null;

        // Use market data-based days elapsed for cost of capital calculation to match working
        const daysElapsed = this.getDaysElapsedFromMarketData(this.getScoreDate(this.selectedFile));
        const costOfCapitalReturn = (this.costOfCapital / 365) * daysElapsed;

        const excessReturn = performance - costOfCapitalReturn;
        return excessReturn;
    }

    calculateJudgement(stock, performance) {
        if (performance === null) return "Pending";

        const scoreDate = this.getScoreDate(this.selectedFile);
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
                // Not enough data for reliable prediction - use current performance with context
                const target = targetPercentage || 20; // Default to 20% if no target
                const threshold = target * 0.8; // 80% of target
                
                if (daysElapsed < 30) {
                    // First 30 days - truly early
                    if (performance > 0) {
                        return `Early Days (+${performance.toFixed(1)}%)`;
                    } else {
                        return `Early Days (${performance.toFixed(1)}%)`;
                    }
                } else if (daysElapsed < 60) {
                    // 30-60 days - mid period
                    if (performance >= threshold) {
                        return `On Track (${performance.toFixed(1)}%)`;
                    } else if (performance > 0) {
                        return `Below Target (${performance.toFixed(1)}%)`;
                    } else {
                        return `Declining (${performance.toFixed(1)}%)`;
                    }
                } else {
                    // 60+ days - late period, should have good data
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
            const target = targetPercentage || 20; // Default to 20% if no target
            const threshold = target * 0.8; // 80% of target

            if (performance >= threshold) {
                return "Hit Target";
            } else if (performance > 0) {
                return "Partial Success";
            } else {
                return "Missed Target";
            }
        }
    }

    getPerformanceClass(performance) {
        if (performance === null) return "performance-neutral";
        return performance >= 0
            ? "performance-positive"
            : "performance-negative";
    }

    getJudgementClass(judgement) {
        if (judgement.startsWith("On Track")) {
            return "judgement-hit";
        } else if (judgement.startsWith("Hit Target")) {
            return "judgement-hit";
        } else if (judgement.startsWith("Below Target") || judgement.startsWith("Partial Success")) {
            return "judgement-partial";
        } else if (judgement.startsWith("Declining") || judgement.startsWith("Missed Target")) {
            return "judgement-miss";
        } else if (judgement.startsWith("Early Days")) {
            // Check if the performance is positive or negative
            if (judgement.includes("(-")) {
                return "judgement-miss"; // Red for negative performance
            } else if (judgement.includes("(+")) {
                return "judgement-hit"; // Green for positive performance
            } else {
                return "bg-info"; // Blue for neutral/unknown
            }
        } else {
            return "bg-secondary";
        }
    }

    showStockDetails(stockSymbol) {
        this.selectedStock = stockSymbol;
        this.updateDisplay();

        // Show the back button
        document.getElementById("backToAggregate").style.display = "block";
    }

    showLoading() {
        document.getElementById("loading").style.display = "block";
        document.getElementById("summary").style.display = "none";
        document.getElementById("error").style.display = "none";
        document.getElementById("noData").style.display = "none";
    }

    showError(message) {
        document.getElementById("loading").style.display = "none";
        document.getElementById("summary").style.display = "none";
        document.getElementById("noData").style.display = "none";
        document.getElementById("error").style.display = "block";
        document.getElementById("error").textContent = message;
    }

    showNoData() {
        document.getElementById("loading").style.display = "none";
        document.getElementById("summary").style.display = "none";
        document.getElementById("error").style.display = "none";
        document.getElementById("noData").style.display = "block";
    }

    showBasicScoreTable() {
        // Hide loading and error messages, show summary
        document.getElementById("loading").style.display = "none";
        document.getElementById("error").style.display = "none";
        document.getElementById("noData").style.display = "none";
        document.getElementById("summary").style.display = "block";

        // Hide the chart since we don't have market data
        const chartContainer = document.getElementById("performanceChart").parentElement;
        if (chartContainer) {
            chartContainer.style.display = "none";
        }

        // Show a message about market data
        const summaryElement = document.getElementById("summary");
        const existingMessage = summaryElement.querySelector(".no-market-data-message");
        if (!existingMessage) {
            const messageDiv = document.createElement("div");
            messageDiv.className = "alert alert-info no-market-data-message mb-3";
            messageDiv.innerHTML = `
                <i class="fas fa-info-circle"></i>
                <strong>Market data not yet available.</strong> 
                The chart and performance calculations will appear once market data becomes available. 
                Below is the score data from the selected date.
            `;
            summaryElement.insertBefore(messageDiv, summaryElement.firstChild);
        }

        // Update the stock table with basic information only
        this.updateBasicStockTable();

        // Hide back button since we're in aggregate view
        document.getElementById("backToAggregate").style.display = "none";

        // Remove stock detail view class
        const tableContainer = document.querySelector(".table-responsive");
        if (tableContainer) {
            tableContainer.classList.remove("stock-detail-view");
        }
    }

    hideMessages() {
        document.getElementById("loading").style.display = "none";
        document.getElementById("error").style.display = "none";
        document.getElementById("noData").style.display = "none";
        document.getElementById("summary").style.display = "block";
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
        const today = new Date();
        const diffTime = Math.abs(today - scoreDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
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

        // Calculate days from score date to latest market data date
        const diffTime = Math.abs(latestMarketDate - scoreDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Cap at 90 days for portfolio view consistency
        return Math.min(diffDays, 90);
    }

    calculateStockPerformance(stock) {
        const marketData = this.marketData[stock.stock];
        if (!marketData || marketData.length === 0) return null;

        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        );

        // Find the last price within 90 days
        const within90Days = marketData.filter((point) =>
            point.date <= ninetyDayDate
        );
        if (within90Days.length === 0) return null;

        const lastData = within90Days[within90Days.length - 1];
        const currentPrice = (lastData.high + lastData.low) / 2; // Already post-split

        // Get the price on the score date as the buy price (adjusted to current price level)
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        if (!buyPriceObj || !buyPriceObj.price || buyPriceObj.price <= 0) {
            return null;
        }
        const buyPrice = buyPriceObj.price;

        // Calculate price return
        const priceReturn = ((currentPrice - buyPrice) / buyPrice) *
            100;

        // Add dividend return within 90 days
        const dividends = this.getDividendsWithin90Days(stock.stock);
        const totalDividends = dividends.reduce(
            (sum, div) => sum + div.amount,
            0,
        );
        const dividendReturn = (totalDividends / buyPrice) * 100;

        // Total return including dividends
        return priceReturn + dividendReturn;
    }

    calculatePortfolioTargetPercentage() {
        // Calculate portfolio target based on the actual targets of all stocks
        let totalTarget = 0;
        let validStocks = 0;
        const scoreDate = this.getScoreDate(this.selectedFile);

        this.scoreData.forEach((stock) => {
            if (stock.target !== null && !isNaN(stock.target)) {
                // Use centralized method to calculate target percentage
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
        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
        );

        let totalPerformance = 0;
        let validStocks = 0;

        this.scoreData.forEach((stock) => {
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

    getWorking(field, stockSymbol, scoreData) {
        // Special handling for portfolio target - no specific stock needed
        if (field === "portfolio-target") {
            const portfolioTargetValue = this
                .calculatePortfolioTargetPercentage();
            const scoreDate = this.getScoreDate(this.selectedFile);

            // Calculate individual stock targets for display
            let targetDetails = [];
            let totalTarget = 0;
            let validStocks = 0;

            this.scoreData.forEach((stock) => {
                if (stock.target !== null && !isNaN(stock.target)) {
                    const buyPrice = this.getBuyPrice(
                        stock.stock,
                        scoreDate,
                    );
                    if (buyPrice !== null) {
                        const targetPercentage =
                            ((stock.target - buyPrice.price) / buyPrice.price) * 100;
                        targetDetails.push(
                            `${stock.stock}: ${targetPercentage.toFixed(1)}%`,
                        );
                        totalTarget += targetPercentage;
                        validStocks++;
                    }
                }
            });

            return `Portfolio Target working:\n= Average target of all stocks in portfolio\n= Individual targets:\n  ${
                targetDetails.join("\n  ")
            }\n= Total: ${
                totalTarget.toFixed(1)
            }% / ${validStocks} stocks\n= Portfolio target: ${
                portfolioTargetValue.toFixed(1)
            }%`;
        }

        const stock = scoreData.find((s) => s.stock === stockSymbol);
        if (!stock) return "Stock not found";

        const scoreDate = this.getScoreDate(this.selectedFile);
        const header = `Stock: ${stockSymbol} | Field: ${field} | Score Date: ${
            scoreDate.toISOString().split("T")[0]
        }\n\n`;

        switch (field) {
            case "buy-price":
                const buyPriceObj = this.getBuyPrice(stockSymbol, scoreDate);
                let buyPrice = buyPriceObj ? buyPriceObj.price : null;
                let buyPriceDateUsed = buyPriceObj ? buyPriceObj.dateUsed : null;
                let buyPriceExplanation;
                let buyPriceError = false;

                if (buyPriceObj) {
                    buyPriceExplanation = (buyPriceDateUsed && buyPriceDateUsed.getTime() === scoreDate.getTime())
                        ? "Market price on score date"
                        : `Market price on next available trading day (${buyPriceDateUsed.toISOString().split("T")[0]})`;
                } else {
                    buyPriceError = true;
                }

                const buyPriceSplitAdjustment = !buyPriceError ? this
                    .getHistoricalToCurrentSplitAdjustment(
                        stockSymbol,
                        scoreDate,
                    ) : 1.0;
                const adjustedBuyPrice = !buyPriceError ? buyPrice : null;

                if (buyPriceError) {
                    return header +
                        `Buy Price ERROR:\n= No market price found within 5 days of the score date. Data error.`;
                } else if (buyPriceSplitAdjustment > 1.0) {
                    return header +
                        `Buy Price working:\n= ${buyPriceExplanation} (adjusted for ${buyPriceSplitAdjustment}:1 split)\n= Date used: ${buyPriceDateUsed.toISOString().split("T")[0]}\n= Original: $${
                            adjustedBuyPrice.toFixed(2)
                        }\n= Split adjustment: ÷ ${buyPriceSplitAdjustment}\n= Adjusted: $${
                            adjustedBuyPrice.toFixed(2)
                        }`;
                } else {
                    return header +
                        `Buy Price working:\n= ${buyPriceExplanation}\n= Date used: ${buyPriceDateUsed.toISOString().split("T")[0]}\n= $${
                            adjustedBuyPrice.toFixed(2)
                        }`;
                }
            case "target":
                const targetSplitAdjustment = this
                    .getHistoricalToCurrentSplitAdjustment(
                        stockSymbol,
                        scoreDate,
                    );
                const adjustedTarget = this
                    .adjustHistoricalPriceToCurrent(
                        stock.target,
                        stockSymbol,
                        scoreDate,
                    );
                if (targetSplitAdjustment > 1.0) {
                    return header +
                        `90-Day Target working:\n= Target price from score file (adjusted for ${targetSplitAdjustment}:1 split)\n= Original: $${
                            stock.target.toFixed(2)
                        }\n= Split adjustment: ÷ ${targetSplitAdjustment}\n= Adjusted: $${
                            adjustedTarget.toFixed(2)
                        }`;
                } else {
                    return header +
                        `90-Day Target working:\n= Target price from score file\n= ${this.formatCurrency(stock.target)}\n= ${this.formatCurrency(adjustedTarget)}`;
                }
            case "target-percentage":
                const targetPercentage = this.calculateTargetPercentage(stock, scoreDate);
                if (targetPercentage !== null) {
                    const buyPrice = this.getBuyPrice(stockSymbol, scoreDate);
                    if (buyPrice !== null) {
                        const adjustedTarget = this.adjustHistoricalPriceToCurrent(
                            stock.target,
                            stockSymbol,
                            scoreDate
                        );
                        return header +
                            `Target Percentage working:\n= ((Target Price - Buy Price) / Buy Price) × 100\n= (($${
                                adjustedTarget.toFixed(2)
                            } - $${buyPrice.price.toFixed(2)}) / $${
                                buyPrice.price.toFixed(2)
                            }) × 100\n= $${
                                (adjustedTarget - buyPrice.price).toFixed(2)
                            } / $${buyPrice.price.toFixed(2)} × 100\n= ${
                                targetPercentage.toFixed(1)
                            }%`;
                    } else {
                        return header +
                            `Target Percentage working:\n= ((Target Price - Buy Price) / Buy Price) × 100\n= No buy price available`;
                    }
                } else {
                    return header +
                        `Target Percentage working:\n= ((Target Price - Buy Price) / Buy Price) × 100\n= Insufficient data to calculate`;
                }
            case "current-price":
                const marketData = this.marketData[stockSymbol];
                if (!marketData || marketData.length === 0) {
                    return header +
                        "Current Price working:\nNo market data available";
                }
                const lastData = marketData[marketData.length - 1];
                const currentPrice = (lastData.high + lastData.low) / 2; // Already post-split
                const currentSplitAdjustment = this
                    .getHistoricalToCurrentSplitAdjustment(
                        stockSymbol,
                        lastData.date,
                    );
                if (currentSplitAdjustment > 1.0) {
                    return header +
                        `Current Price working:\n= (High + Low) / 2 from latest market data (post-split)\n= ($${
                            lastData.high.toFixed(2)
                        } + $${lastData.low.toFixed(2)}) / 2\n= $${
                            currentPrice.toFixed(2)
                        } (already post-split, no adjustment needed)`;
                } else {
                    return header +
                        `Current Price working:\n= (High + Low) / 2 from latest market data\n= ($${
                            lastData.high.toFixed(2)
                        } + $${lastData.low.toFixed(2)}) / 2\n= $${
                            currentPrice.toFixed(2)
                        }`;
                }
            case "gain-loss":
                const gainLossPerformance = this.calculateStockPerformanceWithDilution(stock, scoreDate);
                if (gainLossPerformance === null) {
                    return header +
                        "Gain/Loss working:\nNo market data available";
                }
                
                const gainLossBuyPrice = this.getBuyPrice(stockSymbol, scoreDate);
                if (gainLossBuyPrice === null) {
                    return header +
                        "Gain/Loss working:\nNo buy price available";
                }
                
                const gainLossDividends = this.getDividendsWithin90Days(stockSymbol);
                const gainLossTotalDividends = gainLossDividends.reduce((sum, div) => sum + div.amount, 0);
                
                // Get current price for display
                const gainLossMarketData = this.marketData[stockSymbol];
                const gainLossNinetyDayDate = new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000));
                const gainLossWithin90Days = gainLossMarketData.filter((point) => point.date <= gainLossNinetyDayDate);
                const gainLossLastData = gainLossWithin90Days[gainLossWithin90Days.length - 1];
                const gainLossCurrentPrice = (gainLossLastData.high + gainLossLastData.low) / 2;

                // Get split adjustments for display
                const gainLossBuyPriceSplitAdjustment = this.getHistoricalToCurrentSplitAdjustment(
                    stockSymbol,
                    scoreDate
                );

                if (gainLossBuyPriceSplitAdjustment > 1.0) {
                    const gainLossOriginalBuyPrice = gainLossBuyPrice.price * gainLossBuyPriceSplitAdjustment;
                    return header +
                        `Gain/Loss (%) working:\n= ((Current Price + Total Dividends - Buy Price) / Buy Price) × 100\n= (($${
                            gainLossCurrentPrice.toFixed(2)
                        } + $${gainLossTotalDividends.toFixed(2)} - $${
                            gainLossBuyPrice.price.toFixed(2)
                        }) / $${gainLossBuyPrice.price.toFixed(2)}) × 100\n= ($${
                            (gainLossCurrentPrice + gainLossTotalDividends).toFixed(2)
                        } - $${gainLossBuyPrice.price.toFixed(2)}) / $${
                            gainLossBuyPrice.price.toFixed(2)
                        } × 100\n= $${
                            (gainLossCurrentPrice + gainLossTotalDividends - gainLossBuyPrice.price).toFixed(2)
                        } / $${gainLossBuyPrice.price.toFixed(2)} × 100\n= ${
                            gainLossPerformance.toFixed(1)
                        }%\n\nSplit Adjustments:\n- Buy Price: $${
                            gainLossOriginalBuyPrice.toFixed(2)
                        } ÷ ${gainLossBuyPriceSplitAdjustment} = $${
                            gainLossBuyPrice.price.toFixed(2)
                        }\n- Current Price: $${
                            gainLossCurrentPrice.toFixed(2)
                        } (already post-split, no adjustment needed)`;
                } else {
                    return header +
                        `Gain/Loss (%) working:\n= ((Current Price + Total Dividends - Buy Price) / Buy Price) × 100\n= (($${
                            gainLossCurrentPrice.toFixed(2)
                        } + $${gainLossTotalDividends.toFixed(2)} - $${
                            gainLossBuyPrice.price.toFixed(2)
                        }) / $${gainLossBuyPrice.price.toFixed(2)}) × 100\n= ($${
                            (gainLossCurrentPrice + gainLossTotalDividends).toFixed(2)
                        } - $${gainLossBuyPrice.price.toFixed(2)}) / $${
                            gainLossBuyPrice.price.toFixed(2)
                        } × 100\n= $${
                            (gainLossCurrentPrice + gainLossTotalDividends - gainLossBuyPrice.price).toFixed(2)
                        } / $${gainLossBuyPrice.price.toFixed(2)} × 100\n= ${
                            gainLossPerformance.toFixed(1)
                        }%`;
                }
            case "progress-vs-cost":
                const progressPerformance = this
                    .calculateStockPerformance(stock);
                if (progressPerformance === null) {
                    return "Progress vs Cost of Capital working:\nNo market data available";
                }
                const daysElapsed = this.getDaysElapsed(
                    this.getScoreDate(this.selectedFile),
                );
                const costOfCapitalReturn = (this.costOfCapital / 365) *
                    daysElapsed;
                return header +
                    `Progress vs Cost of Capital working:\n= Stock Performance - Cost of Capital Return\n= ${
                        progressPerformance.toFixed(1)
                    }% - ${costOfCapitalReturn.toFixed(1)}%\n= ${
                        (progressPerformance - costOfCapitalReturn).toFixed(1)
                    }%`;
            case "judgement":
                const judgementPerformance = this
                    .calculateStockPerformance(stock);
                const judgement = this.calculateJudgement(
                    stock,
                    judgementPerformance,
                );
                const judgementScoreDate = this.getScoreDate(this.selectedFile);
                const judgementDaysElapsed = this.getDaysElapsed(judgementScoreDate);
                const judgementTargetPercentage = this.calculateTargetPercentage(stock, judgementScoreDate);
                
                if (judgementDaysElapsed < 90) {
                    const hybridProjection = this.calculateHybridProjection(stock, judgementScoreDate);
                    if (hybridProjection && hybridProjection.confidence > 0.2) {
                        return header +
                            `Judgement (90-day) working:\n= Days elapsed: ${judgementDaysElapsed}\n= Current performance: ${
                                judgementPerformance !== null ? judgementPerformance.toFixed(1) + "%" : "N/A"
                            }\n= Target: ${judgementTargetPercentage !== null ? judgementTargetPercentage.toFixed(1) + "%" : "20% (default)"}\n= Hybrid projection method: ${hybridProjection.projectionMethod}\n= Confidence: ${hybridProjection.confidence.toFixed(3)}\n= Predicted 90-day performance: ${hybridProjection.projected90DayPerformance.toFixed(1)}%\n= Judgement: ${judgement}`;
                    } else {
                        return header +
                            `Judgement (90-day) working:\n= Days elapsed: ${judgementDaysElapsed}\n= Current performance: ${
                                judgementPerformance !== null ? judgementPerformance.toFixed(1) + "%" : "N/A"
                            }\n= Target: ${judgementTargetPercentage !== null ? judgementTargetPercentage.toFixed(1) + "%" : "20% (default)"}\n= Insufficient data for reliable hybrid projection\n= Judgement: ${judgement}`;
                    }
                } else {
                    return header +
                        `Judgement (90-day) working:\n= Days elapsed: ${judgementDaysElapsed} (90-day period complete)\n= Final performance: ${
                            judgementPerformance !== null ? judgementPerformance.toFixed(1) + "%" : "N/A"
                        }\n= Target: ${judgementTargetPercentage !== null ? judgementTargetPercentage.toFixed(1) + "%" : "20% (default)"}\n= Final judgement: ${judgement}`;
                }
            case "status-projection":
                const statusPerformance = this.calculateStockPerformance(stock);
                const statusJudgement = this.calculateJudgement(stock, statusPerformance);
                const statusScoreDate = this.getScoreDate(this.selectedFile);
                const statusDaysElapsed = this.getDaysElapsed(statusScoreDate);
                const statusTargetPercentage = this.calculateTargetPercentage(stock, statusScoreDate);
                
                if (statusDaysElapsed < 90) {
                    const hybridProjection = this.calculateHybridProjection(stock, statusScoreDate);
                    if (hybridProjection && hybridProjection.confidence > 0.2) {
                        return header +
                            `Status/Projection working:\n= Days elapsed: ${statusDaysElapsed}\n= Current performance: ${
                                statusPerformance !== null ? statusPerformance.toFixed(1) + "%" : "N/A"
                            }\n= Target: ${statusTargetPercentage !== null ? statusTargetPercentage.toFixed(1) + "%" : "20% (default)"}\n= Hybrid projection method: ${hybridProjection.projectionMethod}\n= Confidence: ${hybridProjection.confidence.toFixed(3)}\n= Predicted 90-day performance: ${hybridProjection.projected90DayPerformance.toFixed(1)}%\n= Status: ${statusJudgement}`;
                    } else {
                        return header +
                            `Status/Projection working:\n= Days elapsed: ${statusDaysElapsed}\n= Current performance: ${
                                statusPerformance !== null ? statusPerformance.toFixed(1) + "%" : "N/A"
                            }\n= Target: ${statusTargetPercentage !== null ? statusTargetPercentage.toFixed(1) + "%" : "20% (default)"}\n= Insufficient data for reliable hybrid projection\n= Status: ${statusJudgement}`;
                    }
                } else {
                    return header +
                        `Status/Projection working:\n= Days elapsed: ${statusDaysElapsed} (90-day period complete)\n= Final performance: ${
                            statusPerformance !== null ? statusPerformance.toFixed(1) + "%" : "N/A"
                        }\n= Target: ${statusTargetPercentage !== null ? statusTargetPercentage.toFixed(1) + "%" : "20% (default)"}\n= Final judgement: ${statusJudgement}`;
                }
            case "intrinsic-basic":
                if (stock.intrinsicValuePerShareBasic === null) {
                    return "Intrinsic Value (Basic) working:\nNo data available";
                }
                const adjustedBasicValue = this
                    .adjustHistoricalPriceToCurrent(
                        stock.intrinsicValuePerShareBasic,
                        stock.stock,
                        this.getScoreDate(this.selectedFile),
                    );
                return header +
                    `Intrinsic Value (Basic) working:\n= Value from score file (adjusted for splits)\n= Original: $${
                        stock.intrinsicValuePerShareBasic.toFixed(2)
                    }\n= Split adjustment: ÷ ${
                        this.getHistoricalToCurrentSplitAdjustment(
                            stock.stock,
                            this.getScoreDate(this.selectedFile),
                        ).toFixed(1)
                    }\n= Adjusted: $${adjustedBasicValue.toFixed(2)}`;
            case "intrinsic-adjusted":
                if (stock.intrinsicValuePerShareAdjusted === null) {
                    return "Intrinsic Value (Adjusted) working:\nNo data available";
                }
                const adjustedAdjustedValue = this
                    .adjustHistoricalPriceToCurrent(
                        stock.intrinsicValuePerShareAdjusted,
                        stock.stock,
                        this.getScoreDate(this.selectedFile),
                    );
                return header +
                    `Intrinsic Value (Adjusted) working:\n= Adjusted value from score file (adjusted for splits)\n= Original: $${
                        stock.intrinsicValuePerShareAdjusted.toFixed(2)
                    }\n= Split adjustment: ÷ ${
                        this.getHistoricalToCurrentSplitAdjustment(
                            stock.stock,
                            this.getScoreDate(this.selectedFile),
                        ).toFixed(1)
                    }\n= Adjusted: $${adjustedAdjustedValue.toFixed(2)}`;
            case "avg-dividend":
                const avgDividends = this.getDividendsWithin90Days(
                    stockSymbol,
                );
                if (avgDividends.length === 0) {
                    return "Average Dividend (90-day) working:\nNo dividends in 90-day period";
                }
                const avgTotalDividends = avgDividends.reduce(
                    (sum, div) => sum + div.amount,
                    0,
                );
                const avgDividend = avgTotalDividends / avgDividends.length;
                return header +
                    `Average Dividend (90-day) working:\n= Total Dividends / Number of Dividends\n= $${
                        avgTotalDividends.toFixed(2)
                    } / ${avgDividends.length}\n= $${avgDividend.toFixed(4)}`;
            case "total-dividend":
                const totalDivDividends = this.getDividendsWithin90Days(
                    stockSymbol,
                );
                if (totalDivDividends.length === 0) {
                    return "Total Dividends (90-day) working:\nNo dividends in 90-day period";
                }
                const totalDivAmount = totalDivDividends.reduce(
                    (sum, div) => sum + div.amount,
                    0,
                );
                return header +
                    `Total Dividends (90-day) working:\n= Sum of all dividends within 90 days\n= ${
                        totalDivDividends.map((d) => `$${d.amount.toFixed(2)}`)
                            .join(" + ")
                    }\n= $${
                        totalDivAmount.toFixed(2)
                    } (${totalDivDividends.length} dividend${
                        totalDivDividends.length > 1 ? "s" : ""
                    })`;
            case "dividend-info":
                const divInfoDividends = this.getDividendsWithin90Days(
                    stockSymbol,
                );
                if (divInfoDividends.length === 0) {
                    return "Dividend Info working:\nNo dividends in 90-day period";
                }
                const divInfoTotal = divInfoDividends.reduce(
                    (sum, div) => sum + div.amount,
                    0,
                );
                return header +
                    `Dividend Info working:\n= Total dividends within 90 days\n= $${
                        divInfoTotal.toFixed(2)
                    } (${divInfoDividends.length} dividend${
                        divInfoDividends.length > 1 ? "s" : ""
                    })`;
            default:
                return "Calculation working not implemented for this field";
        }
    }

    getHistoricalToCurrentSplitAdjustment(
        stockSymbol,
        historicalDate,
    ) {
        const marketData = this.marketData[stockSymbol];
        if (!marketData) return 1.0;

        // Find all splits that occurred after the historical date
        let cumulativeSplit = 1.0;
        for (const point of marketData) {
            if (
                point.date > historicalDate &&
                point.splitCoefficient > 1.0
            ) {
                cumulativeSplit *= point.splitCoefficient;
            }
        }

        return cumulativeSplit;
    }

    adjustHistoricalPriceToCurrent(
        price,
        stockSymbol,
        historicalDate,
    ) {
        const splitAdjustment = this
            .getHistoricalToCurrentSplitAdjustment(
                stockSymbol,
                historicalDate,
            );
        const result = price / splitAdjustment;

        return result;
    }

    getBuyPrice(stockSymbol, scoreDate) {
        const marketData = this.marketData[stockSymbol];
        if (!marketData) {
            console.log(`getBuyPrice - ${stockSymbol}: No market data available`);
            return null;
        }

        console.log(`getBuyPrice - ${stockSymbol}: Looking for price on or after ${scoreDate.toISOString().split('T')[0]}`);
        console.log(`getBuyPrice - ${stockSymbol}: Available market data dates:`, marketData.map(p => p.date.toISOString().split('T')[0]).slice(0, 5), "...");

        // Try to get the price on the exact score date or up to 5 days forward
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
                const adjustedPrice = this.adjustHistoricalPriceToCurrent(
                    (candidateData.high + candidateData.low) / 2,
                    stockSymbol,
                    scoreDate,
                );
                console.log(`getBuyPrice - ${stockSymbol}: Found price on ${candidateDate.toISOString().split('T')[0]}: $${adjustedPrice.toFixed(2)}`);
                return {
                    price: adjustedPrice,
                    dateUsed: candidateDate
                };
            }
        }
        // No price found within 5 days
        console.log(`getBuyPrice - ${stockSymbol}: No price found within 5 days of score date`);
        return null;
    }

    createChart() {
        const ctx = document
            .getElementById("performanceChart")
            .getContext("2d");
        const isMobile = this.isMobileDevice();

        const chartTitle = this.selectedStock
            ? `${this.selectedStock} Performance`
            : "Portfolio Performance";
    }

    // Centralized method to calculate target percentage with proper stock dilution handling
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

    // Centralized method to calculate stock performance with proper dilution handling
    calculateStockPerformanceWithDilution(stock, scoreDate) {
        const marketData = this.marketData[stock.stock];
        if (!marketData || marketData.length === 0) return null;

        const ninetyDayDate = new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000));
        
        // Find the last price within 90 days
        const within90Days = marketData.filter((point) => point.date <= ninetyDayDate);
        if (within90Days.length === 0) return null;

        const lastData = within90Days[within90Days.length - 1];
        const currentPrice = (lastData.high + lastData.low) / 2; // Already post-split
        
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        
        if (buyPriceObj === null) return null;

        // Calculate price return
        const priceReturn = ((currentPrice - buyPriceObj.price) / buyPriceObj.price) * 100;

        // Add dividend return within 90 days
        const dividends = this.getDividendsWithin90Days(stock.stock);
        const totalDividends = dividends.reduce((sum, div) => sum + div.amount, 0);
        const dividendReturn = (totalDividends / buyPriceObj.price) * 100;

        return priceReturn + dividendReturn;
    }

    // Calculate linear regression for trend prediction
    calculateTrendLine(stock, scoreDate) {
        const marketData = this.marketData[stock.stock];
        if (!marketData || marketData.length === 0) {
            console.log(`calculateTrendLine - ${stock.stock}: No market data available`);
            return null;
        }

        const scoreDateTimestamp = scoreDate.getTime();
        const today = new Date();
        
        console.log(`calculateTrendLine - ${stock.stock}: Score date: ${scoreDate.toISOString().split('T')[0]}, Today: ${today.toISOString().split('T')[0]}`);
        console.log(`calculateTrendLine - ${stock.stock}: Total market data points: ${marketData.length}`);
        
        // Get data points from score date to today (but only if we have at least 3 data points)
        const dataPoints = [];
        const buyPriceObj = this.getBuyPrice(stock.stock, scoreDate);
        
        if (!buyPriceObj || buyPriceObj.price <= 0) {
            console.log(`calculateTrendLine - ${stock.stock}: No valid buy price. Buy price obj:`, buyPriceObj);
            return null;
        }

        console.log(`calculateTrendLine - ${stock.stock}: Buy price: $${buyPriceObj.price.toFixed(2)}`);

        marketData.forEach((point) => {
            if (point.date >= scoreDate && point.date <= today) {
                const daysSinceScore = (point.date.getTime() - scoreDateTimestamp) / (1000 * 60 * 60 * 24);
                const currentPrice = this.adjustHistoricalPriceToCurrent(
                    (point.high + point.low) / 2,
                    stock.stock,
                    point.date
                );
                
                // Calculate performance including dividends up to this point
                const priceReturn = ((currentPrice - buyPriceObj.price) / buyPriceObj.price) * 100;
                const dividends = this.getDividendsWithin90Days(stock.stock);
                const dividendsUpToDate = dividends.filter((d) => d.exDivDate <= point.date);
                const totalDividends = dividendsUpToDate.reduce((sum, div) => sum + div.amount, 0);
                const dividendReturn = (totalDividends / buyPriceObj.price) * 100;
                const totalReturn = priceReturn + dividendReturn;
                
                dataPoints.push({
                    x: daysSinceScore,
                    y: totalReturn
                });
            }
        });

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

        // Calculate linear regression (y = mx + b)
        const n = dataPoints.length;
        const sumX = dataPoints.reduce((sum, point) => sum + point.x, 0);
        const sumY = dataPoints.reduce((sum, point) => sum + point.y, 0);
        const sumXY = dataPoints.reduce((sum, point) => sum + point.x * point.y, 0);
        const sumXX = dataPoints.reduce((sum, point) => sum + point.x * point.x, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Force the trend line to start at zero on the score date
        // Adjust the intercept so that when x=0 (score date), y=0
        const adjustedIntercept = 0;
        const adjustedSlope = slope;

        // Predict performance at 90 days using the adjusted line
        const predicted90DayPerformance = adjustedSlope * 90 + adjustedIntercept;

        // Cap the prediction at -100% since you can't lose more than 100% of your investment
        const cappedPredicted90DayPerformance = Math.max(predicted90DayPerformance, -100);

        const rSquared = this.calculateRSquared(dataPoints, adjustedSlope, adjustedIntercept);
        
        console.log(`calculateTrendLine - ${stock.stock}: Slope: ${adjustedSlope.toFixed(4)}, Intercept: ${adjustedIntercept}, R²: ${rSquared.toFixed(4)}, Predicted 90-day: ${cappedPredicted90DayPerformance.toFixed(1)}% (original: ${predicted90DayPerformance.toFixed(1)}%)`);

        return {
            slope: adjustedSlope,
            intercept: adjustedIntercept,
            predicted90DayPerformance: cappedPredicted90DayPerformance,
            dataPoints,
            rSquared: rSquared
        };
    }

    // Calculate R-squared for trend line quality
    calculateRSquared(dataPoints, slope, intercept) {
        const n = dataPoints.length;
        const meanY = dataPoints.reduce((sum, point) => sum + point.y, 0) / n;
        
        let ssRes = 0; // Sum of squared residuals
        let ssTot = 0; // Total sum of squares
        
        dataPoints.forEach((point) => {
            const predicted = slope * point.x + intercept;
            ssRes += Math.pow(point.y - predicted, 2);
            ssTot += Math.pow(point.y - meanY, 2);
        });
        
        return ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
    }

    // Calculate linear regression for portfolio trend prediction
    calculatePortfolioTrendLine() {
        const scoreDate = this.getScoreDate(this.selectedFile);
        const scoreDateTimestamp = scoreDate.getTime();
        const today = new Date();
        
        // Get portfolio data points from score date to today (but only if we have at least 3 data points)
        const portfolioData = this.calculatePortfolioData();
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

        // Calculate linear regression (y = mx + b)
        const n = dataPoints.length;
        const sumX = dataPoints.reduce((sum, point) => sum + point.x, 0);
        const sumY = dataPoints.reduce((sum, point) => sum + point.y, 0);
        const sumXY = dataPoints.reduce((sum, point) => sum + point.x * point.y, 0);
        const sumXX = dataPoints.reduce((sum, point) => sum + point.x * point.x, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // Force the trend line to start at zero on the score date
        // Adjust the intercept so that when x=0 (score date), y=0
        const adjustedIntercept = 0;
        const adjustedSlope = slope;

        // Predict performance at 90 days using the adjusted line
        const predicted90DayPerformance = adjustedSlope * 90 + adjustedIntercept;

        // Cap the prediction at -100% since you can't lose more than 100% of your investment
        const cappedPredicted90DayPerformance = Math.max(predicted90DayPerformance, -100);

        const rSquared = this.calculateRSquared(dataPoints, adjustedSlope, adjustedIntercept);
        
        console.log("Portfolio trend line - slope:", adjustedSlope, "intercept:", adjustedIntercept, "R²:", rSquared, "Predicted 90-day:", cappedPredicted90DayPerformance, "(original:", predicted90DayPerformance, ")");

        return {
            slope: adjustedSlope,
            intercept: adjustedIntercept,
            predicted90DayPerformance: cappedPredicted90DayPerformance,
            dataPoints,
            rSquared: rSquared
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
        const today = new Date();
        const daysElapsed = Math.floor((today.getTime() - scoreDateTimestamp) / (1000 * 60 * 60 * 24));
        
        console.log(`calculateHybridProjection - ${stock.stock}: Days elapsed: ${daysElapsed}`);
        
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

        // Hybrid approach based on days elapsed
        let projected90DayPerformance;
        let projectionMethod;
        let confidence;

        if (daysElapsed < 30) {
            // Short-term: Use dampened trend (reduce early volatility)
            projectionMethod = "dampened_trend";
            const trendLine = this.calculateTrendLine(stock, scoreDate);
            
            if (trendLine && trendLine.rSquared > 0.1) {
                // Dampen the trend by 70% to account for mean reversion
                const dampenedSlope = trendLine.slope * 0.3;
                projected90DayPerformance = Math.max(dampenedSlope * 90, -100);
                confidence = Math.min(trendLine.rSquared * 0.7, 0.8); // Reduce confidence for early projections
                console.log(`calculateHybridProjection - ${stock.stock}: Using dampened trend (slope: ${trendLine.slope.toFixed(4)} → ${dampenedSlope.toFixed(4)})`);
            } else {
                // Fall back to target-based projection
                projectionMethod = "target_based";
                projected90DayPerformance = targetPercentage || -5; // Default to -5% if no target
                confidence = 0.3; // Low confidence for early projections
                console.log(`calculateHybridProjection - ${stock.stock}: Using target-based projection (insufficient trend data)`);
            }
        } else if (daysElapsed < 60) {
            // Medium-term: Use dampened trend with higher confidence
            projectionMethod = "dampened_trend";
            const trendLine = this.calculateTrendLine(stock, scoreDate);
            
            if (trendLine && trendLine.rSquared > 0.05) {
                // Dampen the trend by 50% for medium-term
                const dampenedSlope = trendLine.slope * 0.5;
                projected90DayPerformance = Math.max(dampenedSlope * 90, -100);
                confidence = Math.min(trendLine.rSquared * 0.8, 0.9);
                console.log(`calculateHybridProjection - ${stock.stock}: Using dampened trend (slope: ${trendLine.slope.toFixed(4)} → ${dampenedSlope.toFixed(4)})`);
            } else {
                // Fall back to target-based projection
                projectionMethod = "target_based";
                projected90DayPerformance = targetPercentage || -5;
                confidence = 0.5;
                console.log(`calculateHybridProjection - ${stock.stock}: Using target-based projection (insufficient trend data)`);
            }
        } else {
            // Long-term: Use target-based projection or mean reversion
            projectionMethod = "target_based";
            
            if (targetPercentage !== null) {
                // Use current performance as primary indicator, with modest target influence
                if (currentPerformance > 0) {
                    // If positive, project slight improvement (20% of remaining gap)
                    const gap = targetPercentage - currentPerformance;
                    projected90DayPerformance = currentPerformance + (gap * 0.2);
                } else {
                    // If negative, project slight recovery toward zero
                    projected90DayPerformance = currentPerformance * 0.6; // Move 40% toward zero
                }
                confidence = 0.5; // Lower confidence for long-term projections
                console.log(`calculateHybridProjection - ${stock.stock}: Using conservative target-based projection`);
            } else {
                // Use mean reversion (move toward 0% performance)
                const reversionRate = 0.4; // 40% reversion toward mean
                projected90DayPerformance = currentPerformance * (1 - reversionRate);
                confidence = 0.3;
                console.log(`calculateHybridProjection - ${stock.stock}: Using mean reversion projection`);
            }
        }

        // Ensure projection is within realistic bounds
        projected90DayPerformance = Math.max(Math.min(projected90DayPerformance, 200), -100);

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

        const trendData = [];
        const scoreDateTimestamp = scoreDate.getTime();

        // Helper to get midnight date
        const getDayDate = (base, day) => this.setDateToMidnight(new Date(base.getTime() + day * 24 * 60 * 60 * 1000));

        if (projection.projectionMethod === "dampened_trend") {
            const trendLine = this.calculateTrendLine(stock, scoreDate);
            if (trendLine) {
                const dampenFactor = projection.daysElapsed < 30 ? 0.3 : 0.5;
                const dampenedSlope = trendLine.slope * dampenFactor;
                // Generate weekly points up to 90 days, starting at zero
                for (let day = 0; day <= 90; day += 7) {
                    trendData.push({
                        x: getDayDate(scoreDate, day),
                        y: Math.max(dampenedSlope * day, -100)
                    });
                }
                // Ensure we have exactly 90 days as the last point
                const lastPoint = trendData[trendData.length - 1];
                const lastPointDay = (lastPoint.x.getTime() - scoreDate.getTime()) / (24 * 60 * 60 * 1000);
                if (lastPointDay !== 90) {
                    trendData.push({
                        x: getDayDate(scoreDate, 90),
                        y: Math.max(dampenedSlope * 90, -100)
                    });
                }
            }
        } else {
            // Target-based or mean reversion - use actual market data
            const target = projection.targetPercentage || 0;
            const current = projection.currentPerformance;
            
            // Calculate projection based on actual market performance
            let projected90DayPerformance;
            if (projection.projectionMethod === "target_based" && projection.targetPercentage !== null) {
                // Use actual current performance as the primary indicator
                // Only project modest improvement if current performance is positive
                if (current > 0) {
                    // If currently positive, project slight improvement (10% of remaining gap)
                    const gap = target - current;
                    projected90DayPerformance = current + (gap * 0.1);
                } else {
                    // If currently negative, project slight recovery toward zero
                    projected90DayPerformance = current * 0.5; // Move halfway toward zero
                }
                
                // Cap at reasonable bounds
                projected90DayPerformance = Math.max(Math.min(projected90DayPerformance, target), -100);
            } else {
                // Mean reversion - move toward zero
                const reversionRate = 0.5;
                projected90DayPerformance = current * (1 - reversionRate);
                projected90DayPerformance = Math.max(projected90DayPerformance, -100);
            }
            
            // Generate weekly points up to 90 days, starting at zero
            for (let day = 0; day <= 90; day += 7) {
                let predictedPerformance;
                if (projection.projectionMethod === "target_based" && projection.targetPercentage !== null) {
                    // Linear interpolation from zero to the realistic projection
                    const progress = Math.min(day / 90, 1);
                    predictedPerformance = projected90DayPerformance * progress;
                } else {
                    // Mean reversion from zero
                    const reversionProgress = Math.min(day / 90, 1);
                    predictedPerformance = projected90DayPerformance * reversionProgress;
                }
                
                predictedPerformance = Math.max(Math.min(predictedPerformance, 200), -100);
                trendData.push({
                    x: getDayDate(scoreDate, day),
                    y: predictedPerformance
                });
            }
            
            // Ensure we have exactly 90 days as the last point
            const lastPoint = trendData[trendData.length - 1];
            const lastPointDay = (lastPoint.x.getTime() - scoreDate.getTime()) / (24 * 60 * 60 * 1000);
            if (lastPointDay !== 90) {
                trendData.push({
                    x: getDayDate(scoreDate, 90),
                    y: projected90DayPerformance
                });
            }
        }
        
        return {
            data: trendData,
            projection: projection
        };
    }
}

// Initialize the validator
const validator = new GRQValidator();

// Add window resize listener to update chart configuration
globalThis.addEventListener("resize", () => {
    if (validator.chart && validator.chart.options && validator.chart.options.plugins && validator.chart.options.plugins.legend) {
        const breakpoint = validator.getBootstrapBreakpoint();
        const isMobile = validator.isMobileDevice();
        
        console.log("Resize event - Bootstrap breakpoint:", breakpoint);
        console.log("Resize event - isMobile:", isMobile);
        console.log("Resize event - window.innerWidth:", window.innerWidth);
        console.log("Resize event - legend display:", !isMobile);
        
        validator.chart.options.plugins.legend.display = !isMobile;
        
        // Only set font size if the labels object exists
        if (validator.chart.options.plugins.legend.labels) {
            validator.chart.options.plugins.legend.labels.font = validator.chart.options.plugins.legend.labels.font || {};
            validator.chart.options.plugins.legend.labels.font.size = isMobile ? 10 : 12;
            validator.chart.options.plugins.legend.labels.boxWidth = isMobile ? 12 : 16;
            validator.chart.options.plugins.legend.labels.padding = isMobile ? 8 : 12;
        }
        
        validator.chart.update();
    }
});

// Add document click handler to close popovers when clicking outside
document.addEventListener("click", (event) => {
    // Check if the click was on a popover trigger or inside a popover
    const isPopoverTrigger = event.target.closest(
        ".clickable-value",
    );
    const isInsidePopover = event.target.closest(".popover");

    if (!isPopoverTrigger && !isInsidePopover) {
        // Close all open popovers
        const clickableValues = document.querySelectorAll(
            ".clickable-value",
        );
        clickableValues.forEach((element) => {
            const popover = bootstrap.Popover.getInstance(element);
            if (popover && element.hasAttribute("aria-describedby")) {
                popover.hide();
            }
        });
    }
});
