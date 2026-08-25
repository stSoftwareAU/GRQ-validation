// Responsive layout and accessibility for the widened stock table (issue #842,
// sub-issue of #835).
//
// #840 took the main table from 15 columns to 21. Six extra columns is not a
// free change: on a phone the table becomes a horizontal-scroll maze, and the
// whole point of the traffic light is that the user can read it without
// zooming or panning.
//
// The chosen approach (stated in the PR): keep ONE table and scroll it
// sideways, but pin the Stock column and the traffic light so they are always
// on screen while the detail columns scroll past, and make that scroll region a
// keyboard-reachable, labelled region so it is not touch-only.
//
// Issue #855 narrowed the aggregate table back to 15 columns by moving the six
// pick-detail columns to the single-stock view. The scroller, the pinned pair
// and the "nothing is hidden on a phone" rule all still apply — they now cover
// BOTH tables, including the `.stock-detail-view` rules that used to be exempt
// because that view hid its table outright.
//
// These assertions parse the REAL committed markup and stylesheet and call the
// REAL shipped render helper, so a regression in either fails here:
//   - the scroll region keeps `tabindex`, `role` and an accessible name;
//   - no stock-table column is hidden at a narrow viewport (a `display: none`
//     column is an unreachable cell, not a responsive layout);
//   - the Stock and Pick columns are pinned inside the phone media query;
//   - the traffic-light column reserves a consistent width and renders the
//     emoji large enough to tell 🔴 from 🟠 without zooming;
//   - the pinned cells paint an opaque, theme-aware background whose text
//     clears WCAG 2 AA in BOTH themes (a transparent pinned cell would show the
//     scrolling columns through it);
//   - the six pick-detail headers declare `scope="col"` in the single header
//     row that renders them.

import { assert, assertStringIncludes } from "@std/assert";
import "../docs/escape.js";
import "../docs/volume_recommend.js";
import "../docs/pick_details.js";
import "../docs/pick_working.js";
import "../docs/pick_columns.js";
import "../docs/series_label_colour.js";

const INDEX_HTML = await Deno.readTextFile("docs/index.html");
const STYLES_CSS = await Deno.readTextFile("docs/styles.css");

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const g = globalThis as unknown as {
  GRQPickColumns: {
    PICK_COLUMN_LABELS: string[];
    pickDetailHeaderRow: () => string;
    trafficLightCell: (values: unknown, stock: string) => string;
  };
  GRQSeriesLabelColour: {
    AA_CONTRAST: number;
    parseRgb: (colour: unknown) => (Rgb & { a: number }) | null;
    contrastRatio: (a: Rgb, b: Rgb) => number;
  };
};

/** The attributes of the `<div class="table-responsive">` that wraps
 *  #stockTable, as a single string (`class="..." tabindex="0" ...`). */
function scrollRegionAttributes(): string {
  const table = INDEX_HTML.indexOf('id="stockTable"');
  assert(table !== -1, "could not find #stockTable in index.html");
  const open = INDEX_HTML.lastIndexOf("<div", table);
  assert(open !== -1, "could not find the wrapper <div> before #stockTable");
  const close = INDEX_HTML.indexOf(">", open);
  const attrs = INDEX_HTML.slice(open + "<div".length, close);
  assertStringIncludes(
    attrs,
    "table-responsive",
    "the element wrapping #stockTable should be the .table-responsive scroller",
  );
  return attrs;
}

/** The value of `attribute` within a run of tag attributes, or null. */
function attributeValue(attrs: string, attribute: string): string | null {
  const match = attrs.match(
    new RegExp(`\\b${attribute}\\s*=\\s*"([^"]*)"`, "s"),
  );
  return match === null ? null : match[1].trim();
}

/** Every `selector { declarations }` rule in `css`, in source order. Nested
 *  at-rule bodies are walked too, so a rule inside `@media` is returned with
 *  the media condition that guards it. */
interface CssRule {
  selector: string;
  body: string;
  media: string;
}

