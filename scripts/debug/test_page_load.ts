#!/usr/bin/env -S deno run --allow-net --allow-run --allow-read

// Test the page load by making HTTP requests
async function testPageLoad() {
    let serverProcess: any = null;
    
    try {
        console.log('🚀 Starting server...');
        
        // Start the server using spawn
        serverProcess = new Deno.Command('bash', {
            args: ['helpers/server.sh'],
            cwd: Deno.cwd(),
            stdout: 'piped',
            stderr: 'piped'
        }).spawn();
        
        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('📄 Testing page load...');
        
        // Test the main page
        const response = await fetch('http://localhost:8000');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        
        // Check for basic page structure
        if (!html.includes('<title>')) {
            throw new Error('Page missing title tag');
        }
        
        if (!html.includes('app.js')) {
            throw new Error('Page missing app.js reference');
        }
        
        console.log('✅ Main page loads successfully');
        
        // Test if app.js loads without syntax errors
        const appJsResponse = await fetch('http://localhost:8000/app.js');
        
        if (!appJsResponse.ok) {
            throw new Error(`app.js not found: HTTP ${appJsResponse.status}`);
        }
        
        const appJs = await appJsResponse.text();
        
        // Basic syntax check - look for common issues
        const syntaxChecks = [
            { pattern: /const\s+(\w+)\s*=\s*[^;]+;\s*const\s+\1/, name: 'Duplicate const declaration' },
            { pattern: /let\s+(\w+)\s*=\s*[^;]+;\s*let\s+\1/, name: 'Duplicate let declaration' },
            { pattern: /var\s+(\w+)\s*=\s*[^;]+;\s*var\s+\1/, name: 'Duplicate var declaration' },
            { pattern: /function\s+(\w+)\s*\([^)]*\)\s*{[^}]*function\s+\1/, name: 'Duplicate function declaration' },
        ];
        
        for (const check of syntaxChecks) {
            if (check.pattern.test(appJs)) {
                throw new Error(`Potential syntax issue: ${check.name}`);
            }
        }
        
        console.log('✅ app.js loads without obvious syntax errors');
        
        // Test data files
        const dataFiles = [
            'scores/2025/April/15.csv',
            'scores/2025/April/15.tsv'
        ];
        
        for (const file of dataFiles) {
            try {
                const fileResponse = await fetch(`http://localhost:8000/${file}`);
                if (fileResponse.ok) {
                    console.log(`✅ ${file} accessible`);
                } else {
                    console.log(`⚠️  ${file} not accessible (${fileResponse.status})`);
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.log(`⚠️  ${file} error: ${errorMessage}`);
            }
        }
        
        console.log('🎉 All tests passed!');
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Test failed:', errorMessage);
        Deno.exit(1);
    } finally {
        // Cleanup
        if (serverProcess) {
            serverProcess.kill();
        }
    }
}

// Run the test
testPageLoad(); 