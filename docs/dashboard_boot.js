// Dashboard page bootstrap (issue #189).
//
// Loads app.js with a cache-busting version query. Extracted from an inline
// <script> so docs/index.html can enforce a strict Content-Security-Policy
// without 'unsafe-inline'. Relies on globalThis.VERSION, set earlier by
// version.js.
//
// The responsive device debug readout (Bootstrap breakpoint | Mobile | Width |
// UA) was removed in issue #619 — only the application version line remains.
(function () {
  "use strict";

  const VERSION = globalThis.VERSION || "";

  // Dynamically load app.js with the version parameter.
  const script = document.createElement("script");
  script.src = `app.js?v=${VERSION}`;
  document.head.appendChild(script);
})();
