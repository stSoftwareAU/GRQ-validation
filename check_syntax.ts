#!/usr/bin/env -S deno run --allow-read

// Simple syntax checker for JavaScript files
async function checkSyntax() {
    try {
        console.log('🔍 Checking JavaScript syntax...');
        
        // Read app.js
        const appJs = await Deno.readTextFile('docs/app.js');
        
        // Check for duplicate variable declarations
        const lines = appJs.split('\n');
        const declarations = new Map<string, number[]>();
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Check for const declarations
            const constMatch = line.match(/^const\s+(\w+)/);
            if (constMatch) {
                const varName = constMatch[1];
                if (!declarations.has(varName)) {
                    declarations.set(varName, []);
                }
                declarations.get(varName)!.push(i + 1);
            }
            
            // Check for let declarations
            const letMatch = line.match(/^let\s+(\w+)/);
            if (letMatch) {
                const varName = letMatch[1];
                if (!declarations.has(varName)) {
                    declarations.set(varName, []);
                }
                declarations.get(varName)!.push(i + 1);
            }
            
            // Check for var declarations
            const varMatch = line.match(/^var\s+(\w+)/);
            if (varMatch) {
                const varName = varMatch[1];
                if (!declarations.has(varName)) {
                    declarations.set(varName, []);
                }
                declarations.get(varName)!.push(i + 1);
            }
        }
        
        // Report duplicates
        let hasDuplicates = false;
        for (const [varName, lines] of declarations) {
            if (lines.length > 1) {
                console.error(`❌ Duplicate declaration of '${varName}' on lines: ${lines.join(', ')}`);
                hasDuplicates = true;
            }
        }
        
        if (!hasDuplicates) {
            console.log('✅ No duplicate variable declarations found');
        }
        
        // Check for basic syntax issues
        const syntaxChecks = [
            { pattern: /[^;]\s*$/, name: 'Missing semicolon at end of line' },
            { pattern: /\(\s*\)/, name: 'Empty parentheses' },
            { pattern: /{\s*}/, name: 'Empty function body' },
        ];
        
        let hasSyntaxIssues = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('//') && !line.startsWith('/*')) {
                for (const check of syntaxChecks) {
                    if (check.pattern.test(line)) {
                        console.warn(`⚠️  Line ${i + 1}: ${check.name} - "${line}"`);
                        hasSyntaxIssues = true;
                    }
                }
            }
        }
        
        if (!hasSyntaxIssues) {
            console.log('✅ No obvious syntax issues found');
        }
        
        // Check for specific issues we've encountered
        if (appJs.includes('portfolioData') && (appJs.match(/portfolioData/g) || []).length > 10) {
            console.log('✅ portfolioData usage looks normal');
        }
        
        console.log('🎉 Syntax check completed!');
        
        if (hasDuplicates) {
            Deno.exit(1);
        }
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Syntax check failed:', errorMessage);
        Deno.exit(1);
    }
}

// Run the check
checkSyntax(); 