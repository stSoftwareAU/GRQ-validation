// Service worker precache + version-alignment guards (issue #253).
//
// Australian English: after the list.* pages were retired from the dashboard,
// the PWA service worker must no longer precache them, and must not reference
// list.html in code or comments. The app/cache version is intentionally
// aligned across docs/sw.js, docs/sw-register.js and docs/index.html so that
// bumping it purges stale caches (including any cached list.html).

const sw = await Deno.readTextFile(new URL("../docs/sw.js", import.meta.url));
const swRegister = await Deno.readTextFile(
  new URL("../docs/sw-register.js", import.meta.url),
);
const indexHtml = await Deno.readTextFile(
  new URL("../docs/index.html", import.meta.url),
);

const LIST_ASSETS = [
  "./list.html",
  "./list.js",
  "./list_render.js",
  "./list_stats.js",
  "./list.css",
];

Deno.test("sw.js STATIC_ASSETS no longer precaches any list.* file", () => {
  for (const asset of LIST_ASSETS) {
    if (sw.includes(`"${asset}"`)) {
      throw new Error(
        `Expected sw.js STATIC_ASSETS to drop ${asset}, but it is still listed`,
      );
    }
  }
});

Deno.test("sw.js contains no remaining list.html reference (comments included)", () => {
  if (sw.includes("list.html")) {
    throw new Error("sw.js still references list.html");
  }
});

Deno.test("sw-register.js contains no remaining list.html reference", () => {
  if (swRegister.includes("list.html")) {
    throw new Error("sw-register.js still references list.html");
  }
});

Deno.test("app/cache version is aligned across sw.js, sw-register.js and index.html", () => {
  const appVersion = sw.match(/const APP_VERSION = "([^"]+)";/)?.[1];
  if (!appVersion) {
    throw new Error("Could not find APP_VERSION in sw.js");
  }

  const registerVersion = swRegister.match(/\.\/sw\.js\?v=([0-9.]+)/)?.[1];
  if (registerVersion !== appVersion) {
    throw new Error(
      `sw-register.js registers v=${registerVersion}, expected ${appVersion}`,
    );
  }

  const metaVersion = indexHtml.match(
    /<meta name="app-version" content="([^"]+)">/,
  )?.[1];
  if (metaVersion !== appVersion) {
    throw new Error(
      `index.html app-version meta is ${metaVersion}, expected ${appVersion}`,
    );
  }

  const registerScriptVersion = indexHtml.match(
    /sw-register\.js\?v=([0-9.]+)/,
  )?.[1];
  if (registerScriptVersion !== appVersion) {
    throw new Error(
      `index.html sw-register.js script tag is v=${registerScriptVersion}, expected ${appVersion}`,
    );
  }
});
