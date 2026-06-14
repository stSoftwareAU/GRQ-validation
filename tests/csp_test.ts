// Tests for the Content-Security-Policy defence-in-depth layer on the
// published dashboard pages (issue #189).
//
// The dashboard renders untrusted, TSV-derived contributor data (tickers
// and the free-text Notes field) into innerHTML. escapeHtml/escapeJsString
// are the primary control; a CSP is the second layer that contains a single
// missed escape, turning a would-be DOM XSS into a blocked load. GitHub
// Pages cannot set response headers, so the policy is delivered via a
// `<meta http-equiv="Content-Security-Policy">` tag.
//
// These tests assert the policy: exists on every page; is restrictive
// (script-src without 'unsafe-inline'/'unsafe-eval', object-src 'none',
// base-uri locked down); and permits every external CDN origin the page
// actually loads, so the policy can never silently break the dashboard.

import { assert, assertEquals } from "@std/assert";

const PAGES = ["docs/index.html", "docs/list.html"];

/** Extract the CSP string from the page's meta tag, or null if absent. */
export function extractCsp(html: string): string | null {
  const meta = html.match(
    /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"\s*\/?>/is,
  );
  return meta ? meta[1].replace(/\s+/g, " ").trim() : null;
}

/** Parse a CSP string into a directive-name -> source-list map. */
export function parseCsp(csp: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...sources] = trimmed.split(/\s+/);
    directives[name.toLowerCase()] = sources;
  }
  return directives;
}

/** Origins (scheme + host) of every external script or stylesheet tag. */
export function externalOrigins(
  html: string,
  kind: "script" | "style",
): string[] {
  const origins = new Set<string>();
  const tagRe = kind === "script" ? /<script\b[^>]*>/gis : /<link\b[^>]*>/gis;
  for (const match of html.matchAll(tagRe)) {
    const tag = match[0];
    if (kind === "style" && !/rel\s*=\s*["']stylesheet["']/i.test(tag)) {
      continue;
    }
    const urlAttr = tag.match(
      /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/i,
    );
    if (urlAttr) {
      origins.add(new URL(urlAttr[1]).origin);
    }
  }
  return [...origins];
}

/** Every <script> opening tag in the page (for inline-script detection). */
function scriptTags(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gis)].map((m) => m[0]);
}

// --- Unit tests for the parsing helpers (real calls, crafted inputs) ------

Deno.test("extractCsp - returns the policy when the meta tag is present", () => {
  const html =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; object-src 'none'">`;
  assertEquals(extractCsp(html), "default-src 'self'; object-src 'none'");
});

Deno.test("extractCsp - returns null when no CSP meta tag exists", () => {
  assertEquals(extractCsp(`<meta charset="UTF-8">`), null);
});

Deno.test("parseCsp - splits directives and their sources", () => {
  const parsed = parseCsp(
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; object-src 'none'",
  );
  assertEquals(parsed["default-src"], ["'self'"]);
  assertEquals(parsed["script-src"], ["'self'", "https://cdn.jsdelivr.net"]);
  assertEquals(parsed["object-src"], ["'none'"]);
});

Deno.test("externalOrigins - collects script and stylesheet hosts", () => {
  const html = `
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/a.css">
    <script src="https://code.jquery.com/jquery.js"></script>
    <script src="app.js"></script>
  `;
  assertEquals(externalOrigins(html, "style"), ["https://cdn.jsdelivr.net"]);
  assertEquals(externalOrigins(html, "script"), ["https://code.jquery.com"]);
});

// --- Per-page policy assertions ------------------------------------------

for (const page of PAGES) {
  Deno.test(`${page}: ships a Content-Security-Policy meta tag`, async () => {
    const html = await Deno.readTextFile(page);
    const csp = extractCsp(html);
    assert(csp, `${page} must declare a Content-Security-Policy meta tag`);
  });

  Deno.test(`${page}: script-src is strict (no unsafe-inline/eval)`, async () => {
    const html = await Deno.readTextFile(page);
    const csp = parseCsp(extractCsp(html)!);
    const scriptSrc = csp["script-src"];
    assert(scriptSrc, `${page}: script-src directive is required`);
    assert(
      scriptSrc.includes("'self'"),
      `${page}: script-src must allow 'self'`,
    );
    assert(
      !scriptSrc.includes("'unsafe-inline'"),
      `${page}: script-src must not allow 'unsafe-inline'`,
    );
    assert(
      !scriptSrc.includes("'unsafe-eval'"),
      `${page}: script-src must not allow 'unsafe-eval'`,
    );
  });

  Deno.test(`${page}: locks down default-src, object-src and base-uri`, async () => {
    const html = await Deno.readTextFile(page);
    const csp = parseCsp(extractCsp(html)!);
    assertEquals(
      csp["default-src"],
      ["'self'"],
      `${page}: default-src should be 'self'`,
    );
    assertEquals(
      csp["object-src"],
      ["'none'"],
      `${page}: object-src should be 'none'`,
    );
    assert(
      csp["base-uri"] &&
        (csp["base-uri"].includes("'none'") ||
          csp["base-uri"].includes("'self'")),
      `${page}: base-uri must be locked to 'none' or 'self'`,
    );
  });

  Deno.test(`${page}: policy permits every external CDN origin it loads`, async () => {
    const html = await Deno.readTextFile(page);
    const csp = parseCsp(extractCsp(html)!);
    for (const origin of externalOrigins(html, "script")) {
      assert(
        (csp["script-src"] ?? []).includes(origin),
        `${page}: script-src must allow external script origin ${origin}`,
      );
    }
    for (const origin of externalOrigins(html, "style")) {
      assert(
        (csp["style-src"] ?? []).includes(origin),
        `${page}: style-src must allow external style origin ${origin}`,
      );
    }
  });

  Deno.test(`${page}: contains no inline <script> blocks`, async () => {
    const html = await Deno.readTextFile(page);
    for (const tag of scriptTags(html)) {
      assert(
        /\bsrc\s*=/i.test(tag),
        `${page}: inline <script> blocks violate the strict CSP: ${tag}`,
      );
    }
  });
}

// --- Generated-markup compatibility --------------------------------------

Deno.test("docs/app.js: generated rows use no inline event handlers", async () => {
  // A strict script-src blocks inline on*= handlers, so the row markup the
  // dashboard injects must rely on delegated listeners + data attributes.
  const source = await Deno.readTextFile("docs/app.js");
  const handler = source.match(/\son(?:click|change|error|load|input)\s*=/i);
  assertEquals(
    handler,
    null,
    `docs/app.js must not emit inline event handlers (found ${handler?.[0]})`,
  );
});
