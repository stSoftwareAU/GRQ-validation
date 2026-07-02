// Tests for the heading outline on the dashboard pages (issue #695).
//
// The HTML bucket requires headings to descend without skipping levels so that
// screen-reader users navigating by heading level get an unbroken document
// outline. Previously docs/index.html jumped h1 → h2 → h5 → h6 because the
// Bootstrap card titles were chosen for visual size rather than structure.
// These assertions read the REAL committed HTML so they verify the rendered
// structure, not the method.

import { assert, assertEquals } from "@std/assert";

const PAGES = ["docs/index.html", "docs/trend.html"];

/** Extract the heading levels (1–6) in document order. */
function headingLevels(html: string): number[] {
  const levels: number[] = [];
  const re = /<h([1-6])[\s>]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    levels.push(Number(m[1]));
  }
  return levels;
}

for (const page of PAGES) {
  Deno.test(`${page}: heading outline never skips a level`, async () => {
    const html = await Deno.readTextFile(page);
    const levels = headingLevels(html);
    assert(levels.length > 0, `${page} must contain at least one heading`);
    assertEquals(levels[0], 1, `${page} must start its outline at <h1>`);

    let previous = levels[0];
    for (let i = 1; i < levels.length; i++) {
      const current = levels[i];
      // Descending deeper may only step down one level at a time; stepping
      // back up to a shallower/sibling level is always allowed.
      assert(
        current <= previous + 1,
        `${page} heading #${
          i + 1
        } jumps from <h${previous}> to <h${current}> ` +
          `(skips level ${previous + 1}); full outline: ${levels.join(",")}`,
      );
      previous = current;
    }
  });

  Deno.test(`${page}: has exactly one <h1>`, async () => {
    const html = await Deno.readTextFile(page);
    const h1s = headingLevels(html).filter((l) => l === 1).length;
    assertEquals(h1s, 1, `${page} must have exactly one <h1>; found ${h1s}`);
  });
}
