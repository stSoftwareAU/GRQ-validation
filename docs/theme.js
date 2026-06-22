// Theme selector for the dashboard (issue #233).
//
// Adds an Auto/Light/Dark theme toggle to the dashboard header, mirroring the
// GRQ FX Validation dashboard. The user's choice is remembered in
// localStorage; "auto" follows the operating system via
// `prefers-color-scheme`. The forced modes apply `light-mode-forced` /
// `dark-mode-forced` to <body>, which the CSS in styles.css uses to
// override the default light Bootstrap palette.
//
// Like docs/escape.js and docs/projection.js this file is loaded as a classic
// <script> in docs/index.html and is also imported by the
// Deno tests. It uses no module syntax, publishes its helpers on
// `globalThis.GRQTheme`, and guards every DOM access so it is safe to import in
// a non-browser (test) environment.
(function () {
  "use strict";

  // The three states the toggle cycles through, in cycle order.
  const PREFERENCES = ["auto", "light", "dark"];

  // Storage key for the persisted choice.
  const STORAGE_KEY = "grq-theme-preference";

  // Coerce any stored/queried value to a known preference, defaulting to
  // "auto" so corrupt or missing localStorage never breaks the page.
  function normalisePreference(value) {
    return PREFERENCES.includes(value) ? value : "auto";
  }

  // Advance to the next preference in the cycle: auto -> light -> dark -> auto.
  function nextPreference(current) {
    const index = PREFERENCES.indexOf(normalisePreference(current));
    return PREFERENCES[(index + 1) % PREFERENCES.length];
  }

  // Glyph shown on the toggle button for each preference.
  function iconFor(preference) {
    switch (normalisePreference(preference)) {
      case "light":
        return "☀️"; // ☀️
      case "dark":
        return "🌙"; // 🌙
      default:
        return "🌓"; // 🌓 (auto)
    }
  }

  // Tooltip/aria text describing the current mode and the next action.
  function titleFor(preference) {
    switch (normalisePreference(preference)) {
      case "light":
        return "Light mode (click for dark mode)";
      case "dark":
        return "Dark mode (click for auto mode)";
      default:
        return "Auto mode — following system (click for light mode)";
    }
  }

  // Read a transient theme override from a URL query string, e.g.
  // `?theme=dark`. Returns a valid preference ("auto"/"light"/"dark") or null
  // when the param is absent or unrecognised. This lets the dashboard be
  // deep-linked into a specific theme (and lets the automated a11y check audit
  // dark mode deterministically — issue #281) without writing localStorage, so
  // the override applies only to the current page load.
  function preferenceFromSearch(search) {
    try {
      const value = new URLSearchParams(search || "").get("theme");
      return value !== null && PREFERENCES.includes(value) ? value : null;
    } catch (_err) {
      return null;
    }
  }

  // <body> class that forces a mode, or "" for auto (follow the system).
  function bodyClassFor(preference) {
    switch (normalisePreference(preference)) {
      case "light":
        return "light-mode-forced";
      case "dark":
        return "dark-mode-forced";
      default:
        return "";
    }
  }

  // State class applied to the toggle button so the CSS cascade — not inline
  // styles — drives its colours.
  function toggleClassFor(preference) {
    return "theme-toggle-" + normalisePreference(preference);
  }

  // Publish the pure helpers for the dashboard and the tests.
  globalThis.GRQTheme = {
    PREFERENCES,
    STORAGE_KEY,
    normalisePreference,
    nextPreference,
    iconFor,
    titleFor,
    bodyClassFor,
    toggleClassFor,
    preferenceFromSearch,
  };

  // ---------------------------------------------------------------------------
  // DOM wiring. Skipped entirely when there is no document (Deno tests).
  // ---------------------------------------------------------------------------
  if (typeof document === "undefined") {
    return;
  }

  // Read the active preference. A `?theme=` URL override (transient, never
  // persisted) wins so the dashboard can be deep-linked into a theme; otherwise
  // fall back to the persisted choice, tolerating a privacy mode where
  // localStorage throws on access.
  function readPreference() {
    const fromUrl = preferenceFromSearch(
      typeof location !== "undefined" ? location.search : "",
    );
    if (fromUrl) {
      return fromUrl;
    }
    try {
      return normalisePreference(localStorage.getItem(STORAGE_KEY));
    } catch (_err) {
      return "auto";
    }
  }

  // Persist the preference, ignoring storage failures.
  function writePreference(preference) {
    try {
      localStorage.setItem(STORAGE_KEY, normalisePreference(preference));
    } catch (_err) {
      // Ignore — the in-memory state still drives the current page.
    }
  }

  // Apply a preference to the document and the toggle button.
  function applyPreference(button, icon, preference) {
    const pref = normalisePreference(preference);

    document.body.classList.remove("light-mode-forced", "dark-mode-forced");
    const bodyClass = bodyClassFor(pref);
    if (bodyClass) {
      document.body.classList.add(bodyClass);
    }

    button.classList.remove(
      "theme-toggle-auto",
      "theme-toggle-light",
      "theme-toggle-dark",
    );
    button.classList.add(toggleClassFor(pref));

    const title = titleFor(pref);
    button.title = title;
    button.setAttribute("aria-label", title);
    icon.textContent = iconFor(pref);
  }

  function initThemeToggle() {
    const button = document.getElementById("theme-toggle");
    const icon = document.getElementById("theme-toggle-icon");
    if (!button || !icon) {
      return;
    }

    let preference = readPreference();
    applyPreference(button, icon, preference);

    button.addEventListener("click", function () {
      preference = nextPreference(preference);
      applyPreference(button, icon, preference);
      writePreference(preference);
    });

    // Re-apply when the OS theme changes while we are in auto mode so the
    // page tracks the system without a reload.
    const media = globalThis.matchMedia
      ? globalThis.matchMedia("(prefers-color-scheme: dark)")
      : null;
    if (media && typeof media.addEventListener === "function") {
      media.addEventListener("change", function () {
        if (preference === "auto") {
          applyPreference(button, icon, preference);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThemeToggle);
  } else {
    initThemeToggle();
  }
})();
