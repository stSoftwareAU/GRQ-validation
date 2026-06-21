## Summary

Generated the full PWA icon set and favicons in `docs/icons/` from GRQ
Validation's own brand image `docs/logo.png` (the robot-judge logo — **not** the
FX icons). This is the asset foundation that the upcoming manifest,
`browserconfig.xml`, and HTML `<head>` sub-issues of #218 will reference.

Twelve square PNG icons were produced at `docs/icons/icon-<n>x<n>.png` for sizes
`16, 32, 72, 96, 128, 144, 152, 167, 180, 192, 384, 512`. The 16×16 and 32×32
also serve as the favicons linked from `<head>`. Each icon centres the brand on
a solid `#667eea` background with ~10% safe-area padding on every side, so the
artwork still reads well when masked (the manifest declares
`"purpose": "any maskable"`).

Icons were generated locally with macOS `sips` (scale the largest edge to 80% of
the target, then pad onto a `#667eea` square) and committed as binary assets. No
Node tooling was introduced — this stays a Deno/Rust repo.

Closes #221.

## Evidence

512×512 icon generated from `docs/logo.png` — brand centred, safe-area padding,
`#667eea` background:

![GRQ Validation 512x512 PWA icon](docs/icons/icon-512x512.png)

All twelve sizes verified at their declared pixel dimensions by the new test
(reads width/height from each PNG's IHDR chunk):

```
docs/icons/icon-16x16.png   16x16
docs/icons/icon-32x32.png   32x32
docs/icons/icon-72x72.png   72x72
docs/icons/icon-96x96.png   96x96
docs/icons/icon-128x128.png 128x128
docs/icons/icon-144x144.png 144x144
docs/icons/icon-152x152.png 152x152
docs/icons/icon-167x167.png 167x167
docs/icons/icon-180x180.png 180x180
docs/icons/icon-192x192.png 192x192
docs/icons/icon-384x384.png 384x384
docs/icons/icon-512x512.png 512x512
```

## Test Plan

- Added `tests/pwa_icons_test.ts` (runs under `deno test --allow-read tests/*.ts`,
  no external dependencies), which:
  - asserts every expected icon file exists and is non-empty in `docs/icons/`;
  - asserts each begins with the PNG magic bytes `\x89PNG\r\n\x1a\n`;
  - asserts each icon's pixel dimensions match its filename by reading width and
    height from the PNG IHDR chunk (big-endian `u32` at byte offsets 16 and 20).
- Confirmed the test fails before the icons exist and passes after generation
  (3 passed).
- `./quality.sh` passes cleanly (cargo + `deno test`/`fmt`/`lint`/`check`);
  full Deno suite: 342 passed.

### Deno regression avoided

Generated icons with macOS `sips` and asserted PNG validity with a dependency-free
Deno test, rather than reaching for a Node-based icon generator or image library.
