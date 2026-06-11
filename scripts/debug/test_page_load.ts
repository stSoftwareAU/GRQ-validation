#!/usr/bin/env -S deno run --allow-net --allow-run --allow-read

import { checkJsSyntax } from "../../helpers/js_syntax.ts";

// Manual smoke check: boot the server and confirm observable behaviour —
// the page and app.js are served (HTTP 200) and app.js actually parses as
// valid JavaScript. It no longer greps the served source for substrings or
// brittle regexes (issue #82): those asserted that strings appeared in source,
// not anything a user can observe, and broke on any rename or reformat.
export async function testPageLoad() {
    let serverProcess: Deno.ChildProcess | null = null;
    
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
        
        // HTTP 200 is the observable signal that the page renders — we no
        // longer grep the body for `<title>`/`app.js` substrings.
        console.log('✅ Main page loads successfully (HTTP 200)');

        // app.js must be served...
        const appJsResponse = await fetch('http://localhost:8000/app.js');

        if (!appJsResponse.ok) {
            throw new Error(`app.js not found: HTTP ${appJsResponse.status}`);
        }

        const appJs = await appJsResponse.text();

        // ...and parse as valid JavaScript. Compiling the source catches real
        // syntax errors (including non-adjacent duplicate declarations) that the
        // old adjacency regexes missed, without depending on its formatting.
        const syntax = checkJsSyntax(appJs);
        if (!syntax.valid) {
            throw new Error(`app.js has a syntax error: ${syntax.error}`);
        }

        console.log('✅ app.js is served and parses as valid JavaScript');
        
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

// Run the test only when executed directly, never on import. Await via a
// `.catch` so a rejection surfaces as a non-zero exit instead of a silent
// floating promise (issue #89).
if (import.meta.main) {
    testPageLoad().catch((error: unknown) => {
        console.error(error);
        Deno.exit(1);
    });
} 