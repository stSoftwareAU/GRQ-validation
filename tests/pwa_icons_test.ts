// Tests for the PWA icon set generated from docs/logo.png (issue #221).
//
// Part of #218 — converting the GRQ Validation dashboard into an installable
// PWA. The manifest, browserconfig.xml, and the HTML <head> all reference the
// icons in docs/icons/. These tests guard that asset foundation with no
// external dependencies: every expected icon must exist, be a valid PNG, and
// have pixel dimensions that match its filename.
//
// PNG structure relied upon (see the PNG spec):
//   - bytes 0..7  : the 8-byte signature \x89PNG\r\n\x1a\n
//   - bytes 8..15 : the IHDR length (4) + chunk type "IHDR" (4)
//   - bytes 16..19: image width  as a big-endian u32
//   - bytes 20..23: image height as a big-endian u32

import { assert, assertEquals } from "@std/assert";

/** Icon edge sizes (pixels) the PWA requires; filenames are icon-<n>x<n>.png. */
const ICON_SIZES = [
  16,
  32,
  72,
  96,
  128,
  144,
  152,
  167,
  180,
  192,
  384,
  512,
] as const;

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

const ICONS_DIR = "docs/icons";

/** Path to the icon file for a given square edge size. */
function iconPath(size: number): string {
  return `${ICONS_DIR}/icon-${size}x${size}.png`;
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

Deno.test("pwa icons - every expected size exists", async () => {
  for (const size of ICON_SIZES) {
    const stat = await Deno.stat(iconPath(size));
    assert(stat.isFile, `${iconPath(size)} should be a file`);
    assert(stat.size > 0, `${iconPath(size)} should not be empty`);
  }
});

Deno.test("pwa icons - each file has the PNG magic bytes", async () => {
  for (const size of ICON_SIZES) {
    const bytes = await Deno.readFile(iconPath(size));
    assert(bytes.length >= 24, `${iconPath(size)} is too short to be a PNG`);
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      assertEquals(
        bytes[i],
        PNG_MAGIC[i],
        `${iconPath(size)} byte ${i} should match the PNG signature`,
      );
    }
  }
});

Deno.test("pwa icons - pixel dimensions match the filename", async () => {
  for (const size of ICON_SIZES) {
    const bytes = await Deno.readFile(iconPath(size));
    const { width, height } = readPngDimensions(bytes);
    assertEquals(width, size, `${iconPath(size)} width should be ${size}`);
    assertEquals(height, size, `${iconPath(size)} height should be ${size}`);
  }
});
