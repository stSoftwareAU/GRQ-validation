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

/** Concatenate a list of byte chunks into one Uint8Array. */
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** zlib-inflate the IDAT stream using the platform DecompressionStream. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const blob = new Blob([data as BlobPart]);
  const stream = blob.stream().pipeThrough(ds);
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return concat(parts);
}

/**
 * Minimal decoder for the 8-bit, non-interlaced, truecolour-with-alpha PNGs
 * that `scripts/generate_icons.sh` emits (colour type 6). Returns the raw RGBA
 * pixel buffer plus dimensions. Throws if the PNG is not in that exact form, so
 * a format regression fails loudly rather than silently passing.
 */
async function decodeRgba(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = bytes[24];
  const colourType = bytes[25];
  const interlace = bytes[28];
  if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error(
      `unsupported PNG form: bitDepth=${bitDepth} colourType=${colourType} interlace=${interlace}`,
    );
  }

  // Collect every IDAT chunk's payload, then inflate the concatenation.
  const idat: Uint8Array[] = [];
  let i = 8;
  while (i < bytes.length) {
    const len = view.getUint32(i, false);
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    if (type === "IDAT") idat.push(bytes.subarray(i + 8, i + 8 + len));
    else if (type === "IEND") break;
    i += 12 + len;
  }
  const raw = await inflate(concat(idat));

  // Reverse the per-row PNG filters into a flat RGBA buffer.
  const channels = 4;
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * channels);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[pos++];
      const a = x >= channels ? rgba[rowStart + x - channels] : 0;
      const b = y > 0 ? rgba[prevStart + x] : 0;
      const c = (y > 0 && x >= channels) ? rgba[prevStart + x - channels] : 0;
      let out = val;
      if (filter === 1) out = val + a;
      else if (filter === 2) out = val + b;
      else if (filter === 3) out = val + ((a + b) >> 1);
      else if (filter === 4) out = val + paeth(a, b, c);
      rgba[rowStart + x] = out & 0xff;
    }
  }
  return { width, height, rgba };
}

/** Alpha value of the pixel at (x, y) in a decoded RGBA buffer. */
function alphaAt(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
): number {
  return rgba[(y * width + x) * 4 + 3];
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

// Issue #419: every icon's background must be transparent (no baked-in #667eea
// square). The four corners sit in the safe-area padding outside the robot, so
// they are the reliable background sample — each must be fully transparent.
Deno.test("pwa icons - corners are fully transparent", async () => {
  for (const size of ICON_SIZES) {
    const bytes = await Deno.readFile(iconPath(size));
    const { width, height, rgba } = await decodeRgba(bytes);
    const corners: Array<[number, number]> = [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ];
    for (const [x, y] of corners) {
      assertEquals(
        alphaAt(rgba, width, x, y),
        0,
        `${iconPath(size)} corner (${x},${y}) should be transparent`,
      );
    }
  }
});

// Guard against the opposite regression — a fully blank/transparent image. The
// robot artwork must still be present, so the centre pixel must be opaque.
Deno.test("pwa icons - robot artwork remains (centre is opaque)", async () => {
  for (const size of ICON_SIZES) {
    const bytes = await Deno.readFile(iconPath(size));
    const { width, height, rgba } = await decodeRgba(bytes);
    const alpha = alphaAt(
      rgba,
      width,
      Math.floor(width / 2),
      Math.floor(height / 2),
    );
    assert(
      alpha > 0,
      `${iconPath(size)} centre should be opaque (found alpha ${alpha})`,
    );
  }
});
