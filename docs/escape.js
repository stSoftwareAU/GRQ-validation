// Shared escaping helpers for the dashboard.
//
// The score/notes data rendered by the dashboard originates from untrusted
// TSV/CSV files (see issue #63). These helpers neutralise HTML and
// JavaScript-string metacharacters before that data is interpolated into
// `innerHTML` template literals, preventing stored/DOM XSS.
//
// This file is loaded as a classic <script> in docs/index.html and is also
// imported by the Deno tests. It deliberately uses no module syntax so it is
// valid in both environments; the helpers are published on `globalThis`.

// Lookup map of HTML metacharacters to their entity replacements. A single
// regex-driven pass over this map means every character is matched and replaced
// exactly once, so escaped entities are never re-escaped.
const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

// Escape a value for safe insertion into HTML text or a double-quoted
// HTML attribute. Returns an empty string for null/undefined.
function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Lookup map of JavaScript-string metacharacters to their backslash escapes.
// The line/paragraph separators (U+2028/U+2029) are keyed via fromCharCode so
// the source carries no invisible literals. The backslash is included so the
// single regex pass escapes it once, avoiding the double-escaping a sequential
// chain risks.
const JS_STRING_ESCAPES = {
    "\\": "\\\\",
    "'": "\\'",
    '"': '\\"',
    "\n": "\\n",
    "\r": "\\r",
    [String.fromCharCode(0x2028)]: "\\u2028",
    [String.fromCharCode(0x2029)]: "\\u2029",
    "<": "\\x3C",
    ">": "\\x3E",
    "&": "\\x26",
};

// Escape a value for safe insertion inside a JavaScript string literal (for
// example an inline `onclick` handler). The result must still be passed
// through escapeHtml when it lands in an HTML attribute. Returns an empty
// string for null/undefined.
function escapeJsString(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).replace(
        /[\\'"\n\r\u2028\u2029<>&]/g,
        (ch) => JS_STRING_ESCAPES[ch],
    );
}

// Publish on globalThis so classic-script callers (the browser dashboard) and
// the Deno test importer can both reach the helpers.
globalThis.escapeHtml = escapeHtml;
globalThis.escapeJsString = escapeJsString;
