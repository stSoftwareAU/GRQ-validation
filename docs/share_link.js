// Footer "Share" deep-link builder (issue #495, part of milestone #484, item 4
// of #484: "a 'share' option which creates a URL with the current options
// selected ... in the footer").
//
// The dashboard has several deep-link params already read on load — ?file /
// ?date (docs/app.js, docs/date_selection.js), ?stock (docs/stock_selection.js),
// ?theme (docs/theme.js) and ?window (docs/chart_window_settings.js). This
// module does the inverse: it captures the user's CURRENT selections and builds
// an absolute, shareable URL, then copies it to the clipboard from a small,
// low-prominence footer control.
//
// Two guarantees matter:
//   1. READ-ONLY. Building/copying a link never writes localStorage — it only
//      reads the live state, so a share never mutates the user's saved choices.
//   2. Pure + testable. The serialisation lives in buildShareQuery /
//      buildShareUrl with no DOM, so the Deno tests drive them headless. The DOM
//      wiring (footer button, clipboard, fallback) is skipped when there is no
//      document, mirroring docs/theme.js.
//
// Like docs/theme.js / docs/chart_window_settings.js this file is loaded as a
// classic <script> in docs/index.html and is also imported by the Deno tests.
// It uses no module syntax and publishes its helpers on globalThis.GRQShare.
(function () {
  "use strict";

  // The forced theme modes worth sharing. "auto" is the default a fresh tab
  // already falls back to, so it is emitted by absence — keeping links clean.
  const SHAREABLE_THEMES = ["light", "dark"];

  // The only two windows the app understands (mirrors GRQChartWindow).
  const ALLOWED_WINDOW_DAYS = [90, 180];

  // The min-star filter thresholds worth sharing: 1..5 (issue #666). 0 ("All")
  // is the default off-state, emitted by absence to keep links clean — mirroring
  // GRQStarFilter.ALLOWED_MIN_STARS minus the 0 default.
  const SHAREABLE_MIN_STARS = [1, 2, 3, 4, 5];

  // Append a param only when `value` is a non-empty string, coercing to string.
  function setIfPresent(params, key, value) {
    if (value === undefined || value === null) {
      return;
    }
    const str = String(value).trim();
    if (str !== "") {
      params.set(key, str);
    }
  }

  // Serialise the current dashboard selections into a query string (no leading
  // "?"). Each param is emitted only when it is set / differs from the default
  // the app would otherwise pick, so a shared link carries just the user's
  // deviations:
  //   - file wins over date (the app resolves ?file= before ?date=);
  //   - theme is emitted only for a forced light/dark mode (auto = absence);
  //   - window is always emitted when valid so the recipient's device default
  //     cannot silently change the window the sharer saw;
  //   - stars is emitted only for a forced 1..5 min-star filter (0 = All =
  //     absence) so a shared link reproduces the sharer's filtered view (#666);
  //   - view / indices / group are emitted only when the caller supplies a
  //     non-empty value (forward-compatible with the #483 view-state params);
  //   - fullscreen emits "1" only when the user is in the mobile pop-out (#482).
  function buildShareQuery(state) {
    const s = state || {};
    const params = new URLSearchParams();

    // Score selection: the exact file path is the precise reproduction; fall
    // back to the friendlier date only when no file is known.
    if (s.file !== undefined && s.file !== null && String(s.file).trim() !== "") {
      setIfPresent(params, "file", s.file);
    } else {
      setIfPresent(params, "date", s.date);
    }

    setIfPresent(params, "stock", s.stock);

    if (typeof s.theme === "string" && SHAREABLE_THEMES.includes(s.theme)) {
      params.set("theme", s.theme);
    }

    const windowNum = typeof s.window === "string" ? Number(s.window) : s.window;
    if (ALLOWED_WINDOW_DAYS.includes(windowNum)) {
      params.set("window", String(windowNum));
    }

    // Min-star filter (issue #666): emit only a forced 1..5 threshold; 0 ("All")
    // is the default and emitted by absence so an unfiltered share stays clean.
    const starsNum = typeof s.stars === "string" ? Number(s.stars) : s.stars;
    if (SHAREABLE_MIN_STARS.includes(starsNum)) {
      params.set("stars", String(starsNum));
    }

    // Optional view-state params (sibling docs issue #483). Emitted verbatim
    // when supplied; the caller is responsible for only passing non-defaults.
    setIfPresent(params, "view", s.view);
    setIfPresent(params, "indices", s.indices);
    setIfPresent(params, "group", s.group);

    if (s.fullscreen) {
      params.set("fullscreen", "1");
    }

    return params.toString();
  }

  // Build an absolute, shareable URL from the current page URL and the live
  // selections. Any existing query string and hash on `pageUrl` are stripped
  // first, so the link is rebuilt cleanly from `state` alone.
  function buildShareUrl(pageUrl, state) {
    const base = String(pageUrl || "").split("#")[0].split("?")[0];
    const query = buildShareQuery(state);
    return query ? base + "?" + query : base;
  }

  // Publish the pure helpers for the dashboard and the tests.
  globalThis.GRQShare = {
    SHAREABLE_THEMES,
    ALLOWED_WINDOW_DAYS,
    SHAREABLE_MIN_STARS,
    buildShareQuery,
    buildShareUrl,
  };

  // ---------------------------------------------------------------------------
  // DOM wiring. Skipped entirely when there is no document (Deno tests).
  // ---------------------------------------------------------------------------
  if (typeof document === "undefined") {
    return;
  }

  // Resolve the page URL to share, preferring the live location.
  function currentPageUrl() {
    if (typeof location !== "undefined" && location) {
      return location.origin + location.pathname;
    }
    return "";
  }

  // Show a brief, polite confirmation (or error) in the live region. Cleared
  // after a short delay so the footer returns to rest.
  function flashStatus(statusEl, message) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
    statusEl.classList.remove("visually-hidden");
    if (statusEl._grqClearTimer) {
      clearTimeout(statusEl._grqClearTimer);
    }
    statusEl._grqClearTimer = setTimeout(function () {
      statusEl.textContent = "";
      statusEl.classList.add("visually-hidden");
    }, 4000);
  }

  // Copy via the async Clipboard API when available. Returns a promise that
  // rejects when the API is missing so the caller can fall back.
  function copyToClipboard(text) {
    if (
      typeof navigator !== "undefined" && navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error("Clipboard API unavailable"));
  }

  // Graceful degradation where the async Clipboard API is unavailable or
  // blocked: reveal a read-only input pre-filled with the link and select its
  // text so the user can copy it manually (Ctrl/Cmd-C).
  function showFallback(fallbackInput, statusEl, url) {
    if (!fallbackInput) {
      flashStatus(statusEl, "Copy this link: " + url);
      return;
    }
    fallbackInput.value = url;
    fallbackInput.classList.remove("visually-hidden");
    fallbackInput.removeAttribute("hidden");
    try {
      fallbackInput.focus();
      fallbackInput.select();
    } catch (_err) {
      // Selection is best-effort; the value is visible regardless.
    }
    flashStatus(statusEl, "Copy the selected link to share this view.");
  }

  // Wire the footer Share button. `getState` returns the live selections object
  // consumed by buildShareUrl; the dashboard supplies it. Pure-read only — this
  // never writes storage.
  function initShareButton(opts) {
    const doc = (opts && opts.document) || document;
    const getState = opts && typeof opts.getState === "function"
      ? opts.getState
      : function () {
        return {};
      };

    const button = doc.getElementById("shareButton");
    if (!button) {
      return;
    }
    const statusEl = doc.getElementById("shareStatus");
    const fallbackInput = doc.getElementById("shareFallback");

    button.addEventListener("click", function () {
      let state = {};
      try {
        state = getState() || {};
      } catch (_err) {
        state = {};
      }
      const url = buildShareUrl(currentPageUrl(), state);

      copyToClipboard(url)
        .then(function () {
          if (fallbackInput) {
            fallbackInput.classList.add("visually-hidden");
            fallbackInput.setAttribute("hidden", "");
          }
          flashStatus(statusEl, "Link copied to clipboard.");
        })
        .catch(function () {
          showFallback(fallbackInput, statusEl, url);
        });
    });
  }

  globalThis.GRQShare.initShareButton = initShareButton;
})();
