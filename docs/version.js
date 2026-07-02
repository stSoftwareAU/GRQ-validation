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

  // Augment the static <title> with the version (issue #694). Each page now
  // carries a descriptive static <title> in its <head>, so no-JS/crawler/
  // view-source contexts always see a title. Here we append the version to
  // that base, falling back to the app-title meta if the document has no
  // static title. Never emit a dangling " v" when the version is unknown.
  const titleMeta = document.querySelector('meta[name="app-title"]');
  const metaTitle = titleMeta ? titleMeta.getAttribute("content") || "" : "";
  const baseTitle = document.title || metaTitle;
  if (baseTitle) {
    document.title = VERSION ? `${baseTitle} v${VERSION}` : baseTitle;
  }

  // Populate the footer version label once the DOM is parsed.
  document.addEventListener("DOMContentLoaded", function () {
    const el = document.getElementById("version");
    if (el) {
      el.textContent = VERSION;
    }
  });
})();
