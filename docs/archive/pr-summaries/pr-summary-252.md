# Delete the orphaned `list.html` page, its assets, and build-breaking references

## Summary

The **View All Score Files** button is already gone from `docs/index.html`,
leaving `docs/list.html` ("Score Files List") orphaned with no in-app link. This
PR removes the page and the assets only it used, and updates every test and the
required `pa11y` CI gate that hard-referenced these files so the build stays
green. Closes #252.

Part of #241.

### Deleted page and assets
- `docs/list.html`
- `docs/list.js`
- `docs/list.css`
- `docs/list_render.js` — score-filename render helper, loaded only by `list.html`
- `docs/list_stats.js` — `GRQListStats.computeListAverages` kernel, used only by `list.js`

### Deleted tests that imported the removed modules
- `tests/list_render_test.ts` (`import "../docs/list_render.js"`)
- `tests/annualized_performance_test.ts` (`import "../docs/list_stats.js"`)

### Updated tests that enumerated `list.html`
- `tests/cdn_sri_test.ts` — dropped `"docs/list.html"` from `PAGES`
- `tests/pwa_meta_test.ts` — dropped `"docs/list.html"` from `PAGES`
- `tests/csp_test.ts` — dropped `"docs/list.html"` from `PAGES`
- `tests/a11y_workflow_test.ts` — removed the `list.html` pa11y assertion

### Updated the CI accessibility gate
- `pa11yci.json` — removed `http://localhost:8080/list.html`, leaving `index.html`
- `.github/workflows/a11y.yml` — fixed the header comment listing shipped files

### Tidied stale comment references in remaining files
- `docs/version.js`, `docs/theme.js` — removed `list.html` / `list.css` mentions
- `docs/sw-register.js` — removed the stale `list.html` mention (same intent as
  the version/theme tidy)

## Scope notes

- `docs/sw.js` precache entries for the list files are **out of scope** —
  handled in the service-worker sub-issue of #241. The precache adds each asset
  in its own `try/catch`, so the now-missing files are skipped, not fatal.
- `tests/dashboard_controls_test.ts` **intentionally keeps** its `list.html`
  references: it asserts the link is *absent* from `docs/index.html`, so it is a
  valid regression test and must not be removed. This is the only live
  `list.html` reference outside `docs/sw.js` and `docs/archive/`.
- `docs/archive/*.md` historical PR records were left untouched.

## Evidence

This is a deletion / build-hygiene change with no new web interface to
screenshot. Verified via the test suite and the repo's Deno quality gates:

- `deno test --allow-read tests/*.ts` → **427 passed, 0 failed**
- `deno fmt` (docs/tests/helpers) → no changes
- `deno lint helpers/*.ts tests/*.ts` → clean (66 files)
- `deno check helpers/*.ts tests/*.ts` → clean

Reference grep after the change — only the expected survivors remain:

```
$ grep -rn "list\.html|list\.js|list\.css|list_render|list_stats" \
    docs/ tests/ .github/ pa11yci.json | grep -v docs/archive/
docs/sw.js: ...                          # service-worker sub-issue (out of scope)
tests/dashboard_controls_test.ts: ...    # asserts the link is absent (kept)
```

## Test Plan

- Removed obsolete tests `tests/list_render_test.ts` and
  `tests/annualized_performance_test.ts` (they imported deleted modules).
- Updated `tests/cdn_sri_test.ts`, `tests/pwa_meta_test.ts`, `tests/csp_test.ts`
  and `tests/a11y_workflow_test.ts` so they no longer load the deleted
  `docs/list.html`.
- Ran the full Deno test suite: 427 tests pass.
- `tests/dashboard_controls_test.ts` continues to pass, confirming no
  `list.html` link remains in `docs/index.html`.
