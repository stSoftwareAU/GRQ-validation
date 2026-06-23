// Service worker registration for the GRQ Validation Dashboard (issue #223).
//
// Australian English: an external registration script (not an inline
// <script>) so docs/index.html can keep a strict Content-Security-Policy
// with script-src 'self' and no 'unsafe-inline'.
// Behaviour mirrors the FX dashboard: register ./sw.js, force an update check
// on load, poll registration.update() every 30 seconds, force a reload when a
// new service worker activates, and handle service-worker → page messages.
//
// Keep the ?v= query aligned with the app-version meta in index.html so a new
// version always re-registers a fresh service worker.

(function registerServiceWorker() {
  "use strict";

  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js?v=1.0.210")
      .then((registration) => {
        console.log("SW registered: ", registration);

        // Force an update check on every page load.
        registration.update();

        // Check for updates.
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed") {
              if (navigator.serviceWorker.controller) {
                // New content is available, force an immediate refresh.
                console.log("New version available, forcing refresh...");

                navigator.serviceWorker.controller.postMessage({
                  type: "FORCE_UPDATE",
                });
                window.location.reload();
              } else {
                // First-time installation.
                console.log("Service worker installed for the first time");
              }
            }
          });
        });

        // Listen for messages from the service worker.
        navigator.serviceWorker.addEventListener("message", (event) => {
          if (event.data && event.data.type === "FORCE_RELOAD") {
            console.log("Service worker requested force reload");
            window.location.reload();
          }
          if (event.data && event.data.type === "SW_UPDATED") {
            console.log(
              "Service worker updated to version:",
              event.data.version,
            );
            window.location.reload();
          }
        });

        // Listen for messages from the active service-worker controller.
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.addEventListener(
            "message",
            (event) => {
              if (
                event.data && event.data.type === "SW_UPDATED" &&
                event.data.forceReload
              ) {
                console.log("Force reload requested due to version update");
                window.location.reload();
              }
            },
          );
        }

        // Check for updates every 30 seconds.
        setInterval(() => {
          registration.update();
        }, 30000);
      })
      .catch((registrationError) => {
        console.log("SW registration failed: ", registrationError);
      });
  });

  // PWA install prompt handling omitted for iPhone compatibility.
  // Users can install via Safari's "Add to Home Screen" option.
})();
