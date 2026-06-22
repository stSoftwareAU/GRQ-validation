// Tests for the "Return above Cost of Capital" column rename + definition
// (issue #295). The confusing "Progress vs Cost of Capital" column is renamed
// to a clearer label and given a short in-UI definition (the return above the
// 10% annualised cost-of-capital hurdle, pro-rated by days elapsed). This is a
// display/labelling change only — no figures or formulae change.
//
// These tests guard the acceptance criteria directly: the new label is present
// at every render site, a definition is available in-UI, and no stale
// references to the old header survive in the published dashboard assets.

import { assert } from "@std/assert";

const INDEX_HTML = "docs/index.html";
const APP_JS = "docs/app.js";

const NEW_LABEL = "Return above Cost of Capital";
const OLD_LABEL = "Progress vs Cost of Capital";
// Sign-convention phrase from the definition — proves the definition explains
// what positive means, not just what the figure is.
const SIGN_CONVENTION = "beating the hurdle";

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

Deno.test("docs/index.html uses the new column label", async () => {
  const html = await read(INDEX_HTML);
  assert(
    html.includes(`<th`) && html.includes(NEW_LABEL),
    `index.html must display the "${NEW_LABEL}" column header`,
  );
});

Deno.test("docs/index.html provides a header definition/tooltip", async () => {
  const html = await read(INDEX_HTML);
  // The header carries a native title tooltip describing the figure.
  assert(
    html.includes("cost-of-capital hurdle"),
    "index.html header must define the figure (cost-of-capital hurdle)",
  );
});

Deno.test("docs/index.html has no stale references to the old header", async () => {
  const html = await read(INDEX_HTML);
  assert(
    !html.includes(OLD_LABEL),
    `index.html must not reference the old "${OLD_LABEL}" header`,
  );
});

Deno.test("docs/app.js renders the new column label at every site", async () => {
  const js = await read(APP_JS);
  assert(
    js.includes(NEW_LABEL),
    `app.js must use the new "${NEW_LABEL}" label`,
  );
});

Deno.test("docs/app.js exposes the definition and sign convention in-UI", async () => {
  const js = await read(APP_JS);
  assert(
    js.includes("cost-of-capital hurdle"),
    "app.js must include the in-UI definition of the figure",
  );
  assert(
    js.includes(SIGN_CONVENTION),
    "app.js definition must state the sign convention (positive = beating the hurdle)",
  );
});

Deno.test("docs/app.js has no stale references to the old header", async () => {
  const js = await read(APP_JS);
  assert(
    !js.includes(OLD_LABEL),
    `app.js must not reference the old "${OLD_LABEL}" header text`,
  );
});
