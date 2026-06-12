// Render helper for the score-file name column (issue #103).
//
// The `file` value rendered by docs/list.js originates from the untrusted
// scores/index.json. DataTables inserts a render callback's display return
// value as cell HTML, so the value must be HTML-escaped before it lands in the
// table — otherwise a filename bearing HTML metacharacters executes as script
// in the visitor's browser (stored/DOM XSS).
//
// Loaded as a classic <script> in docs/list.html (after escape.js, before
// list.js) and imported by the Deno tests. It uses no module syntax so it is
// valid in both environments; the helper is published on `globalThis`.
function renderScoreFileName(file) {
    const name = (file === null || file === undefined ? "" : String(file))
        .replace(".tsv", "");
    return globalThis.escapeHtml(name);
}

globalThis.renderScoreFileName = renderScoreFileName;
