// Tests for the pa11y-ci accessibility configuration (issue #281).
//
// The automated a11y gate only ever scanned the aggregate page
// (http://localhost:8080/index.html), so colour-contrast regressions in the
// single-stock detail view and in dark mode slipped through. These tests pin
// the strengthened coverage: pa11yci.json must run WCAG2AA over BOTH the
// aggregate and the single-stock views, in BOTH the light and dark themes.
//
// They parse the REAL config the workflow runs (`npx pa11y-ci --config
// pa11yci.json`), so they fail against the previous single-URL config — the
// failing-first half of the TDD cycle for this fix.
import { assert, assertEquals } from "@std/assert";

const PA11Y_CONFIG_PATH = "pa11yci.json";

interface Pa11yUrlObject {
  url: string;
  actions?: string[];
}
type Pa11yUrl = string | Pa11yUrlObject;

interface Pa11yConfig {
  defaults?: { standard?: string };
  urls?: Pa11yUrl[];
}

async function loadConfig(): Promise<Pa11yConfig> {
  const text = await Deno.readTextFile(PA11Y_CONFIG_PATH);
  return JSON.parse(text) as Pa11yConfig;
}

// Normalise each entry (string or {url}) to its URL string.
function urlOf(entry: Pa11yUrl): string {
  return typeof entry === "string" ? entry : entry.url;
}

// The single-stock detail view is reached either via a `?stock=` deep link or
// by an action that clicks a stock and waits for the detail card. Either way
// the entry must demonstrably target that view.
function exercisesSingleStockView(entry: Pa11yUrl): boolean {
  const url = urlOf(entry);
  if (/[?&]stock=/.test(url)) {
    return true;
  }
  const actions = typeof entry === "string" ? [] : entry.actions ?? [];
  return actions.some((a) => /stockDetailCard|clickable-stock/.test(a));
}

function isDarkTheme(entry: Pa11yUrl): boolean {
  const url = urlOf(entry);
  if (/[?&]theme=dark/.test(url)) {
    return true;
  }
  const actions = typeof entry === "string" ? [] : entry.actions ?? [];
  return actions.some((a) => /dark-mode-forced|theme-toggle/.test(a));
}

Deno.test("pa11yci.json enforces the WCAG2AA standard", async () => {
  const config = await loadConfig();
  assertEquals(
    config.defaults?.standard,
    "WCAG2AA",
    "pa11y-ci must run WCAG 2 AA so the build fails on AA violations",
  );
});

Deno.test("pa11yci.json scans the aggregate index page", async () => {
  const config = await loadConfig();
  const urls = (config.urls ?? []).map(urlOf);
  assert(
    urls.some((u) => /\/index\.html(\?|$)/.test(u)),
    "pa11y-ci must check the aggregate index.html page",
  );
});

Deno.test("pa11yci.json scans the single-stock detail view", async () => {
  const config = await loadConfig();
  assert(
    (config.urls ?? []).some(exercisesSingleStockView),
    "pa11y-ci must also audit the single-stock detail view (issue #281)",
  );
});

Deno.test("pa11yci.json audits both the light and dark themes", async () => {
  const config = await loadConfig();
  const entries = config.urls ?? [];
  assert(
    entries.some((e) => !isDarkTheme(e)),
    "pa11y-ci must audit the default (light) theme",
  );
  assert(
    entries.some(isDarkTheme),
    "pa11y-ci must audit the dark theme (issue #281)",
  );
});

Deno.test("pa11yci.json audits the single-stock view in dark mode", async () => {
  const config = await loadConfig();
  assert(
    (config.urls ?? []).some(
      (e) => exercisesSingleStockView(e) && isDarkTheme(e),
    ),
    "pa11y-ci must audit the single-stock detail view in dark mode, where the " +
      "contrast regressions were worst (issue #281)",
  );
});
