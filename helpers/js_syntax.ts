// Genuine JavaScript syntax validation (issue #82).
//
// Replaces the brittle "duplicate declaration" regexes that used to live in
// scripts/debug/test_page_load.ts. Those regexes only matched two declarations
// that happened to be textually adjacent (`const x = …; const x`), so they
// missed real duplicates and broke on any reformat. Compiling the source with
// the JavaScript engine parses the WHOLE file and rejects genuine syntax
// errors — including lexical redeclarations — regardless of formatting or how
// far apart the declarations sit.

export interface JsSyntaxResult {
  /** True when the source parses without a syntax error. */
  valid: boolean;
  /** The engine's message when {@link valid} is false. */
  error?: string;
}

/**
 * Check whether `source` is syntactically valid JavaScript.
 *
 * The Function constructor compiles `source` as a function body and throws a
 * SyntaxError on malformed input. It only parses — it never runs the code — so
 * undefined browser globals (`window`, `document`, …) are irrelevant here.
 */
export function checkJsSyntax(source: string): JsSyntaxResult {
  try {
    new Function(source);
    return { valid: true };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { valid: false, error: error.message };
    }
    // Anything that is not a syntax problem is unexpected for a compile-only
    // call — surface it rather than reporting a misleading "invalid syntax".
    throw error;
  }
}
