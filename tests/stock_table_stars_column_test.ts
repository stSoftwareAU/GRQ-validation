// The Stars column on a narrow screen (issue #858).
//
// The Stars cell is a leading freshness icon plus up to five moon glyphs — one
// indivisible run. On a phone the cell wrapped that run into a vertical stack,
// which stretched every row of the stock table to several lines tall.
//
// The resolution: the glyphs NEVER wrap, and below the repository's mobile
// breakpoint (`max-width: 767.98px`) the whole Stars column — header and cells
// — is hidden rather than clipped or shrunk. Nothing is lost: the full rating,
// freshness icon included, still renders in the stock detail view (issue #383).
//
// These assertions parse the REAL committed stylesheet and markup, so a
// regression in either fails here:
//   - a `white-space: nowrap` rule reaches the Stars cell at every width;
//   - the Stars column is hidden below 767.98px, header AND cells;
//   - the Stars `<th>` in both header layouts that render it carries the
//     `stars-column` marker class, and keeps its `scope="col"`;
//   - the Stars `<td>` carries the same class at the SAME column index as its
//     header, so the header and the cells can never be hidden apart;
//   - the totals row's Stars placeholder goes with them, so the portfolio
//     totals cannot shift a column left when the rating is hidden.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const STYLES_CSS = await Deno.readTextFile("docs/styles.css");
const INDEX_HTML = await Deno.readTextFile("docs/index.html");
const APP_JS = await Deno.readTextFile("docs/app.js");

/** The marker class the stylesheet keys the Stars column off. */
const STARS_CLASS = "stars-column";

/** The repository's mobile breakpoint, shared with the rest of styles.css. */
const PHONE_BREAKPOINT = 767.98;

interface CssRule {
  selector: string;
  body: string;
  media: string;
}

/** Every `selector { declarations }` rule in `css`, in source order, with the
 *  media condition (if any) that guards it. */
