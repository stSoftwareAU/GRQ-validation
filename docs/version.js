// Shared page bootstrap (issue #189).
//
// Derives the app version and document title from <meta> tags instead of an
// inline <script>, so docs/index.html can enforce a strict
// Content-Security-Policy (no 'unsafe-inline' for scripts). Must load in the
// <head>, before the page's other scripts, so globalThis.VERSION is set early.
(function () {
  "use strict";

  const versionMeta = document.querySelector('meta[name="app-version"]');
  const VERSION = versionMeta ? versionMeta.getAttribute("content") || "" : "";
  globalThis.VERSION = VERSION;

  const titleMeta = document.querySelector('meta[name="app-title"]');
  if (titleMeta) {
    document.title = `${titleMeta.getAttribute("content")} v${VERSION}`;
  }

  // Populate the footer version label once the DOM is parsed.
  document.addEventListener("DOMContentLoaded", function () {
    const el = document.getElementById("version");
    if (el) {
      el.textContent = VERSION;
    }
  });
})();