function cssRules(css: string, media = ""): CssRule[] {
  const rules: CssRule[] = [];
  // Strip comments so a selector-like fragment in prose is never parsed.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  let preludeStart = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "{") {
      const prelude = text.slice(preludeStart, i).trim();
      // Find the matching close brace.
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const body = text.slice(i + 1, j - 1);
      if (prelude.startsWith("@")) {
        const condition = prelude.startsWith("@media")
          ? [media, prelude].filter((part) => part !== "").join(" and ")
          : media;
        rules.push(...cssRules(body, condition));
      } else if (prelude !== "") {
        rules.push({ selector: prelude, body, media });
      }
      i = j;
      preludeStart = i;
      continue;
    }
    if (char === ";" || char === "}") {
      preludeStart = i + 1;
    }
    i++;
  }
  return rules;
}

const RULES = cssRules(STYLES_CSS);

/** The value of `property` in a rule body, `!important` stripped, or null. */
function declaration(body: string, property: string): string | null {
  const match = body.match(
    new RegExp(`(?:^|[;{\\s])${property}\\s*:([^;]*)`, "i"),
  );
  return match === null ? null : match[1].replace(/!important/i, "").trim();
}

/** Rules whose selector matches `predicate`, optionally restricted to rules
 *  guarded by a phone-width media query. */
function rulesMatching(
  predicate: (selector: string) => boolean,
  options: { phoneOnly?: boolean } = {},
): CssRule[] {
  return RULES.filter((rule) => {
    if (!predicate(rule.selector)) return false;
    if (!options.phoneOnly) return true;
    const match = rule.media.match(/max-width:\s*(\d+)px/);
    return match !== null && Number(match[1]) >= 375;
  });
}

/** A CSS length in rem/px converted to px (16px per rem), or null. */
function lengthPx(value: string | null): number | null {
  if (value === null) return null;
  const match = value.trim().match(/^([\d.]+)(rem|em|px)$/);
  if (match === null) return null;
  const size = Number(match[1]);
  if (!Number.isFinite(size)) return null;
  return match[2] === "px" ? size : size * 16;
}

/** The declared value of a custom property, taken from the last rule matching
 *  `selector` that declares it (later declarations win in the cascade). */
function customProperty(selector: string, property: string): string {
  const values = RULES
    .filter((rule) => rule.selector.includes(selector))
    .map((rule) => declaration(rule.body, property))
    .filter((value): value is string => value !== null);
  assert(
    values.length > 0,
    `no rule matching ${selector} declares ${property}`,
  );
  return values[values.length - 1];
}

/** Resolve `var(--name, fallback)` (or a literal colour) to an rgb triple. The
 *  fallback is what the LIGHT theme paints, because the dark palette is the
 *  only place the custom properties are defined. */
function resolveColour(
  value: string,
  theme: "light" | "dark",
): Rgb {
  const trimmed = value.trim();
  const varMatch = trimmed.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/);
  if (varMatch === null) {
    const rgb = g.GRQSeriesLabelColour.parseRgb(trimmed);
    assert(rgb !== null, `could not parse colour "${trimmed}"`);
    return rgb;
  }
  const [, name, fallback] = varMatch;
  if (theme === "dark") {
    return resolveColour(customProperty(".dark-mode-forced", name), theme);
  }
  assert(
    fallback !== undefined,
    `${name} has no light-theme fallback — the light theme would be unstyled`,
  );
  return resolveColour(fallback, theme);
}

Deno.test("the stock-table scroll region is keyboard-reachable and labelled", () => {
  const attrs = scrollRegionAttributes();
  // A region that only responds to touch/drag is unusable by keyboard: the
  // scroller must take focus so arrow keys can pan it.
  assert(
    attributeValue(attrs, "tabindex") === "0",
    `the #stockTable scroller must carry tabindex="0" — attrs were:${attrs}`,
  );
  assert(
    attributeValue(attrs, "role") === "region",
    `the #stockTable scroller must carry role="region" — attrs were:${attrs}`,
  );
  const label = attributeValue(attrs, "aria-label") ??
    attributeValue(attrs, "aria-labelledby");
  assert(
    label !== null && label !== "",
    "a focusable region needs an accessible name (aria-label/aria-labelledby)",
  );
});