function cssRules(css: string, media = ""): CssRule[] {
  const rules: CssRule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  let preludeStart = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "{") {
      const prelude = text.slice(preludeStart, i).trim();
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
    if (char === ";" || char === "}") preludeStart = i + 1;
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

/** The `max-width` in px that guards a rule, or null when it is unguarded. */
function maxWidthPx(media: string): number | null {
  const match = media.match(/max-width:\s*([\d.]+)px/);
  return match === null ? null : Number(match[1]);
}

interface Cell {
  tag: "th" | "td";
  classes: string[];
}

/** Whether one comma-free selector reaches `cell` inside the stock table. The
 *  ancestor part must name the stock table (or nothing at all), and the final
 *  compound must match the cell's tag and carry all of its classes. */
function selectorReaches(selector: string, cell: Cell): boolean {
  const parts = selector.trim().split(/\s*(?:>|\s)\s*/).filter((p) => p !== "");
  const last = parts[parts.length - 1];
  const ancestors = parts.slice(0, -1);
  const scoped = ancestors.every((part) =>
    /^(#stockTable|\.stock-table|\.table-responsive|thead|tbody|tr)$/.test(part)
  );
  if (!scoped) return false;
  const tag = last.match(/^[a-z]+/);
  if (tag !== null && tag[0] !== cell.tag) return false;
  const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  if (classes.length === 0) return false;
  return classes.every((name) => cell.classes.includes(name));
}

/** Rules whose selector list reaches `cell`. */
function rulesReaching(cell: Cell): CssRule[] {
  return RULES.filter((rule) =>
    rule.selector.split(",").some((one) => selectorReaches(one, cell))
  );
}

const STARS_TH: Cell = { tag: "th", classes: [STARS_CLASS] };
const STARS_TD: Cell = { tag: "td", classes: [STARS_CLASS] };

/** Split a run of markup into its top-level `<th>`/`<td>` cells. Cells are
 *  never nested in this markup, so each open tag begins exactly one cell. */
function cells(html: string, tag: "th" | "td"): string[] {
  return html.split(new RegExp(`<${tag}[\\s>]`)).slice(1);
}

/** The attribute run of a cell chunk produced by `cells()`. */
function cellAttributes(cell: string): string {
  return cell.slice(0, cell.indexOf(">"));
}

/** The static `<thead>` row committed in docs/index.html. */
function staticHeaderRow(): string {
  const table = INDEX_HTML.indexOf('id="stockTable"');
  assert(table !== -1, "could not find #stockTable in index.html");
  const start = INDEX_HTML.indexOf("<thead", table);
  const end = INDEX_HTML.indexOf("</thead>", start);
  assert(start !== -1 && end !== -1, "could not find the static <thead>");
  return INDEX_HTML.slice(start, end);
}

/** The body of the template literal that opens at `start` (the index just past
 *  its backtick), and the index just past its closing backtick. `${…}`
 *  expressions — including nested template literals, as the Stars cell itself
 *  contains — are walked rather than mistaken for the end of the template. */
function scanTemplate(
  src: string,
  start: number,
): { body: string; end: number } {
  const stack: string[] = ["template"];
  let i = start;
  while (i < src.length && stack.length > 0) {
    const char = src[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (stack[stack.length - 1] === "template") {
      if (char === "`") stack.pop();
      else if (char === "$" && src[i + 1] === "{") {
        stack.push("expr");
        i++;
      }
      i++;
      continue;
    }
    // Inside a `${…}` expression.
    if (char === "}") stack.pop();
    else if (char === "{") stack.push("expr");
    else if (char === "`") stack.push("template");
    else if (char === '"' || char === "'") {
      i++;
      while (i < src.length && src[i] !== char) {
        if (src[i] === "\\") i++;
        i++;
      }
    }
    i++;
  }
  assert(stack.length === 0, "unterminated template literal in docs/app.js");
  return { body: src.slice(start, i - 1), end: i };
}

/** A template literal assigned in app.js whose body contains every `must`
 *  fragment — used to pull out the runtime header and row templates. */
function template(assignment: string, must: string[]): string {
  const marker = `${assignment} = \``;
  let from = 0;
  while (true) {
    const start = APP_JS.indexOf(marker, from);
    assert(
      start !== -1,
      `could not find a ${assignment} template containing ${must.join(", ")}`,
    );
    const { body, end } = scanTemplate(APP_JS, start + marker.length);
    if (must.every((fragment) => body.includes(fragment))) return body;
    from = end;
  }
}

/** The aggregate-view header rebuilt at runtime by docs/app.js. */
function aggregateHeaderRow(): string {
  return template("thead.innerHTML", [
    "Buy Price",
    "Stars",
    "Gain/Loss",
    "Dividends",
  ]);
}

/** The aggregate-view body row rendered for each stock by docs/app.js. */
function aggregateBodyRow(): string {
  return template("row.innerHTML", [
    "clickable-stock",
    'data-field="stars"',
    'data-field="gain-loss"',
  ]);
}

/** The aggregate-view totals row rendered by docs/app.js. */
function aggregateTotalsRow(): string {
  return template("totalsRow.innerHTML", ["Days Elapsed"]);
}

Deno.test("the Stars cell never wraps its glyphs", () => {
  // The freshness icon and the moons are one run: a wrap turns the cell into a
  // vertical stack and the row into a several-line block.
  const nowrap = rulesReaching(STARS_TD).filter((rule) =>
    declaration(rule.body, "white-space") === "nowrap"
  );
  assert(
    nowrap.length > 0,
    `no rule gives the Stars cell white-space: nowrap — the glyphs would wrap`,
  );
  assert(
    nowrap.some((rule) => maxWidthPx(rule.media) === null),
    "the nowrap rule must apply at every width, not only inside a media query",
  );
});

Deno.test("the Stars column is hidden below the phone breakpoint", () => {
  for (const cell of [STARS_TH, STARS_TD]) {
    const hidden = rulesReaching(cell).filter((rule) =>
      declaration(rule.body, "display") === "none"
    );
    assert(
      hidden.length > 0,
      `nothing hides the Stars <${cell.tag}> — it would still wrap on a phone`,
    );
    const breakpoints = hidden.map((rule) => maxWidthPx(rule.media));
    assert(
      breakpoints.every((width) => width !== null),
      `the Stars <${cell.tag}> is hidden unconditionally — it must stay ` +
        "visible on a wide screen",
    );
    assert(
      breakpoints.includes(PHONE_BREAKPOINT),
      `the Stars <${cell.tag}> must be hidden at max-width: ${PHONE_BREAKPOINT}px ` +
        `— found ${breakpoints.join(", ")}`,
    );
  }
});

Deno.test("no rule hides the Stars column on a wide screen", () => {
  const wide = rulesReaching(STARS_TD)
    .filter((rule) => {
      const width = maxWidthPx(rule.media);
      return width === null || width > PHONE_BREAKPOINT;
    })
    .filter((rule) => declaration(rule.body, "display") === "none");
  assertEquals(
    wide.map((rule) => rule.selector),
    [],
    "the Stars column must remain visible above the phone breakpoint",
  );
});

Deno.test("the static Stars header carries the marker class and scope", () => {
  const header = cells(staticHeaderRow(), "th").find((cell) =>
    cell.includes(">Stars</th>")
  );
  assert(header !== undefined, "index.html has no Stars <th>");
  const attrs = cellAttributes(header);
  assertStringIncludes(
    attrs,
    STARS_CLASS,
    `the static Stars header must carry class="${STARS_CLASS}"`,
  );
  assertStringIncludes(
    attrs,
    'scope="col"',
    'the Stars header must keep scope="col" for screen readers',
  );
});

Deno.test("the header and the cell hide together in the aggregate view", () => {
  // Header and body are separate templates: if only one carried the marker the
  // phone rule would hide a header without its cells (or the reverse) and every
  // column to the right would shift by one.
  const headerCells = cells(aggregateHeaderRow(), "th");
  const headerIndex = headerCells.findIndex((cell) =>
    cell.includes(">Stars</th>")
  );
  assert(headerIndex !== -1, "the aggregate header has no Stars <th>");
  assertStringIncludes(
    cellAttributes(headerCells[headerIndex]),
    STARS_CLASS,
    `the aggregate Stars header must carry class="${STARS_CLASS}"`,
  );

  const bodyCells = cells(aggregateBodyRow(), "td");
  const bodyIndex = bodyCells.findIndex((cell) =>
    cell.includes('data-field="stars"')
  );
  assert(bodyIndex !== -1, "the aggregate row has no Stars <td>");
  assertStringIncludes(
    cellAttributes(bodyCells[bodyIndex]),
    STARS_CLASS,
    `the aggregate Stars cell must carry class="${STARS_CLASS}"`,
  );
  assertEquals(
    bodyIndex,
    headerIndex,
    "the Stars cell must sit at the same column index as its header",
  );
});

Deno.test("the totals row drops its Stars cell with the column", () => {
  // The totals row is a THIRD template. If its Stars placeholder stayed put
  // while the header and the cells went, the row would be one cell wider than
  // the visible header and every portfolio total would shift a column left.
  const headerIndex = cells(aggregateHeaderRow(), "th").findIndex((cell) =>
    cell.includes(">Stars</th>")
  );
  assert(headerIndex !== -1, "the aggregate header has no Stars <th>");

  const totalsCells = cells(aggregateTotalsRow(), "td");
  assertEquals(
    totalsCells.length,
    cells(aggregateHeaderRow(), "th").length,
    "the totals row must carry one cell per header",
  );
  assertStringIncludes(
    cellAttributes(totalsCells[headerIndex]),
    STARS_CLASS,
    `the totals cell under Stars must carry class="${STARS_CLASS}" so it is ` +
      "hidden with the column",
  );
  const marked = totalsCells.filter((cell) =>
    cellAttributes(cell).includes(STARS_CLASS)
  );
  assertEquals(
    marked.length,
    1,
    "exactly one totals cell belongs to the Stars column",
  );
});

Deno.test("selectorReaches: matches the cell it is written for", () => {
  assert(selectorReaches(`#stockTable td.${STARS_CLASS}`, STARS_TD));
  assert(selectorReaches(`.stock-table .${STARS_CLASS}`, STARS_TH));
  assert(!selectorReaches(`#stockTable th.${STARS_CLASS}`, STARS_TD));
  assert(!selectorReaches("#stockTable td.pick-light", STARS_TD));
  assert(!selectorReaches("#stockDetailCard .stars-column", STARS_TD));
  assert(!selectorReaches("#stockTable td", STARS_TD));
});
