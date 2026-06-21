// Tests for the PWA <head> wiring on the published dashboard pages
// (issue #224).
//
// docs/index.html must carry the meta tags, icons,
// manifest link and service-worker registration that make the dashboard an
// installable Progressive Web App, mirroring stSoftwareAU/GRQ-FX-validation.
// These assertions guard the integration: if a future edit drops the manifest
// link, the theme-colour, the apple-touch icons or the sw-register.js script,
// the dashboard silently stops being installable — so we pin each here.
//
// The CSP must remain intact and unchanged in shape (no new origins were
// needed: sw-register.js / sw.js / manifest / icons are all same-origin or
// data:), so we reuse the extraction helpers from csp_test.ts.

import { assert, assertEquals } from "@std/assert";
import { extractCsp, parseCsp } from "./csp_test.ts";

const PAGES = ["docs/index.html"];

/** Content of a named <meta name="..."> tag, or null if absent. */
function metaContent(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']\\s*/?>`,
    "is",
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

/** True if a <link rel="..."> tag with the given href (and optional sizes) exists. */
function hasLink(
  html: string,
  rel: string,
  attrs: { href?: string; sizes?: string } = {},
): boolean {
  for (const match of html.matchAll(/<link\b[^>]*>/gis)) {
    const tag = match[0];
    if (!new RegExp(`rel=["']${rel}["']`, "i").test(tag)) continue;
    if (
      attrs.href && !new RegExp(`href=["']${attrs.href}["']`, "i").test(tag)
    ) {
      continue;
    }
    if (
      attrs.sizes && !new RegExp(`sizes=["']${attrs.sizes}["']`, "i").test(tag)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/** True if any <script src="..."> loads the given filename (ignoring ?v= query). */
function loadsScript(html: string, file: string): boolean {
  for (const match of html.matchAll(/<script\b[^>]*>/gis)) {
    const src = match[0].match(/src=["']([^"']+)["']/i);
    if (src && src[1].split("?")[0] === file) return true;
  }
  return false;
}

// Meta tags required for installability across Chrome, iOS Safari and Windows.
const REQUIRED_META: Record<string, string> = {
  "application-name": "GRQ Validation",
  "apple-mobile-web-app-capable": "yes",
  "apple-mobile-web-app-status-bar-style": "default",
  "apple-mobile-web-app-title": "GRQ Validation",
  "apple-touch-fullscreen": "yes",
  "mobile-web-app-capable": "yes",
  "format-detection": "telephone=no",
  "msapplication-config": "/browserconfig.xml",
  "msapplication-TileColor": "#667eea",
  "msapplication-tap-highlight": "no",
  "theme-color": "#667eea",
};

for (const page of PAGES) {
  Deno.test(`${page}: theme-color is #667eea`, async () => {
    const html = await Deno.readTextFile(page);
    assertEquals(metaContent(html, "theme-color"), "#667eea");
  });

  Deno.test(`${page}: declares every required PWA meta tag`, async () => {
    const html = await Deno.readTextFile(page);
    for (const [name, value] of Object.entries(REQUIRED_META)) {
      assertEquals(
        metaContent(html, name),
        value,
        `${page}: meta[name="${name}"] should be "${value}"`,
      );
    }
  });

  Deno.test(`${page}: links the web app manifest`, async () => {
    const html = await Deno.readTextFile(page);
    assert(
      hasLink(html, "manifest", { href: "manifest.json" }),
      `${page}: <link rel="manifest" href="manifest.json"> is required`,
    );
  });

  Deno.test(`${page}: ships apple-touch-icon links for 152/167/180`, async () => {
    const html = await Deno.readTextFile(page);
    for (const size of ["152x152", "167x167", "180x180"]) {
      assert(
        hasLink(html, "apple-touch-icon", { sizes: size }),
        `${page}: apple-touch-icon ${size} is required`,
      );
    }
  });

  Deno.test(`${page}: keeps logo.png plus 16/32 favicons`, async () => {
    const html = await Deno.readTextFile(page);
    assert(
      hasLink(html, "icon", { href: "logo.png" }),
      `${page}: logo.png favicon must be kept`,
    );
    assert(
      hasLink(html, "icon", { href: "icons/icon-32x32.png", sizes: "32x32" }),
      `${page}: 32x32 favicon is required`,
    );
    assert(
      hasLink(html, "icon", { href: "icons/icon-16x16.png", sizes: "16x16" }),
      `${page}: 16x16 favicon is required`,
    );
  });

  Deno.test(`${page}: registers the service worker via sw-register.js`, async () => {
    const html = await Deno.readTextFile(page);
    assert(
      loadsScript(html, "sw-register.js"),
      `${page}: must load sw-register.js before </body>`,
    );
  });

  Deno.test(`${page}: CSP meta is still present and unchanged in shape`, async () => {
    const html = await Deno.readTextFile(page);
    const csp = extractCsp(html);
    assert(csp, `${page}: Content-Security-Policy meta tag must remain`);
    const directives = parseCsp(csp);
    // Same-origin assets only — no new origins were introduced for the PWA.
    assertEquals(directives["default-src"], ["'self'"]);
    assert(
      directives["script-src"]?.includes("'self'"),
      `${page}: script-src must still allow 'self' for sw-register.js`,
    );
    assert(
      !directives["script-src"]?.includes("'unsafe-inline'"),
      `${page}: script-src must remain free of 'unsafe-inline'`,
    );
  });
}