Deno.test("the focused scroll region shows a visible focus indicator", () => {
  const focus = rulesMatching((selector) =>
    selector.includes("table-responsive") && selector.includes("focus")
  );
  assert(
    focus.length > 0,
    "the focusable scroll region needs a :focus-visible outline",
  );
  assert(
    focus.some((rule) =>
      declaration(rule.body, "outline") !== null ||
      declaration(rule.body, "box-shadow") !== null
    ),
    "the scroll region's focus rule must paint an outline or box-shadow",
  );
});

Deno.test("no table column is hidden at a narrow viewport", () => {
  // Hiding a column with `display: none` does not make a wide table
  // responsive — it makes those cells unreachable, on the one device where the
  // user cannot fall back to a wider window.
  //
  // `.stock-detail-view` rules are covered too since issue #855: that view no
  // longer hides the table behind #stockDetailCard — it renders the seven
  // pick-detail columns, so a `display: none` there hides a real figure.
  const hidden = rulesMatching(
    (selector) => /(?:th|td):nth-child/.test(selector),
    { phoneOnly: true },
  ).filter((rule) => declaration(rule.body, "display") === "none");
  assert(
    hidden.length === 0,
    `no column may be hidden on a phone — found: ${
      hidden.map((rule) => rule.selector).join(", ")
    }`,
  );
});

Deno.test("the Stock column and the traffic light are pinned on a phone", () => {
  const pinned = rulesMatching(
    (selector) => selector.includes("#stockTable"),
    { phoneOnly: true },
  ).filter((rule) => declaration(rule.body, "position") === "sticky");

  const stock = pinned.find((rule) => rule.selector.includes(":first-child"));
  assert(
    stock !== undefined,
    "the Stock column (#stockTable th/td:first-child) must be sticky on a phone",
  );
  assert(
    declaration(stock.body, "left") === "0",
    "the pinned Stock column must sit at the left edge of the scroller",
  );

  const pick = pinned.find((rule) => rule.selector.includes("pick-light"));
  assert(
    pick !== undefined,
    "the traffic-light column (.pick-light) must be sticky on a phone",
  );
  const left = declaration(pick.body, "left");
  assert(
    left !== null && left !== "0",
    "the pinned traffic light must be offset by the Stock column's width",
  );
  // The offset only lands on the Stock column's right edge if that column has a
  // width the layout cannot renegotiate.
  const width = rulesMatching(
    (selector) =>
      selector.includes("#stockTable") && selector.includes(":first-child"),
    { phoneOnly: true },
  ).map((rule) => declaration(rule.body, "max-width")).find((value) =>
    value !== null
  );
  assert(
    width !== undefined && width === left,
    `the Stock column's max-width (${width}) must equal the traffic light's left offset (${left})`,
  );
});

Deno.test("the pinned cells paint an opaque, theme-aware background", () => {
  const pinned = rulesMatching(
    (selector) => selector.includes("#stockTable"),
    { phoneOnly: true },
  ).filter((rule) => declaration(rule.body, "position") === "sticky");
  assert(pinned.length >= 2, "expected the pinned Stock and Pick rules");

  for (const rule of pinned) {
    const background = declaration(rule.body, "background") ??
      declaration(rule.body, "background-color");
    assert(
      background !== null,
      `${rule.selector} is pinned but paints no background — the scrolling ` +
        "columns would show through it",
    );
    for (const theme of ["light", "dark"] as const) {
      const bg = resolveColour(background, theme);
      const colour = declaration(rule.body, "color");
      // The pinned cells inherit the table's text colour unless they set one.
      const text = resolveColour(
        colour ?? "var(--grq-text, #212529)",
        theme,
      );
      const ratio = g.GRQSeriesLabelColour.contrastRatio(text, bg);
      assert(
        ratio >= g.GRQSeriesLabelColour.AA_CONTRAST,
        `${rule.selector} in the ${theme} theme has contrast ${
          ratio.toFixed(2)
        }:1, below WCAG 2 AA`,
      );
    }
  }
});

