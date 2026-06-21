# PWA: add docs/manifest.json and browserconfig.xml

## Summary

Adds the Web App Manifest and `browserconfig.xml` so the GRQ Validation
dashboard is installable as a PWA with its own branding. Part of #218.
Closes #222.

- **`docs/manifest.json`**
  - `name`: "GRQ Validation Dashboard"; `short_name`: "GRQ Validation".
  - `start_url` and `scope` both `"./"` (covers `index.html` and `list.html`).
  - `display`: `standalone`; `lang`: `en`; `categories`: `["finance"]`.
  - `background_color` and `theme_color`: `#667eea` — the agreed install/splash
    theme, matching `--primary-color` in `docs/styles.css`.
  - `orientation`: **left unset** per the #218 decision (works in any
    orientation; deliberately does not copy FX's `landscape-primary`).
  - Full icon set (72, 96, 128, 144, 152, 192, 384, 512), each
    `image/png`, `purpose: "any maskable"`.
  - Declares the desktop (1280×720, `wide`) and mobile (720×1280, `narrow`)
    screenshots; the PNGs themselves are delivered by the screenshots sub-issue.
- **`docs/browserconfig.xml`** — mirrors FX with a 70×70 / 150×150 / 310×310
  tile set referencing the icons, and a `<TileColor>` of `#667eea`.

### Deno regression avoided

Tests added as native `deno test` cases under `tests/`; no Node tooling
introduced.

## Evidence

Backend/asset change with no new UI to screenshot. Verified via the new
Deno test suite, which parses the real manifest and checks the on-disk
icons:

```
running 10 tests from ./tests/manifest_test.ts
... ok | 10 passed | 0 failed
```

`./quality.sh` passes cleanly.

## Test Plan

Added `tests/manifest_test.ts`:

- Parses `docs/manifest.json` as JSON (valid).
- Asserts `start_url`/`scope` are `"./"`, `display` is `standalone`,
  `theme_color`/`background_color` are `#667eea`, `categories` includes
  `finance`, and `orientation` is unset.
- Asserts the icon set is complete with correct `type`/`purpose`, every
  `icons[].src` resolves to an existing file under `docs/`, and the declared
  `sizes` matches the filename.
- Asserts the wide/narrow screenshots are declared.
- Asserts `docs/browserconfig.xml` contains the expected tiles and the
  `#667eea` `<TileColor>`.
