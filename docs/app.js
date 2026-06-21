class GRQValidator {
    constructor() {
        this.scoreData = null;
        this.marketData = null;
        this.dividendData = null;
        this.marketIndexData = null; // SP500 and NASDAQ data
        this.analysisData = null; // Analysis data for star ratings
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
        // Delegate to the shared projection module (issue #100) so the browser
        // and the Deno tests format currency identically.
        return GRQProjection.formatCurrency(value);
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

        // Delegated drill-down handler for the stock ticker cell (issue #189).
        // Replaces an inline onclick so the page can enforce a strict CSP
        // without 'unsafe-inline'. The browser HTML-decodes data-stock, so we
        // recover the original (escaped-at-render) ticker value here.
        const stockTableBody = document.getElementById("stockTableBody");
        if (stockTableBody) {
            stockTableBody.addEventListener("click", (event) => {
                const cell = event.target.closest(".clickable-stock");
                if (cell && cell.dataset.stock) {
                    this.showStockDetails(cell.dataset.stock);
                }
            });
        }

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
                // Check for file parameter in URL first
                const urlParams = new URLSearchParams(window.location.search);
                const fileParam = urlParams.get('file');
                
                if (fileParam) {
                    // Check if the file parameter matches any available score file
                    const matchingScore = indexData.scores.find(score => score.file === fileParam);
                    if (matchingScore) {
                        console.log(`Auto-selecting score file from URL parameter: ${matchingScore.date} (${matchingScore.month} ${matchingScore.day})`);
                        this.selectedFile = matchingScore.file;
                        select.value = this.selectedFile;
                        await this.loadScoreFile();
                        return;
                    } else {
                        console.warn(`File parameter '${fileParam}' not found in available scores`);
                    }
                }
                
                // Fallback: Find the score file closest to 90 days ago
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
        console.log('loadScoreFile called for:', this.selectedFile);

        // Clear market index data to prevent showing stale SP500/NASDAQ data
        this.marketIndexData = null;
        console.log('Cleared market index data to prevent stale data display');

        try {
            console.log('Loading score data...');
            await this.loadScoreData();
            console.log('Score data loaded, stocks:', this.scoreData?.length);
            
            console.log('Loading market data...');
            await this.loadMarketData();
            console.log('Market data loaded, available stocks:', this.marketData ? Object.keys(this.marketData).length : 0);
            
            console.log('Loading analysis data...');
            await this.loadAnalysisData();
            console.log('Analysis data loaded, available stocks:', this.analysisData ? Object.keys(this.analysisData).length : 0);
            
            // Show the main chart immediately (without SP500/NASDAQ)
            console.log('Calling updateDisplay...');
            this.updateDisplay();
            
            // Show loading state for market comparison
            this.showMarketComparisonLoading();
            
            // Load market index data asynchronously (don't block the main display)
            this.loadMarketIndexData().then(() => {
                console.log('Market index data loaded successfully, updating UI...');
                // Update the market comparison section when data is ready
                this.updateMarketComparison();
                // Also update the chart to include SP500 and NASDAQ lines
                console.log('Updating chart with market index data...');
                this.updateChart();
            }).catch(error => {
                console.warn('Market index data failed to load:', error);
                // Don't show error to user - just log it
            });
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
        console.log('Loading market data from:', csvFile);
        console.log('Selected file:', this.selectedFile);
        console.log('CSV file path:', `scores/${csvFile}`);

        try {
            // Add cache-busting parameter
            const timestamp = new Date().getTime();
            const fullUrl = `scores/${csvFile}?t=${timestamp}`;
            console.log('Full URL for market data:', fullUrl);
            
            // Try multiple times with different cache-busting strategies
            let response = null;
            let text = null;
            
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const attemptUrl = `${fullUrl}&attempt=${attempt}`;
                    console.log(`Attempt ${attempt} to fetch market data from:`, attemptUrl);
                    
                    response = await fetch(attemptUrl, {
                        method: 'GET',
                        headers: {
                            'Cache-Control': 'no-cache',
                            'Pragma': 'no-cache'
                        }
                    });
                    
                    if (!response.ok) {
                        console.error(`Attempt ${attempt} failed to load market data file:`, response.status, response.statusText);
                        continue;
                    }
                    
                    text = await response.text();
                    console.log(`Attempt ${attempt} successful, file size:`, text.length, 'characters');
                    
                    // If we got a reasonable amount of data, break
                    if (text.length > 1000) {
                        break;
                    } else {
                        console.warn(`Attempt ${attempt} returned suspiciously small file size:`, text.length);
                    }
                } catch (fetchError) {
                    console.error(`Attempt ${attempt} fetch error:`, fetchError);
                }
            }
            
            if (!response || !response.ok) {
                console.error('All attempts to load market data file failed');
                this.marketData = null;
                return;
            }
            console.log('Market data file loaded, size:', text.length, 'characters');
            console.log('First 200 characters of market data:', text.substring(0, 200));

            if (!text.trim()) {
                console.warn('Market data file is empty');
                this.marketData = null;
                return;
            }

            const lines = text.split("\n").filter((line) => line.trim());
            console.log("Market data file lines:", lines.length);
            if (lines.length > 0) {
                console.log("First line:", lines[0]);
                if (lines.length > 1) {
                    console.log("Second line:", lines[1]);
                }
            }
            
            this.marketData = {};

            lines.slice(1).forEach((line, index) => {
                if (index < 3) { // Debug first 3 lines
                    console.log(`Processing line ${index + 1}:`, line);
                }
                const values = line.split(",");
                const date = values[0];
                const ticker = values[1];
                const high = parseFloat(values[2]);
                const low = parseFloat(values[3]);
                const open = parseFloat(values[4]);
                const close = parseFloat(values[5]);
                const splitCoefficient = parseFloat(values[6]);

                if (index < 3) { // Debug first 3 lines
                    console.log(`Parsed values: date=${date}, ticker=${ticker}, high=${high}, low=${low}, open=${open}, close=${close}, split=${splitCoefficient}`);
                }

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
            
            console.log("Market data loaded for stocks:", Object.keys(this.marketData));
            console.log("Total market data entries:", Object.values(this.marketData).reduce((sum, data) => sum + data.length, 0));

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

    async loadAnalysisData() {
        // Try to find analysis file for the current score date
        const scoreDate = this.getScoreDate(this.selectedFile);
        const analysisDate = this.formatDateForAnalysisFile(scoreDate);
        
        // Look for analysis file in the same directory as the score file
        const scoreFilePath = this.selectedFile;
        const scoreFileDir = scoreFilePath.substring(0, scoreFilePath.lastIndexOf('/') + 1);
        const analysisFileName = `scores/${scoreFileDir}${analysisDate}-analysis.csv`;
        
        console.log('Looking for analysis file:', analysisFileName);
        console.log('Score date:', scoreDate);
        console.log('Analysis date:', analysisDate);
        
        try {
            // Add cache-busting parameter
            const timestamp = new Date().getTime();
            const response = await fetch(`${analysisFileName}?t=${timestamp}`);
            
            if (!response.ok) {
                console.log('Analysis file not found, skipping analysis data loading');
                this.analysisData = {};
                return;
            }
            
            const text = await response.text();
            const lines = text.trim().split('\n');
            
            if (lines.length < 2) {
                console.log('Analysis file is empty or has no data rows');
                this.analysisData = {};
                return;
            }
            
            // Parse CSV header
            const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
            
            // Find column indices
            const stockIndex = headers.indexOf('Stock');
            const dateIndex = headers.indexOf('Date');
            const msIndex = headers.indexOf('MS');
            const tipsStarsIndex = headers.indexOf('Tips Stars');
            const msFairValueIndex = headers.indexOf('MS Fair Value');
            const tipsTargetIndex = headers.indexOf('Tips Target');
            
            if (stockIndex === -1 || dateIndex === -1) {
                console.log('Required columns not found in analysis file');
                this.analysisData = {};
                return;
            }
            
            // Parse data rows
            this.analysisData = {};
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                const values = this.parseCSVLine(line);
                
                if (values.length < Math.max(stockIndex, dateIndex) + 1) {
                    continue; // Skip malformed rows
                }
                
                                        const stock = values[stockIndex]?.trim();
                        const dateStr = values[dateIndex]?.trim();
                        
                                                if (!stock || !dateStr) {
                            continue;
                        }
                        
                        // Parse the date
                        const analysisDate = this.parseAnalysisDate(dateStr);
                        if (!analysisDate) {
                            continue;
                        }
                        
                        // Check if analysis is within 30 days of score date
                        const daysDiff = Math.abs((analysisDate.getTime() - scoreDate.getTime()) / (1000 * 60 * 60 * 24));
                        
                        if (daysDiff <= 30) {
                            // Parse star ratings
                            const msStars = msIndex !== -1 && values[msIndex] ? parseFloat(values[msIndex]) : null;
                            const tipsStars = tipsStarsIndex !== -1 && values[tipsStarsIndex] ? parseFloat(values[tipsStarsIndex]) : null;
                            
                            // Calculate average star rating (Tips Stars divided by 2 to normalize to 1-5 scale)
                            let avgStars = null;
                            let validRatings = 0;
                            let totalRating = 0;
                            
                            if (msStars !== null && !isNaN(msStars) && msStars >= 1 && msStars <= 5) {
                                totalRating += msStars;
                                validRatings++;
                            }
                            
                            if (tipsStars !== null && !isNaN(tipsStars) && tipsStars >= 1 && tipsStars <= 10) {
                                totalRating += tipsStars / 2; // Normalize to 1-5 scale
                                validRatings++;
                            }
                            
                            if (validRatings > 0) {
                                avgStars = totalRating / validRatings;
                            }
                            
                            // Parse fair value data
                            const msFairValue = msFairValueIndex !== -1 && values[msFairValueIndex] ? 
                                this.parseCurrencyValue(values[msFairValueIndex]) : null;
                            const tipsTarget = tipsTargetIndex !== -1 && values[tipsTargetIndex] ? 
                                this.parseCurrencyValue(values[tipsTargetIndex]) : null;
                    
                    this.analysisData[stock] = {
                        date: analysisDate,
                        msStars: msStars,
                        tipsStars: tipsStars,
                        avgStars: avgStars,
                        daysFromScore: daysDiff,
                        msFairValue: msFairValue,
                        tipsTarget: tipsTarget
                    };
                }
            }
            
            console.log(`Analysis data loaded for ${Object.keys(this.analysisData).length} stocks`);
            console.log('Sample analysis data:', Object.keys(this.analysisData).slice(0, 5).map(stock => ({
                stock,
                ...this.analysisData[stock]
            })));
            console.log('All analysis stocks:', Object.keys(this.analysisData));
            
        } catch (error) {
            console.log('Error loading analysis data:', error);
            this.analysisData = {};
        }
    }

    // Helper method to parse CSV line properly (handles quoted fields)
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        result.push(current.trim());
        return result;
    }

    // Helper method to format date for analysis file name
    formatDateForAnalysisFile(date) {
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}`;
    }

    // Helper method to parse currency values from analysis data
    parseCurrencyValue(valueStr) {
        if (!valueStr || valueStr.trim() === '' || valueStr === 'Loading...') {
            return null;
        }
        
        // Remove currency symbols and commas, then parse as float
        const cleanValue = valueStr.replace(/[$,]/g, '').trim();
        const parsed = parseFloat(cleanValue);
        
        return isNaN(parsed) ? null : parsed;
    }

    // Helper method to parse analysis date (format: "28 Feb 2024", "11 Jul 2025", etc.)
    parseAnalysisDate(dateStr) {
        try {
            // Handle various date formats
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return date;
            }
            
            // Try parsing specific formats
            const months = {
                'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
            };
            
            // Format: "28 Feb 2024"
            const match = dateStr.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
            if (match) {
                const day = parseInt(match[1]);
                const month = months[match[2]];
                const year = parseInt(match[3]);
                
                if (month !== undefined) {
                    return new Date(year, month, day);
                }
            }
            
            return null;
        } catch (error) {
            console.log('Error parsing analysis date:', dateStr, error);
            return null;
        }
    }

    // Helper method to get star rating display
    getStarRatingDisplay(stockSymbol) {
        if (!this.analysisData || !this.analysisData[stockSymbol]) {
            return '';
        }
        
        const analysis = this.analysisData[stockSymbol];
        if (analysis.avgStars === null) {
            return '';
        }
        
        // Round to nearest quarter using your logic
        const hundredStars = Math.min(Math.round(analysis.avgStars * 20), 100);
        const fullStars = Math.floor(hundredStars / 20);
        const remainderStars = hundredStars - fullStars * 20;
        const partialStars = Math.round(Math.min(Math.max(0, remainderStars), 20) / 5);
        
        let display = '';
        
        // Add full moons for integer values
        for (let i = 0; i < fullStars; i++) {
            display += '🌕';
        }
        
        // Add partial moon for fractional part
        if (remainderStars > 0) {
            switch (partialStars) {
                case 0:
                    display += '🌑'; // new moon (0-0.25)
                    break;
                case 1:
                    display += '🌒'; // quarter moon (0.25-0.5)
                    break;
                case 2:
                    display += '🌓'; // half moon (0.5-0.75)
                    break;
                case 3:
                    display += '🌔'; // three-quarter moon (0.75-1.0)
                    break;
                case 4:
                    // This should round up to next full star
                    // Add one more full star
                    display += '🌕';
                    break;
            }
        }
        
        return display;
    }

    getFairValueRange(stockSymbol) {
        // Delegate to the shared projection module (issue #204) so the browser
        // and the Deno tests apply identical fair-value band rules.
        return GRQProjection.getFairValueRange(this.analysisData[stockSymbol]);
    }

    getTargetPriceColor(targetPrice, currentPrice, buyPrice) {
        // Delegate to the shared projection module (issue #204) so the browser
        // and the Deno tests apply identical target-price colour rules.
        return GRQProjection.getTargetPriceColor(
            targetPrice,
            currentPrice,
            buyPrice,
        );
    }

    getStarRatingCalculation(stockSymbol) {
        if (!this.analysisData || !this.analysisData[stockSymbol]) {
            return null;
        }
        
        const analysis = this.analysisData[stockSymbol];
        if (analysis.avgStars === null) {
            return null;
        }
        
        // Get the original values
        const msStars = analysis.msStars;
        const tipsStars = analysis.tipsStars;
        const avgStars = analysis.avgStars;
        
        // Round to nearest quarter using your logic
        const hundredStars = Math.min(Math.round(avgStars * 20), 100);
        const fullStars = Math.floor(hundredStars / 20);
        const remainderStars = hundredStars - fullStars * 20;
        const partialStars = Math.round(Math.min(Math.max(0, remainderStars), 20) / 5);
        
        // Determine moon phase description
        let moonPhase = '';
        if (remainderStars > 0) {
            switch (partialStars) {
                case 0:
                    moonPhase = '🌑 (new moon)';
                    break;
                case 1:
                    moonPhase = '🌒 (quarter moon)';
                    break;
                case 2:
                    moonPhase = '🌓 (half moon)';
                    break;
                case 3:
                    moonPhase = '🌔 (three-quarter moon)';
                    break;
                case 4:
                    moonPhase = '🌕 (full moon - rounded up)';
                    break;
            }
        }
        
        return {
            msStars,
            tipsStars,
            avgStars,
            hundredStars,
            fullStars,
            remainderStars,
            partialStars,
            moonPhase,
            display: this.getStarRatingDisplay(stockSymbol)
        };
    }

    // Debug method to show analysis data for a stock
    debugAnalysisData(stockSymbol) {
        if (!this.analysisData || !this.analysisData[stockSymbol]) {
            console.log(`No analysis data for ${stockSymbol}`);
            return;
        }
        
        const analysis = this.analysisData[stockSymbol];
        console.log(`Analysis data for ${stockSymbol}:`, analysis);
        console.log(`Star display: ${this.getStarRatingDisplay(stockSymbol)}`);
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

    async loadMarketIndexData() {
        try {
            console.log('Starting to load market index data...');
            
            // Check if market data loading is disabled (for debugging)
            const skipMarketData = localStorage.getItem('skipMarketData') === 'true';
            if (skipMarketData) {
                console.log('Market data loading disabled by user preference');
                this.marketIndexData = null;
                return;
            }
            
            const scoreDate = this.getScoreDate(this.selectedFile);
            if (!scoreDate) {
                console.warn('Could not determine score date for market index data');
                return;
            }

            console.log('Score date for market data:', scoreDate.toISOString().split('T')[0]);

            // Calculate date range (from score date to now). Benchmark series
            // are sliced to this window from the first-party data file.
            const endDate = new Date();
            const startDate = new Date(scoreDate);

            console.log('Market data date range:', {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                dateRange: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
            });

            // Read benchmark indices from a same-origin static file published
            // under docs/ (issue #93). Previously the dashboard fetched Yahoo
            // Finance through arbitrary public CORS proxies, trusting uncontrolled
            // third-party relays for the data it charts; it now reads first-party
            // data only — no runtime cross-origin call, no untrusted intermediary.
            let indexMaps = null;
            try {
                const timestamp = new Date().getTime();
                const response = await fetch(`market-indices.json?t=${timestamp}`);
                if (!response.ok) {
                    throw new Error(`market-indices.json request failed: ${response.status} ${response.statusText}`);
                }
                indexMaps = await response.json();
            } catch (fetchError) {
                console.warn('Benchmark index data unavailable:', fetchError.message);
                indexMaps = null;
            }

            // Build each index series from its {date: close} map, shaped the same
            // way the chart consumes it via the shared projection kernel.
            this.marketIndexData = {};

            const indexConfig = [
                { key: 'sp500', mapKey: 'sp500', name: 'SP500' },
                { key: 'nasdaq', mapKey: 'nasdaq', name: 'NASDAQ' },
                { key: 'russell2000', mapKey: 'russell2000', name: 'Russell 2000' }
            ];

            for (const { key, mapKey, name } of indexConfig) {
                const priceMap = indexMaps ? indexMaps[mapKey] : null;
                const processed = GRQProjection.buildIndexSeriesFromMap(priceMap, name, startDate, endDate);
                if (processed && processed.initialPrice && processed.currentPrice) {
                    this.marketIndexData[key] = processed;
                    console.log('%s data processed successfully:', name, {
                        initialPrice: processed.initialPrice,
                        currentPrice: processed.currentPrice,
                        dataPoints: processed.data.length
                    });
                } else {
                    console.warn(`No ${name} data available`);
                }
            }

            console.log('Final market index data:', this.marketIndexData);
            
            // Show user-friendly message if market data failed
            if (!this.marketIndexData || (!this.marketIndexData.sp500 && !this.marketIndexData.nasdaq && !this.marketIndexData.russell2000)) {
                console.warn('Market comparison data unavailable - benchmark data file missing or empty');
                // Optionally show a user notification
                const marketComparisonDiv = document.getElementById('marketComparison');
                if (marketComparisonDiv) {
                    marketComparisonDiv.innerHTML = `
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-triangle me-2"></i>
                            <strong>Market Comparison Unavailable:</strong>
                            SP500, NASDAQ, and Russell 2000 benchmark data could not be loaded.
                            The chart will still display portfolio performance data.
                        </div>
                    `;
                    marketComparisonDiv.style.display = 'block';
                }
            } else {
                // Show success message with available data
                const availableIndices = [];
                if (this.marketIndexData.sp500) availableIndices.push('SP500');
                if (this.marketIndexData.nasdaq) availableIndices.push('NASDAQ');
                if (this.marketIndexData.russell2000) availableIndices.push('Russell 2000');
                
                console.log(`Market comparison data loaded successfully: ${availableIndices.join(', ')}`);
            }
        } catch (error) {
            console.error('Error loading market index data:', error);
            this.marketIndexData = null;
            
            // Show user-friendly error message
            const marketComparisonDiv = document.getElementById('marketComparison');
            if (marketComparisonDiv) {
                marketComparisonDiv.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        <strong>Market Comparison Unavailable:</strong> 
                        Unable to load market index data. The chart will still display portfolio performance data.
                    </div>
                `;
                marketComparisonDiv.style.display = 'block';
            }
        }
    }



    calculateMarketPerformance(indexData) {
        if (!indexData || !indexData.initialPrice || !indexData.currentPrice) {
            return null;
        }

        const performance = ((indexData.currentPrice - indexData.initialPrice) / indexData.initialPrice) * 100;
        return {
            performance: performance,
            initialPrice: indexData.initialPrice,
            currentPrice: indexData.currentPrice
        };
    }

    getMarketPerformanceData() {
        const marketPerformance = {};
        
        if (this.marketIndexData) {
            if (this.marketIndexData.sp500) {
                marketPerformance.sp500 = this.calculateMarketPerformance(this.marketIndexData.sp500);
            }
            if (this.marketIndexData.nasdaq) {
                marketPerformance.nasdaq = this.calculateMarketPerformance(this.marketIndexData.nasdaq);
            }
            if (this.marketIndexData.russell2000) {
                marketPerformance.russell2000 = this.calculateMarketPerformance(this.marketIndexData.russell2000);
            }
        }

        return marketPerformance;
    }

    showMarketComparisonLoading() {
        console.log('Showing market comparison loading state...');
        const marketComparison = document.getElementById('marketComparison');
        if (!marketComparison) {
            console.log('Market comparison element not found');
            return;
        }
        
        // Show the section with loading state
        marketComparison.style.display = 'block';
        
        // Update SP500 with loading indicator
        const sp500Element = document.getElementById('sp500Performance');
        const sp500DetailsElement = document.getElementById('sp500Details');
        if (sp500Element && sp500DetailsElement) {
            sp500Element.textContent = 'Loading...';
            sp500Element.className = 'h5 mb-0 text-muted';
            sp500DetailsElement.textContent = 'Fetching data...';
        }
        
        // Update NASDAQ with loading indicator
        const nasdaqElement = document.getElementById('nasdaqPerformance');
        const nasdaqDetailsElement = document.getElementById('nasdaqDetails');
        if (nasdaqElement && nasdaqDetailsElement) {
            nasdaqElement.textContent = 'Loading...';
            nasdaqElement.className = 'h5 mb-0 text-muted';
            nasdaqDetailsElement.textContent = 'Fetching data...';
        }
        
        // Update Russell 2000 with loading indicator
        const russell2000Element = document.getElementById('russell2000Performance');
        const russell2000DetailsElement = document.getElementById('russell2000Details');
        if (russell2000Element && russell2000DetailsElement) {
            russell2000Element.textContent = 'Loading...';
            russell2000Element.className = 'h5 mb-0 text-muted';
            russell2000DetailsElement.textContent = 'Fetching data...';
        }
    }

    updateMarketComparison() {
        console.log('Updating market comparison...');
        const marketComparison = document.getElementById('marketComparison');
        if (!marketComparison) {
            console.log('Market comparison element not found');
            return;
        }

        const marketPerformance = this.getMarketPerformanceData();
        console.log('Market performance data:', marketPerformance);
        
        if (marketPerformance.sp500 || marketPerformance.nasdaq || marketPerformance.russell2000) {
            console.log('Showing market comparison section');
            marketComparison.style.display = 'block';
            
            // Update SP500
            if (marketPerformance.sp500) {
                console.log('Updating SP500 display:', marketPerformance.sp500);
                const sp500Element = document.getElementById('sp500Performance');
                const sp500DetailsElement = document.getElementById('sp500Details');
                
                if (sp500Element && sp500DetailsElement) {
                    const performance = marketPerformance.sp500.performance;
                    const sign = performance >= 0 ? '+' : '';
                    const performanceClass = performance >= 0 ? 'performance-positive' : 'performance-negative';
                    
                    sp500Element.textContent = `${sign}${performance.toFixed(2)}%`;
                    sp500Element.className = `h5 mb-0 ${performanceClass}`;
                    
                    sp500DetailsElement.textContent = 
                        `${Math.round(marketPerformance.sp500.initialPrice)} → ${Math.round(marketPerformance.sp500.currentPrice)}`;
                } else {
                    console.log('SP500 display elements not found');
                }
            }
            
            // Update NASDAQ
            if (marketPerformance.nasdaq) {
                console.log('Updating NASDAQ display:', marketPerformance.nasdaq);
                const nasdaqElement = document.getElementById('nasdaqPerformance');
                const nasdaqDetailsElement = document.getElementById('nasdaqDetails');
                
                if (nasdaqElement && nasdaqDetailsElement) {
                    const performance = marketPerformance.nasdaq.performance;
                    const sign = performance >= 0 ? '+' : '';
                    const performanceClass = performance >= 0 ? 'performance-positive' : 'performance-negative';
                    
                    nasdaqElement.textContent = `${sign}${performance.toFixed(2)}%`;
                    nasdaqElement.className = `h5 mb-0 ${performanceClass}`;
                    
                    nasdaqDetailsElement.textContent = 
                        `${Math.round(marketPerformance.nasdaq.initialPrice)} → ${Math.round(marketPerformance.nasdaq.currentPrice)}`;
                            } else {
                console.log('NASDAQ display elements not found');
            }
        }
        
        // Update Russell 2000
        if (marketPerformance.russell2000) {
            console.log('Updating Russell 2000 display:', marketPerformance.russell2000);
            const russell2000Element = document.getElementById('russell2000Performance');
            const russell2000DetailsElement = document.getElementById('russell2000Details');
            
            if (russell2000Element && russell2000DetailsElement) {
                const performance = marketPerformance.russell2000.performance;
                const sign = performance >= 0 ? '+' : '';
                const performanceClass = performance >= 0 ? 'performance-positive' : 'performance-negative';
                
                russell2000Element.textContent = `${sign}${performance.toFixed(2)}%`;
                russell2000Element.className = `h5 mb-0 ${performanceClass}`;
                
                russell2000DetailsElement.textContent = 
                    `${Math.round(marketPerformance.russell2000.initialPrice)} → ${Math.round(marketPerformance.russell2000.currentPrice)}`;
            } else {
                console.log('Russell 2000 display elements not found');
            }
        } else {
            console.log('No Russell 2000 performance data available for display');
        }
    } else {
        console.log('No market performance data available, hiding comparison section');
        marketComparison.style.display = 'none';
    }
}

    updateDisplay() {
        console.log('updateDisplay called');
        console.log('scoreData available:', !!this.scoreData);
        console.log('marketData available:', !!this.marketData);
        if (this.marketData) {
            console.log('marketData keys:', Object.keys(this.marketData));
            console.log('marketData length:', Object.keys(this.marketData).length);
        }
        
        if (!this.scoreData) {
            console.log('No score data available, showing error');
            this.showError("No score data available");
            return;
        }

        if (
            !this.marketData ||
            Object.keys(this.marketData).length === 0
        ) {
            console.warn('No market data available, attempting to show basic chart with score data only');
            
            // Try to show a basic chart with just score data
            this.hideMessages();
            
            // Show the chart container
            const chartContainer = document.getElementById("performanceChart").parentElement;
            if (chartContainer) {
                chartContainer.style.display = "block";
            }
            
            // Show a message about limited data
            const summaryElement = document.getElementById("summary");
            const existingMessage = summaryElement.querySelector(".limited-data-message");
            if (!existingMessage) {
                const messageDiv = document.createElement("div");
                messageDiv.className = "alert alert-warning limited-data-message mb-3";
                messageDiv.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <strong>Limited data mode.</strong> 
                    Market data is not available, so the chart shows only score data. 
                    Performance calculations and trend lines are not available without market data.
                `;
                summaryElement.insertBefore(messageDiv, summaryElement.firstChild);
            }
            
            // Try to create a basic chart with score data only
            this.updateChart();
            this.updateStockTable();
            
            // Hide back button since we're in aggregate view
            document.getElementById("backToAggregate").style.display = "none";
            
            // Remove stock detail view class
            const tableContainer = document.querySelector(".table-responsive");
            if (tableContainer) {
                tableContainer.classList.remove("stock-detail-view");
            }
            
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
        
        // Show loading state for market comparison
        this.showMarketComparisonLoading();

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
        console.log('updateChart called - marketIndexData available:', !!this.marketIndexData);
        if (this.marketIndexData) {
            console.log('Market index data in updateChart:', {
                sp500: this.marketIndexData.sp500 ? 'available' : 'not available',
                nasdaq: this.marketIndexData.nasdaq ? 'available' : 'not available',
                russell2000: this.marketIndexData.russell2000 ? 'available' : 'not available'
            });
        } else {
            console.log('No market index data available - chart will show portfolio data only');
        }
        
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

        // Populate the mobile colour key from the live datasets (issue #244).
        this.renderColorKey();
    }

    // Populate the mobile colour key (#chartColorKey) from the live chart
    // datasets so it always matches what is actually drawn, in both the
    // single-stock and aggregate views (issue #244, milestone #236).
    //
    // Desktop keeps the native Chart.js legend, so this is a mobile-only
    // mirror. Each chip pairs a swatch (the dataset's own borderColor) with a
    // label (the dataset's own label) — the live datasets are the single
    // source of truth, with no duplicated colour/label table. Hidden and
    // unlabelled "spacer" series are excluded by GRQColorKey.colorKeyEntries;
    // Chart.js annotation markers and the zero baseline are annotations, not
    // datasets, so they never appear here.
    renderColorKey() {
        const container = document.getElementById("chartColorKey");
        if (!container) {
            return;
        }

        // Always clear first so a re-render never duplicates chips.
        container.innerHTML = "";

        // Desktop uses the native legend; only mobile needs the key.
        if (!this.isMobileDevice()) {
            return;
        }
        if (!this.chart || !this.chart.data) {
            return;
        }

        const entries = globalThis.GRQColorKey.colorKeyEntries(
            this.chart.data.datasets,
        );
        for (const entry of entries) {
            const chip = document.createElement("div");
            chip.className = "chart-color-key-chip";

            // The swatch is a tiny SVG line that mirrors the dataset's own
            // stroke — colour plus dash pattern — so same-colour series (e.g.
            // the two greys) stay distinguishable by their dashed/dotted style
            // (issue #245). borderDash flows straight from the live dataset, so
            // there is no hard-coded per-series style table.
            const swatch = this.buildColorKeySwatch(entry);

            const label = document.createElement("span");
            label.className = "chart-color-key-label";
            label.textContent = entry.label;

            chip.appendChild(swatch);
            chip.appendChild(label);
            container.appendChild(chip);
        }
    }

    // Build one colour-key swatch as an inline SVG line. Drawing a line (rather
    // than a filled block) lets the swatch reflect the dataset's stroke style:
    // a solid line for a solid series and a dashed/dotted line when the dataset
    // carries a `borderDash`. Both colour and dash come from the live dataset
    // via the colour-key entry, so the swatch always matches what is drawn on
    // the chart (issue #245).
    buildColorKeySwatch(entry) {
        const SVG_NS = "http://www.w3.org/2000/svg";
        const width = 18;
        const height = 12;
        const midY = height / 2;

        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "chart-color-key-swatch");
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("aria-hidden", "true");

        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", "1");
        line.setAttribute("y1", String(midY));
        line.setAttribute("x2", String(width - 1));
        line.setAttribute("y2", String(midY));
        line.setAttribute("stroke", entry.colour);
        line.setAttribute("stroke-width", "2");

        const dash = Array.isArray(entry.dash) ? entry.dash : [];
        if (dash.length > 0) {
            // Round caps render the small "[2, 2]" patterns as dots rather than
            // tiny rectangles, matching how Chart.js draws dotted lines.
            line.setAttribute("stroke-linecap", "round");
            line.setAttribute("stroke-dasharray", dash.join(","));
        }

        svg.appendChild(line);
        return svg;
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
        console.log("prepareChartData - marketData available:", !!this.marketData);
        if (this.marketData) {
            console.log("prepareChartData - marketData stocks:", Object.keys(this.marketData));
        }

        // If no market data is available, create a basic chart with just score data
        if (!this.marketData || Object.keys(this.marketData).length === 0) {
            console.log("No market data available, creating basic chart with score data only");
            return this.prepareBasicChartData();
        }

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
                    // Use the latest market data date for trend line, not just today
                    const latestMarketDate = marketData && marketData.length > 0 ? marketData[marketData.length - 1].date : new Date();
                    // ... existing code ...
                    // When calling calculateTrendLine, pass latestMarketDate as 'today'
                    const trendLine = this.calculateTrendLine(stock, scoreDate, latestMarketDate);
                    if (trendLine && trendLine.dataPoints.length > 0) {
                        datasets.push({
                            label: "Projection (Trend Line)",
                            data: trendLine.dataPoints.map((p) => ({
                                x: new Date(scoreDate.getTime() + p.x * 24 * 60 * 60 * 1000),
                                y: p.y
                            })),
                            borderColor: "rgba(40, 167, 69, 0.7)",
                            borderDash: [8, 4],
                            borderWidth: 2,
                            fill: false,
                            pointRadius: 0,
                            showLine: true,
                        });
                    }
                    // ... existing code ...
                }
            }
        } else {
            // Portfolio view
            console.log("prepareChartData - entering portfolio view");
            console.log("prepareChartData - marketData available for portfolio:", !!this.marketData);
            if (this.marketData) {
                console.log("prepareChartData - marketData stocks count:", Object.keys(this.marketData).length);
                console.log("prepareChartData - marketData stocks:", Object.keys(this.marketData));
            }
            
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
                    if (daysElapsed >= 80) {
                        confidenceThreshold = 0.001; // Extremely lenient for very late-stage predictions (80+ days)
                    } else if (daysElapsed >= 60) {
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

        // Add market indices data
        console.log('Checking for market index data in chart preparation...');
        console.log('this.marketIndexData:', this.marketIndexData);
        
        if (this.marketIndexData) {
            const scoreDate = this.getScoreDate(this.selectedFile);
            console.log('Score date for chart:', scoreDate.toISOString().split('T')[0]);
            
            // Add SP500 data
            if (this.marketIndexData.sp500 && this.marketIndexData.sp500.data.length > 0) {
                console.log('SP500 data available:', this.marketIndexData.sp500.data.length, 'points');
                console.log('SP500 initial price:', this.marketIndexData.sp500.initialPrice);
                console.log('SP500 current price:', this.marketIndexData.sp500.currentPrice);
                
                const sp500Data = this.marketIndexData.sp500.data
                    .filter(point => point.date <= maxDate)
                    .map(point => {
                        const initialPrice = this.marketIndexData.sp500.initialPrice;
                        const performance = ((point.close - initialPrice) / initialPrice) * 100;
                        return {
                            x: new Date(point.date.getTime()),
                            y: performance
                        };
                    });
                
                console.log('SP500 chart data points:', sp500Data.length);
                if (sp500Data.length > 0) {
                    console.log('Adding SP500 to chart datasets');
                    datasets.push({
                        label: "SP500",
                        data: sp500Data,
                        borderColor: "rgba(255, 99, 132, 0.8)",
                        backgroundColor: "rgba(255, 99, 132, 0.1)",
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0,
                        tension: 0.1,
                    });
                }
            } else {
                console.log('No SP500 data available');
            }

            // Add NASDAQ data
            if (this.marketIndexData.nasdaq && this.marketIndexData.nasdaq.data.length > 0) {
                console.log('NASDAQ data available:', this.marketIndexData.nasdaq.data.length, 'points');
                console.log('NASDAQ initial price:', this.marketIndexData.nasdaq.initialPrice);
                console.log('NASDAQ current price:', this.marketIndexData.nasdaq.currentPrice);
                
                const nasdaqData = this.marketIndexData.nasdaq.data
                    .filter(point => point.date <= maxDate)
                    .map(point => {
                        const initialPrice = this.marketIndexData.nasdaq.initialPrice;
                        const performance = ((point.close - initialPrice) / initialPrice) * 100;
                        return {
                            x: new Date(point.date.getTime()),
                            y: performance
                        };
                    });
                
                console.log('NASDAQ chart data points:', nasdaqData.length);
                if (nasdaqData.length > 0) {
                    console.log('Adding NASDAQ to chart datasets');
                    datasets.push({
                        label: "NASDAQ",
                        data: nasdaqData,
                        borderColor: "rgba(54, 162, 235, 0.8)",
                        backgroundColor: "rgba(54, 162, 235, 0.1)",
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0,
                        tension: 0.1,
                    });
                }
            } else {
                console.log('No NASDAQ data available');
            }

            // Add Russell 2000 data
            if (this.marketIndexData.russell2000 && this.marketIndexData.russell2000.data.length > 0) {
                console.log('Russell 2000 data available:', this.marketIndexData.russell2000.data.length, 'points');
                console.log('Russell 2000 initial price:', this.marketIndexData.russell2000.initialPrice);
                console.log('Russell 2000 current price:', this.marketIndexData.russell2000.currentPrice);
                
                const russell2000Data = this.marketIndexData.russell2000.data
                    .filter(point => point.date <= maxDate)
                    .map(point => {
                        const initialPrice = this.marketIndexData.russell2000.initialPrice;
                        const performance = ((point.close - initialPrice) / initialPrice) * 100;
                        return {
                            x: new Date(point.date.getTime()),
                            y: performance
                        };
                    });
                
                console.log('Russell 2000 chart data points:', russell2000Data.length);
                if (russell2000Data.length > 0) {
                    console.log('Adding Russell 2000 to chart datasets');
                    datasets.push({
                        label: "Russell 2000",
                        data: russell2000Data,
                        borderColor: "rgba(75, 192, 192, 0.8)",
                        backgroundColor: "rgba(75, 192, 192, 0.1)",
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0,
                        tension: 0.1,
                    });
                }
            } else {
                console.log('No Russell 2000 data available');
            }
        } else {
            console.log('No market index data available');
        }

        console.log("prepareChartData - final datasets count:", datasets.length);
        datasets.forEach((dataset, index) => {
            console.log(`prepareChartData - dataset ${index} (${dataset.label}):`, dataset.data.length, "points");
        });

        // If no datasets were created (no market data), create a fallback chart
        if (datasets.length === 0) {
            console.log("No chart datasets available, creating fallback chart with portfolio structure");
            
            // Create a simple chart showing portfolio structure (target percentages)
            const portfolioStructureData = this.scoreData.map((stock, index) => ({
                x: new Date(scoreDate.getTime()),
                y: stock.target
            }));
            
            datasets.push({
                label: "Portfolio Targets (No Market Data)",
                data: portfolioStructureData,
                borderColor: "rgba(75, 192, 192, 0.8)",
                backgroundColor: "rgba(75, 192, 192, 0.1)",
                borderWidth: 2,
                fill: false,
                pointRadius: 4,
                tension: 0.1,
            });
            
            console.log("Fallback chart created with", portfolioStructureData.length, "data points");
        }
        


        return { datasets };
    }

    prepareBasicChartData() {
        console.log("prepareBasicChartData called - creating basic chart with score data only");
        
        const datasets = [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        
        // Create a simple dataset showing just the score data
        if (this.selectedStock) {
            // Single stock view - show just the score and target
            const stock = this.scoreData.find((s) => s.stock === this.selectedStock);
            if (stock) {
                // Create a simple line showing the target
                const targetData = [
                    { x: scoreDate, y: 0 },
                    { x: new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000)), y: 100 }
                ];
                
                datasets.push({
                    label: `${this.selectedStock} Target (90 days)`,
                    data: targetData,
                    borderColor: this.getColor(0, 0.8),
                    backgroundColor: this.getColor(0, 0.1),
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    tension: 0,
                    borderDash: [5, 5]
                });
                
                // Add a point for the current score
                datasets.push({
                    label: `${this.selectedStock} Score`,
                    data: [{ x: scoreDate, y: 0 }],
                    borderColor: this.getColor(0, 1),
                    backgroundColor: this.getColor(0, 0.8),
                    borderWidth: 3,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    showLine: false
                });
            }
        } else {
            // Portfolio view - show all stocks as individual points
            this.scoreData.forEach((stock, index) => {
                const targetData = [
                    { x: scoreDate, y: 0 },
                    { x: new Date(scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000)), y: 100 }
                ];
                
                datasets.push({
                    label: `${stock.stock} Target`,
                    data: targetData,
                    borderColor: this.getColor(index, 0.3),
                    backgroundColor: this.getColor(index, 0.05),
                    borderWidth: 1,
                    fill: false,
                    pointRadius: 0,
                    tension: 0,
                    borderDash: [3, 3]
                });
                
                // Add a point for each stock's current position
                datasets.push({
                    label: `${stock.stock} Score`,
                    data: [{ x: scoreDate, y: 0 }],
                    borderColor: this.getColor(index, 1),
                    backgroundColor: this.getColor(index, 0.8),
                    borderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    showLine: false
                });
            });
        }
        
        console.log("Basic chart data created with", datasets.length, "datasets");
        return { datasets };
    }

    calculatePortfolioData() {
        console.log("calculatePortfolioData called");
        console.log("calculatePortfolioData - marketData available:", !!this.marketData);
        if (this.marketData) {
            console.log("calculatePortfolioData - marketData stocks:", Object.keys(this.marketData));
        }
        
        const scoreDate = this.getScoreDate(this.selectedFile);
        const ninetyDayDate = new Date(
            scoreDate.getTime() + (90 * 24 * 60 * 60 * 1000),
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
                const currentPriceResult={rawValue:null,formattedValue:null}
                this.getWorking("current-price",stock.stock,this.scoreData,currentPriceResult);
                
                // Get current price as raw number for color logic
                const marketData = this.marketData[stock.stock];
                const currentPriceRaw = marketData && marketData.length > 0 ? (marketData[marketData.length - 1].high + marketData[marketData.length - 1].low) / 2 : null;

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

                // Escape untrusted TSV-derived fields before interpolation (issue #63).
                const safeStock = escapeHtml(stock.stock);
                const safeNotes = escapeHtml(stock.notes);
                stockCard.innerHTML = `
            <div class="card-header">
              <h5 class="card-title mb-0">${safeStock} - Detailed Information</h5>
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
                            data-bs-title="Buy Price - ${safeStock}" 
                            data-field="buy-price" 
                            data-stock="${safeStock}"
                            style="${buyPrice === null ? 'color: #c00; font-weight: bold;' : ''}"
                        >${this.formatCurrency(buyPrice)}</span>
                        ${this.getStarRatingDisplay(stock.stock) ? ` <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Stars - ${safeStock}" data-field="stars" data-stock="${safeStock}">${this.getStarRatingDisplay(stock.stock)}</span>` : ''}
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>90-Day Target:</strong></div>
                    <div class="col-6">
                        <span class="clickable-value" 
                            data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                            data-bs-title="90-Day Target - ${safeStock}" 
                            data-field="target" 
                            data-stock="${safeStock}"
                            style="${target === null ? 'color: #c00; font-weight: bold;' : this.getTargetPriceColor(target, currentPriceRaw, buyPrice)}"
                        >${this.formatCurrency(target)}</span>
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Target Percentage:</strong></div>
                    <div class="col-6"><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Target Percentage - ${safeStock}" data-field="target-percentage" data-stock="${safeStock}">${
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
                            data-bs-title="Current Price - ${safeStock}" 
                            data-field="current-price" 
                            data-stock="${safeStock}">${currentPriceResult.formattedValue}</span>
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Performance:</strong></div>
                    <div class="col-6">
                      <span class="clickable-value ${
                    this.getPerformanceClass(performance)
                }" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Gain/Loss - ${safeStock}" data-field="gain-loss" data-stock="${safeStock}">${
    performance !== null ? performance.toFixed(1) + "%" : "N/A"
}</span>
                    </div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Progress vs Cost of Capital:</strong></div>
                    <div class="col-6">
                      <span class="clickable-value ${
                    this.getPerformanceClass(this.calculateProgressVsCostOfCapitalValue(stock, performance))
                }" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Progress vs Cost of Capital - ${safeStock}" data-field="progress-vs-cost" data-stock="${safeStock}">${
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
                        <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Judgement - ${safeStock}" data-field="judgement" data-stock="${safeStock}">${judgement}</span>
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
                        data-bs-title="Intrinsic Value (Basic) - ${safeStock}" data-field="intrinsic-basic" data-stock="${safeStock}">${this.formatCurrency(this.adjustHistoricalPriceToCurrent(stock.intrinsicValuePerShareBasic, stock.stock, this.getScoreDate(this.selectedFile)))}</span></div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Intrinsic Value (Adjusted):</strong></div>
                    <div class="col-6">
                        <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                        data-bs-title="Intrinsic Value (Adjusted) - ${safeStock}" data-field="intrinsic-adjusted" data-stock="${safeStock}">${this.formatCurrency(this.adjustHistoricalPriceToCurrent(stock.intrinsicValuePerShareAdjusted, stock.stock, this.getScoreDate(this.selectedFile)))}</span></div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Ex-Dividend Date:</strong></div>
                    <div class="col-6">${this.getNextExDividendDate(stock.stock)}</div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Average Dividend (90-day):</strong></div>
                    <div class="col-6"><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Average Dividend (90-day) - ${safeStock}" data-field="avg-dividend" data-stock="${safeStock}">${
                    dividends.length > 0
                        ? "$" + (totalDividends / dividends.length).toFixed(4)
                        : "N/A"
                }</span></div>
                  </div>
                  <div class="row mb-2">
                    <div class="col-6"><strong>Total Dividends (90-day):</strong></div>
                    <div class="col-6">
                      <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Total Dividends (90-day) - ${safeStock}" data-field="total-dividend" data-stock="${safeStock}">${
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
                  <div class="row mb-2">
                    <div class="col-6"><strong>Fair Value Range:</strong></div>
                    <div class="col-6">
                      ${
                    (() => {
                        const fairValueRange = this.getFairValueRange(stock.stock);
                        if (!fairValueRange) {
                            return `<span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Fair Value Range - ${safeStock}" data-field="fair-value-range" data-stock="${safeStock}">N/A</span>`;
                        }
                        if (fairValueRange.type === 'range') {
                            const lowColor = this.getTargetPriceColor(fairValueRange.low, currentPriceRaw, buyPrice);
                            const highColor = this.getTargetPriceColor(fairValueRange.high, currentPriceRaw, buyPrice);
                            return `<span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Fair Value Range - ${safeStock}" data-field="fair-value-range" data-stock="${safeStock}"><span style="${lowColor}">$${fairValueRange.low.toFixed(2)}</span>...<span style="${highColor}">$${fairValueRange.high.toFixed(2)}</span></span>`;
                        } else {
                            const valueColor = this.getTargetPriceColor(fairValueRange.value, currentPriceRaw, buyPrice);
                            return `<span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Fair Value Range - ${safeStock}" data-field="fair-value-range" data-stock="${safeStock}"><span style="${valueColor}">$${fairValueRange.value.toFixed(2)}</span> (${fairValueRange.source})</span>`;
                        }
                    })()
                }
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
                      ${safeNotes}
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
          <th>Stars</th>
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
                let currentPrice = this.getCurrentPrice(stock.stock);
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
                // Escape untrusted TSV-derived ticker before interpolation (issue #63).
                const safeStock = escapeHtml(stock.stock);
                row.innerHTML = `
            <td class="clickable-stock" data-stock="${safeStock}">${safeStock}</td>
            <td>
                <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Buy Price - ${safeStock}" 
                    data-field="buy-price" data-stock="${safeStock}" 
                    style="${buyPrice === null ? 'color: #c00; font-weight: bold;' : ''}"
                >${this.formatCurrency(buyPrice)}</span>
            </td>
            <td>
                <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Stars - ${safeStock}" data-field="stars" data-stock="${safeStock}">${this.getStarRatingDisplay(stock.stock)}</span>
            </td>
            <td>
            <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="90-Day Target - ${safeStock}" data-field="target" data-stock="${safeStock}" style="${this.getTargetPriceColor(target, currentPrice, buyPrice)}">${this.formatCurrency(target)
                }</span></td>
            <td>
                <span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" 
                   data-bs-title="Current Price - ${safeStock}" data-field="current-price" data-stock="${safeStock}">${currentPrice}
                </span>
            </td>
            <td><span class="clickable-value ${
                    this.getPerformanceClass(performance)
                }" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Gain/Loss - ${safeStock}" data-field="gain-loss" data-stock="${safeStock}">${
    performance !== null ? performance.toFixed(1) + "%" : "N/A"
}</span></td>
            <td><span class="clickable-value ${
                    this.getPerformanceClass(this.calculateProgressVsCostOfCapitalValue(stock, performance))
                }" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Progress vs Cost of Capital - ${safeStock}" data-field="progress-vs-cost" data-stock="${safeStock}">${
                    this.calculateProgressVsCostOfCapital(
                        stock,
                        performance,
                    )
                }</span></td>
            <td><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Status/Projection - ${safeStock}" data-field="status-projection" data-stock="${safeStock}"><span class="badge ${
                    this.getJudgementClass(judgement)
                }">${judgement}</span></span></td>
            <td><span class="clickable-value" data-bs-toggle="popover" data-bs-trigger="click" data-bs-content="" data-bs-title="Dividends - ${safeStock}" data-field="dividend-info" data-stock="${safeStock}">${dividendInfo}</span></td>
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
          <td>-</td>
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
            // Escape untrusted TSV-derived fields before interpolation (issue #63).
            const safeStock = escapeHtml(stock.stock);
            const safeExDividendDate = escapeHtml(stock.exDividendDate || "N/A");
            const safeNotes = escapeHtml(stock.notes || "");
            row.innerHTML = `
                <td>${safeStock}</td>
                <td>${stock.score.toFixed(3)}</td>
                <td>${this.formatCurrency(stock.target)}</td>
                <td>${safeExDividendDate}</td>
                <td>${stock.dividendPerShare ? this.formatCurrency(stock.dividendPerShare) : "N/A"}</td>
                <td>${stock.intrinsicValuePerShareBasic ? this.formatCurrency(stock.intrinsicValuePerShareBasic) : "N/A"}</td>
                <td>${stock.intrinsicValuePerShareAdjusted ? this.formatCurrency(stock.intrinsicValuePerShareAdjusted) : "N/A"}</td>
                <td>${safeNotes}</td>
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
        // Window filtering lives in the shared projection module (issue #145)
        // so production and the Deno tests exercise the same kernel.
        const dividends = this.dividendData?.[stockSymbol] || [];
        const scoreDate = this.getScoreDate(this.selectedFile);
        return GRQProjection.filterDividendsWithin90Days(dividends, scoreDate);
    }

    getCurrentPrice(stockSymbol) {
        // Latest-price maths lives in the shared projection module (issue #100).
        const currentPrice = GRQProjection.currentPriceFromLatest(
            this.marketData[stockSymbol],
        );
        if (currentPrice === null) return "N/A";
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
                <strong>Market data loading issue detected.</strong> 
                The chart and performance calculations require market data that appears to be unavailable or not loading properly. 
                This may be due to network issues or the data not being fully processed yet. 
                Below is the score data from the selected date.
                <br><br>
                <small>Technical details: The system attempted to load market data but received insufficient data or encountered an error.</small>
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

    getWorking(field, stockSymbol, scoreData,result={rawValue:null,formattedValue:null}) {
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
                result.rawValue = currentPrice;
                result.formattedValue = this.formatCurrency(currentPrice);
                const currentSplitAdjustment = this
                    .getHistoricalToCurrentSplitAdjustment(
                        stockSymbol,
                        lastData.date,
                    );
                if (currentSplitAdjustment > 1.0) {
                    return header +
                        `Current Price working:\n= (High + Low) / 2 from latest market data (post-split)\n= ($${
                            lastData.high.toFixed(2)
                        } + $${lastData.low.toFixed(2)}) / 2\n= ${
                            result.formattedValue
                        } (already post-split, no adjustment needed)`;
                } else {
                    return header +
                        `Current Price working:\n= (High + Low) / 2 from latest market data\n= ($${
                            lastData.high.toFixed(2)
                        } + $${lastData.low.toFixed(2)}) / 2\n= ${
                            result.formattedValue
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
                const gainLossTotalDividends = GRQProjection.sumDividends(gainLossDividends);
                
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
            case "stars":
                const starCalculation = this.getStarRatingCalculation(stockSymbol);
                if (!starCalculation) {
                    return header +
                        "Stars working:\nNo analysis data available for this stock";
                }
                
                const { msStars, tipsStars, avgStars, hundredStars, fullStars, remainderStars, partialStars, moonPhase, display } = starCalculation;
                
                // Format the MS and Tips stars for display
                const msDisplay = msStars !== null ? `${msStars} stars` : 'null';
                const tipsDisplay = tipsStars !== null ? `${tipsStars} stars` : 'null';
                const tipsNormalized = tipsStars !== null ? `${(tipsStars / 2).toFixed(1)} stars` : 'null';
                
                let calculationSteps = `= MorningStar: ${msDisplay}\n= Tips Stars: ${tipsDisplay} (normalized to ${tipsNormalized})\n= Average: (${msDisplay} + ${tipsNormalized}) / 2 = ${avgStars.toFixed(2)} stars`;
                
                if (msStars === null && tipsStars === null) {
                    calculationSteps = `= MorningStar: null\n= Tips Stars: null\n= Average: null (no valid data)`;
                } else if (msStars === null) {
                    calculationSteps = `= MorningStar: null\n= Tips Stars: ${tipsDisplay} (normalized to ${tipsNormalized})\n= Average: ${tipsNormalized} = ${avgStars.toFixed(2)} stars`;
                } else if (tipsStars === null) {
                    calculationSteps = `= MorningStar: ${msDisplay}\n= Tips Stars: null\n= Average: ${msDisplay} = ${avgStars.toFixed(2)} stars`;
                }
                
                let roundingSteps = `\n\nRounding to nearest quarter:\n= ${avgStars.toFixed(2)} × 20 = ${(avgStars * 20).toFixed(1)}\n= Rounded to ${hundredStars} twentieths\n= Full stars: ${hundredStars} ÷ 20 = ${fullStars}\n= Remainder: ${hundredStars} - (${fullStars} × 20) = ${remainderStars} twentieths\n= Partial stars: ${remainderStars} ÷ 5 = ${(remainderStars / 5).toFixed(1)} → ${partialStars} quarters`;
                
                if (remainderStars === 0) {
                    roundingSteps = `\n\nRounding to nearest quarter:\n= ${avgStars.toFixed(2)} × 20 = ${(avgStars * 20).toFixed(1)}\n= Rounded to ${hundredStars} twentieths\n= Full stars: ${hundredStars} ÷ 20 = ${fullStars}\n= No remainder (exact quarter)`;
                }
                
                let moonPhaseStep = '';
                if (remainderStars > 0) {
                    moonPhaseStep = `\n= Moon phase: ${moonPhase}`;
                }
                
                return header +
                    `Stars working:\n${calculationSteps}${roundingSteps}${moonPhaseStep}\n= Display: ${display}`;
            case "fair-value-range":
                const fairValueRange = this.getFairValueRange(stockSymbol);
                if (!fairValueRange) {
                    return header +
                        "Fair Value Range working:\nNo analysis data available for this stock";
                }
                
                if (fairValueRange.type === 'range') {
                    return header +
                        `Fair Value Range working:\n= MS Fair Value: $${fairValueRange.low.toFixed(2)}\n= Tips Target: $${fairValueRange.high.toFixed(2)}\n= Range: $${fairValueRange.low.toFixed(2)} - $${fairValueRange.high.toFixed(2)}`;
                } else {
                    return header +
                        `Fair Value Range working:\n= ${fairValueRange.source}: $${fairValueRange.value.toFixed(2)}\n= Only one value available`;
                }
            default:
                return "Calculation working not implemented for this field";
        }
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

        // Target-percentage maths lives in the shared projection module
        // (issue #100).
        return GRQProjection.calculateTargetPercentage(
            buyPrice !== null ? buyPrice.price : null,
            adjustedTarget,
        );
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
        const totalDividends = GRQProjection.sumDividends(dividends);
        const dividendReturn = (totalDividends / buyPriceObj.price) * 100;

        return priceReturn + dividendReturn;
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

// Initialize the validator
const validator = new GRQValidator();

// Re-evaluate the chart legend and the mobile colour key when the viewport
// changes (window resize / orientation change). Crossing the isMobileDevice()
// breakpoint flips the native Chart.js legend (the desktop identifier) and
// shows+populates the mobile colour key, or tears it down again — so neither
// is ever left stale (issue #246, milestone #236).
function syncChartForViewport() {
    const isMobile = validator.isMobileDevice();

    // Keep the native legend in step with the breakpoint when a chart exists.
    if (
        validator.chart && validator.chart.options &&
        validator.chart.options.plugins &&
        validator.chart.options.plugins.legend
    ) {
        validator.chart.options.plugins.legend.display = !isMobile;

        // Only set font size if the labels object exists.
        if (validator.chart.options.plugins.legend.labels) {
            validator.chart.options.plugins.legend.labels.font =
                validator.chart.options.plugins.legend.labels.font || {};
            validator.chart.options.plugins.legend.labels.font.size = isMobile ? 10 : 12;
            validator.chart.options.plugins.legend.labels.boxWidth = isMobile ? 12 : 16;
            validator.chart.options.plugins.legend.labels.padding = isMobile ? 8 : 12;
        }

        validator.chart.update();
    }

    // Reconcile the mobile colour key from the live datasets: populate it on
    // mobile, clear it on desktop. renderColorKey() guards a null/unbuilt chart
    // itself, so this is safe to call before the first chart exists (no errors).
    validator.renderColorKey();
}

// Debounce so a burst of resize / orientation-change events does at most one
// rebuild per settle, keeping the toggle cheap (issue #246).
const debouncedSyncChartForViewport = globalThis.GRQColorKey.debounce(
    syncChartForViewport,
    150,
);
globalThis.addEventListener("resize", debouncedSyncChartForViewport);
globalThis.addEventListener("orientationchange", debouncedSyncChartForViewport);

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