Deno.test("the traffic light reserves a consistent width and a readable emoji", () => {
  // The cell's styling may be split across rules (column geometry on the shared
  // selector, emoji size on the cells only), so read the declarations that
  // reach a `<td class="pick-light">` at desktop width as one bundle.
  const bundle = RULES
    .filter((rule) =>
      rule.media === "" && /\.pick-light\b/.test(rule.selector) &&
      !/\bth\.pick-light/.test(rule.selector)
    )
    .map((rule) => rule.body)
    .join(";");
  assert(bundle !== "", "no .pick-light rule found in docs/styles.css");
  // A ragged column cannot be scanned down; nowrap plus a floor width keeps the
  // lights in a vertical strip whatever warnings trail them.
  assert(
    declaration(bundle, "white-space") === "nowrap",
    "the traffic-light cell must not wrap",
  );
  const minWidth = lengthPx(declaration(bundle, "min-width"));
  assert(
    minWidth !== null && minWidth >= 40,
    `the traffic-light column needs a floor width so the lights line up (got ${minWidth}px)`,
  );
  // 🔴 and 🟠 differ only in hue; at body-text size on a phone they are hard to
  // tell apart, so the glyph is drawn larger than the surrounding text.
  const fontSize = lengthPx(declaration(bundle, "font-size"));
  assert(
    fontSize !== null && fontSize >= 16,
    `the traffic-light emoji must render at >= 1rem (got ${fontSize}px)`,
  );
});

Deno.test("the single-stock header row declares scope=col on every pick column", () => {
  // Since issue #855 the pick columns have exactly ONE header row, built by the
  // shipped helper for the single-stock view, so this reads the real render
  // output rather than two copies of the markup.
  const { PICK_COLUMN_LABELS, pickDetailHeaderRow } = g.GRQPickColumns;
  const html = pickDetailHeaderRow();
  for (const label of PICK_COLUMN_LABELS) {
    const cell = html.split(/<th[\s>]/).find((chunk) =>
      chunk.includes(`>${label}</th>`)
    );
    assert(cell !== undefined, `no <th> for ${label}`);
    assert(
      /\bscope\s*=\s*"col"/.test(cell.slice(0, cell.indexOf(">"))),
      `the ${label} header lacks scope="col"`,
    );
  }
});

Deno.test("the Pick header is tagged so it can be pinned beside Stock", () => {
  // The traffic light is the SECOND column of the single-stock header row, but
  // the aggregate and basic views have no Pick column at all — so the pinned
  // rule keys off a class, never a position.
  const cells = g.GRQPickColumns.pickDetailHeaderRow()
    .split(/<th[\s>]/)
    .filter((chunk) => chunk.includes(">Pick</th>"));
  assert(cells.length === 1, "expected exactly one Pick header");
  assertStringIncludes(
    cells[0].slice(0, cells[0].indexOf(">")),
    "pick-light",
    "the Pick header must carry the pick-light class so the pinned-column " +
      "rule covers the header as well as the cells",
  );
});

Deno.test("the traffic-light cell keeps its class and its text equivalent", () => {
  // The pinned-column rule and the "never colour alone" requirement both hang
  // off the rendered cell, so assert the real render output rather than the
  // markup templates.
  const html = g.GRQPickColumns.trafficLightCell(
    {
      trafficLight: {
        light: "🔴",
        warnings: [{ emoji: "💧", text: "Thin liquidity" }],
        majorWarn: true,
        minorWarn: false,
        known: true,
      },
    },
    "NASDAQ:MGRC",
  );
  assertStringIncludes(html, 'class="pick-light');
  assertStringIncludes(html, 'class="visually-hidden"');
  // The wording, not the glyph, carries the meaning.
  const visible = html.replace(/<[^>]*>/g, "");
  assert(
    /[A-Za-z]/.test(visible),
    "the traffic-light cell must ship text alongside the emoji",
  );
});
