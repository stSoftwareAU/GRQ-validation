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

// Escape a value for safe insertion into HTML text or a double-quoted
// HTML attribute. Returns an empty string for null/undefined.
function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

// Escape a value for safe insertion inside a JavaScript string literal (for
// example an inline `onclick` handler). The result must still be passed
// through escapeHtml when it lands in an HTML attribute. Returns an empty
// string for null/undefined.
function escapeJsString(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll('"', '\\"')
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r")
        .replaceAll(String.fromCharCode(0x2028), "\\u2028")
        .replaceAll(String.fromCharCode(0x2029), "\\u2029")
        .replaceAll("<", "\\x3C")
        .replaceAll(">", "\\x3E")
        .replaceAll("&", "\\x26");
}

// Publish on globalThis so classic-script callers (the browser dashboard) and
// the Deno test importer can both reach the helpers.
globalThis.escapeHtml = escapeHtml;
globalThis.escapeJsString = escapeJsString;
