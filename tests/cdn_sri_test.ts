// Tests for Subresource Integrity (SRI) on third-party CDN assets (Issue #79).
//
// The published dashboard (docs/index.html) loads
// executable JavaScript and CSS from public CDNs. Without an
// `integrity=` hash the browser cannot verify the bytes it executes, so
// a compromised CDN or upstream package would run arbitrary code in
// every visitor's browser. These tests assert that every external
// `<script>`/`<link>` tag is version-pinned and carries a
// `sha384-` integrity hash plus `crossorigin`.

import { assert } from "@std/assert";

const PAGES = ["docs/index.html"];

interface ResourceTag {
  tag: string; // full opening tag text
  url: string; // external src/href
}

/** Extract every external (http/https) <script>/<link> opening tag. */
function externalResourceTags(html: string): ResourceTag[] {
  const tags: ResourceTag[] = [];
  // Match opening <script ...> / <link ...> tags, allowing newlines
  // inside the tag (the Bootstrap CSS link spans several lines).
  const tagRe = /<(?:script|link)\b[^>]*>/gis;
  for (const match of html.matchAll(tagRe)) {
    const tag = match[0];
    const attr = tag.match(/(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/i);
    if (attr) {
      tags.push({ tag, url: attr[1] });
    }
  }
  return tags;
}

function hasIntegrity(tag: string): boolean {
  return /integrity\s*=\s*"sha384-[A-Za-z0-9+/=]+"/i.test(tag);
}

function hasCrossOrigin(tag: string): boolean {
  return /crossorigin\s*=\s*"(?:anonymous|use-credentials)"/i.test(tag);
}

/**
 * A jsDelivr npm URL is version-pinned when the package spec carries an
 * explicit `@<version>`. Other CDNs (jQuery, DataTables, cdnjs) embed
 * the version directly in the path, so any digit in the path counts as a
 * pin for them.
 */
function isVersionPinned(url: string): boolean {
  if (url.includes("cdn.jsdelivr.net/npm/")) {
    const spec = url.split("cdn.jsdelivr.net/npm/")[1] ?? "";
    // Handle scoped packages (@scope/name@version) and plain names.
    const withoutScope = spec.startsWith("@") ? spec.slice(1) : spec;
    return withoutScope.includes("@");
  }
  return /\d/.test(new URL(url).pathname);
}

for (const page of PAGES) {
  Deno.test(`${page}: every external CDN tag carries an integrity hash`, async () => {
    const html = await Deno.readTextFile(page);
    const resources = externalResourceTags(html);
    assert(resources.length > 0, `${page} should load external CDN assets`);
    for (const { tag, url } of resources) {
      assert(
        hasIntegrity(tag),
        `${page}: missing sha384 integrity on tag for ${url}`,
      );
    }
  });

  Deno.test(`${page}: every external CDN tag sets crossorigin`, async () => {
    const html = await Deno.readTextFile(page);
    for (const { tag, url } of externalResourceTags(html)) {
      assert(
        hasCrossOrigin(tag),
        `${page}: missing crossorigin on tag for ${url}`,
      );
    }
  });

  Deno.test(`${page}: every external CDN dependency is version-pinned`, async () => {
    const html = await Deno.readTextFile(page);
    for (const { url } of externalResourceTags(html)) {
      assert(
        isVersionPinned(url),
        `${page}: CDN URL is not version-pinned: ${url}`,
      );
    }
  });
}
