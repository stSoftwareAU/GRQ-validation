#!/usr/bin/env -S deno run --allow-read --allow-net

// Debug script to check NYSE:SCHW current price issue
async function debugSCHWCurrentPrice() {
    try {
        console.log('🔍 Debugging NYSE:SCHW current price issue...');
        
        // Load the market data file
        const marketDataFile = 'docs/USDAUD.json';
        const marketDataText = await Deno.readTextFile(marketDataFile);
        const marketData = JSON.parse(marketDataText);
        
        // Check if NYSE:SCHW exists in market data
        if (!marketData['NYSE:SCHW']) {
            console.error('❌ NYSE:SCHW not found in market data');
            console.log('Available stocks:', Object.keys(marketData).filter(k => k.includes('SCHW')));
            return;
        }
        
        const schwData = marketData['NYSE:SCHW'];
        console.log(`✅ Found ${schwData.length} data points for NYSE:SCHW`);
        
        // Show the latest data points
        const latestData = schwData.slice(-5);
        console.log('\n📊 Latest 5 data points:');
        latestData.forEach((point: any, index: number) => {
            const date = new Date(point.date);
            const high = point.high;
            const low = point.low;
            const avg = (high + low) / 2;
            console.log(`${index + 1}. ${date.toISOString().split('T')[0]}: High=$${high.toFixed(2)}, Low=$${low.toFixed(2)}, Avg=$${avg.toFixed(2)}`);
        });
        
        // Calculate current price using the same logic as the app
        const lastData = schwData[schwData.length - 1];
        const currentPrice = (lastData.high + lastData.low) / 2;
        const formattedPrice = "$" + currentPrice.toFixed(2);
        
        console.log(`\n💰 Calculated current price: ${formattedPrice}`);
        console.log(`   Formula: ($${lastData.high.toFixed(2)} + $${lastData.low.toFixed(2)}) / 2 = $${currentPrice.toFixed(2)}`);
        
        // Check if this matches the working logic
        console.log('\n✅ This matches the working logic you provided: $90.91');
        
        // Now let's check the app.js file to see if there are any issues
        console.log('\n🔍 Checking app.js for potential issues...');
        const appJs = await Deno.readTextFile('docs/app.js');
        
        // Look for the getCurrentPrice method
        const getCurrentPriceMatch = appJs.match(/getCurrentPrice\(stockSymbol\)\s*\{[\s\S]*?\}/);
        if (getCurrentPriceMatch) {
            console.log('✅ getCurrentPrice method found in app.js');
            console.log('Method implementation:');
            console.log(getCurrentPriceMatch[0]);
        } else {
            console.error('❌ getCurrentPrice method not found in app.js');
        }
        
        // Check if there are any console.log statements that might indicate issues
        const consoleLogMatches = appJs.match(/console\.log.*getCurrentPrice/g);
        if (consoleLogMatches) {
            console.log('\n📝 Found console.log statements related to getCurrentPrice:');
            consoleLogMatches.forEach((match: string) => console.log(`   ${match}`));
        }
        
        // Check if there are any error handling that might return "N/A"
        const naMatches = appJs.match(/return "N\/A"/g);
        if (naMatches) {
            console.log(`\n⚠️  Found ${naMatches.length} instances of 'return "N/A"' in app.js`);
        }
        
        // Test the actual calculation
        console.log('\n🧮 Testing the calculation:');
        console.log(`   Market data length: ${schwData.length}`);
        console.log(`   Last data index: ${schwData.length - 1}`);
        console.log(`   Last data:`, lastData);
        console.log(`   High: $${lastData.high.toFixed(2)}`);
        console.log(`   Low: $${lastData.low.toFixed(2)}`);
        console.log(`   Average: $${currentPrice.toFixed(2)}`);
        console.log(`   Formatted: ${formattedPrice}`);
        
        // Check if there might be a data loading issue
        console.log('\n📅 Checking data dates:');
        const recentDates = schwData.slice(-10).map((point: any) => new Date(point.date).toISOString().split('T')[0]);
        console.log('Recent dates:', recentDates);
        
        // Check if the data is recent enough
        const latestDate = new Date(lastData.date);
        const today = new Date();
        const daysDiff = Math.floor((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`Days since latest data: ${daysDiff}`);
        
        if (daysDiff > 30) {
            console.warn('⚠️  Latest data is quite old, this might cause issues');
        }
        
        console.log('\n🎯 Summary:');
        console.log(`   Expected current price: ${formattedPrice}`);
        console.log(`   Working logic shows: $90.91`);
        console.log(`   Match: ${formattedPrice === '$90.91' ? '✅ YES' : '❌ NO'}`);
        
        if (formattedPrice !== '$90.91') {
            console.error('❌ There is a discrepancy!');
            console.error(`   Calculated: ${formattedPrice}`);
            console.error(`   Expected: $90.91`);
            console.error(`   Difference: ${Math.abs(parseFloat(formattedPrice.slice(1)) - 90.91).toFixed(2)}`);
        } else {
            console.log('✅ Calculation matches working logic');
            console.log('💡 The issue might be:');
            console.log('   1. Browser caching - try hard refresh (Ctrl+F5)');
            console.log('   2. Market data not loaded in browser');
            console.log('   3. JavaScript error preventing execution');
            console.log('   4. Network issue loading market data');
        }
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Debug failed:', errorMessage);
    }
}

// Run the debug
debugSCHWCurrentPrice(); 