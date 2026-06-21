// Tests for the PWA Web App Manifest and browserconfig.xml (issue #222).
//
// Part of #218 — converting the GRQ Validation dashboard into an installable
// PWA with GRQ Validation's own branding. These tests guard the manifest's
// JSON shape, the agreed install/splash theme (#667eea), and internal
// consistency between each icon's declared size and its on-disk file.

import { assert, assertEquals } from "@std/assert";

const MANIFEST_PATH = "docs/manifest.json";
const BROWSERCONFIG_PATH = "docs/browserconfig.xml";
const DOCS_DIR = "docs";

/** The agreed install/splash theme colour (matches --primary-color). */
const THEME_COLOR = "#667eea";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface Manifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  lang: string;
  categories: string[];
  background_color: string;
  theme_color: string;
  orientation?: string;
  icons: ManifestIcon[];
  screenshots: { src: string; sizes: string; form_factor: string }[];
}

async function loadManifest(): Promise<Manifest> {
  const text = await Deno.readTextFile(MANIFEST_PATH);
  return JSON.parse(text) as Manifest;
}

Deno.test("manifest - is valid JSON", async () => {
  const manifest = await loadManifest();
  assert(typeof manifest === "object" && manifest !== null);
});

Deno.test("manifest - identity and branding", async () => {
  const manifest = await loadManifest();
  assertEquals(manifest.name, "GRQ Validation Dashboard");
  assertEquals(manifest.short_name, "GRQ Validation");
  assert(
    manifest.description.length > 0,
    "description should be a non-empty summary",
  );
});

Deno.test("manifest - scope and start_url cover the whole dashboard", async () => {
  const manifest = await loadManifest();
  assertEquals(manifest.start_url, "./");
  assertEquals(manifest.scope, "./");
});

Deno.test("manifest - display, lang and categories", async () => {
  const manifest = await loadManifest();
  assertEquals(manifest.display, "standalone");
  assertEquals(manifest.lang, "en");
  assert(
    manifest.categories.includes("finance"),
    "categories should include finance",
  );
});

Deno.test("manifest - install/splash theme is the agreed colour", async () => {
  const manifest = await loadManifest();
  assertEquals(manifest.theme_color, THEME_COLOR);
  assertEquals(manifest.background_color, THEME_COLOR);
});

Deno.test("manifest - orientation is left unset (any orientation)", async () => {
  const manifest = await loadManifest();
  assertEquals(
    manifest.orientation,
    undefined,
    "orientation must be unset so the dashboard works in any orientation",
  );
});

Deno.test("manifest - icon set is complete with correct attributes", async () => {
  const manifest = await loadManifest();
  const expectedSizes = [72, 96, 128, 144, 152, 192, 384, 512];
  assertEquals(
    manifest.icons.map((i) => parseInt(i.sizes, 10)).sort((a, b) => a - b),
    expectedSizes,
  );
  for (const icon of manifest.icons) {
    assertEquals(icon.type, "image/png");
    assertEquals(icon.purpose, "any maskable");
  }
});

Deno.test("manifest - every icon src exists and matches its declared size", async () => {
  const manifest = await loadManifest();
  for (const icon of manifest.icons) {
    // The declared sizes must match the filename, e.g. 144x144 -> icon-144x144.png.
    assertEquals(
      icon.src,
      `icons/icon-${icon.sizes}.png`,
      `${icon.src} should match its declared size ${icon.sizes}`,
    );
    const path = `${DOCS_DIR}/${icon.src}`;
    const stat = await Deno.stat(path);
    assert(stat.isFile && stat.size > 0, `${path} should be a non-empty file`);
  }
});

Deno.test("manifest - screenshots declared for wide and narrow form factors", async () => {
  const manifest = await loadManifest();
  const wide = manifest.screenshots.find((s) => s.form_factor === "wide");
  const narrow = manifest.screenshots.find((s) => s.form_factor === "narrow");
  assert(wide, "a wide (desktop) screenshot must be declared");
  assert(narrow, "a narrow (mobile) screenshot must be declared");
  assertEquals(wide.src, "screenshots/desktop-screenshot.png");
  assertEquals(wide.sizes, "1280x720");
  assertEquals(narrow.src, "screenshots/mobile-screenshot.png");
  assertEquals(narrow.sizes, "720x1280");
});

Deno.test("browserconfig.xml - mirrors FX tiles with GRQ Validation theme", async () => {
  const xml = await Deno.readTextFile(BROWSERCONFIG_PATH);
  assert(xml.includes("<msapplication>"), "should contain <msapplication>");
  assert(
    xml.includes('<square70x70logo src="icons/icon-72x72.png"'),
    "70x70 tile should reference icon-72x72.png",
  );
  assert(
    xml.includes('<square150x150logo src="icons/icon-144x144.png"'),
    "150x150 tile should reference icon-144x144.png",
  );
  assert(
    xml.includes('<square310x310logo src="icons/icon-384x384.png"'),
    "310x310 tile should reference icon-384x384.png",
  );
  assert(
    xml.includes(`<TileColor>${THEME_COLOR}</TileColor>`),
    "TileColor should be the agreed theme colour",
  );
});
