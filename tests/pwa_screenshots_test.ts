// Tests for the PWA dashboard screenshots (issue #225).
//
// Part of #218 — converting the GRQ Validation dashboard into an installable
// PWA. The manifest's `screenshots` array references a wide (desktop) and a
// narrow (mobile) capture that enable the richer install UI on Android/Chromium.
// These tests guard those assets with no external dependencies: each screenshot
// must exist, be a valid PNG, and have pixel dimensions matching the `sizes`
// declared for it in docs/manifest.json.
//
// PNG structure relied upon (see the PNG spec):
//   - bytes 0..7  : the 8-byte signature \x89PNG\r\n\x1a\n
//   - bytes 8..15 : the IHDR length (4) + chunk type "IHDR" (4)
//   - bytes 16..19: image width  as a big-endian u32
//   - bytes 20..23: image height as a big-endian u32

import { assert, assertEquals } from "@std/assert";

const DOCS_DIR = "docs";
const MANIFEST_PATH = `${DOCS_DIR}/manifest.json`;

/** The 8-byte PNG signature every PNG file must begin with. */
const PNG_MAGIC = Uint8Array.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

interface ManifestScreenshot {
  src: string;
  sizes: string;
  type: string;
  form_factor: string;
  label?: string;
}

interface Manifest {
  screenshots: ManifestScreenshot[];
}

async function loadScreenshots(): Promise<ManifestScreenshot[]> {
  const text = await Deno.readTextFile(MANIFEST_PATH);
  return (JSON.parse(text) as Manifest).screenshots;
}

/** Parse a "WIDTHxHEIGHT" sizes string into numeric width and height. */
function parseSizes(sizes: string): { width: number; height: number } {
  const [width, height] = sizes.split("x").map((n) => parseInt(n, 10));
  return { width, height };
}

/** Read width and height from a PNG's IHDR chunk (big-endian u32 fields). */
function readPngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}

Deno.test("pwa screenshots - every manifest screenshot exists", async () => {
  const screenshots = await loadScreenshots();
  assert(screenshots.length > 0, "manifest must declare screenshots");
  for (const shot of screenshots) {
    const path = `${DOCS_DIR}/${shot.src}`;
    const stat = await Deno.stat(path);
    assert(stat.isFile, `${path} should be a file`);
    assert(stat.size > 0, `${path} should not be empty`);
  }
});

Deno.test("pwa screenshots - each file has the PNG magic bytes", async () => {
  const screenshots = await loadScreenshots();
  for (const shot of screenshots) {
    const path = `${DOCS_DIR}/${shot.src}`;
    const bytes = await Deno.readFile(path);
    assert(bytes.length >= 24, `${path} is too short to be a PNG`);
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      assertEquals(
        bytes[i],
        PNG_MAGIC[i],
        `${path} byte ${i} should match the PNG signature`,
      );
    }
  }
});

Deno.test("pwa screenshots - pixel dimensions match the manifest sizes", async () => {
  const screenshots = await loadScreenshots();
  for (const shot of screenshots) {
    const path = `${DOCS_DIR}/${shot.src}`;
    const expected = parseSizes(shot.sizes);
    const bytes = await Deno.readFile(path);
    const actual = readPngDimensions(bytes);
    assertEquals(
      actual.width,
      expected.width,
      `${path} width should be ${expected.width}`,
    );
    assertEquals(
      actual.height,
      expected.height,
      `${path} height should be ${expected.height}`,
    );
  }
});

Deno.test("pwa screenshots - wide and narrow form factors are present and sized", async () => {
  const screenshots = await loadScreenshots();
  const wide = screenshots.find((s) => s.form_factor === "wide");
  const narrow = screenshots.find((s) => s.form_factor === "narrow");
  assert(wide, "a wide (desktop) screenshot must be declared");
  assert(narrow, "a narrow (mobile) screenshot must be declared");

  const wideDims = readPngDimensions(
    await Deno.readFile(`${DOCS_DIR}/${wide.src}`),
  );
  assertEquals(wideDims.width, 1280, "desktop screenshot width should be 1280");
  assertEquals(wideDims.height, 720, "desktop screenshot height should be 720");
  assert(
    wideDims.width > wideDims.height,
    "wide screenshot should be landscape",
  );

  const narrowDims = readPngDimensions(
    await Deno.readFile(`${DOCS_DIR}/${narrow.src}`),
  );
  assertEquals(narrowDims.width, 720, "mobile screenshot width should be 720");
  assertEquals(
    narrowDims.height,
    1280,
    "mobile screenshot height should be 1280",
  );
  assert(
    narrowDims.height > narrowDims.width,
    "narrow screenshot should be portrait",
  );
});
