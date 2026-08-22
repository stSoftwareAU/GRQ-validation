// Documentation-consistency gate for the pick-detail columns (issue #843,
// sub-issue of #835).
//
// The README explains every behavioural rule in prose — a reader who cannot
// find out *why* a name shows 🔴 cannot trust the light. Prose numbers drift
// from code silently, so this test asserts a *derivable relationship* rather
// than hand-copied phrases: every threshold, emoji and sidecar column quoted in
// the README is read out of the shipped source (docs/pick_details.js,
// docs/pick_working.js, src/picks_sidecar.rs, src/main.rs) and looked up in the
// document. Retune a constant without retuning the README and this fails.

import { assert } from "@std/assert";
import "../docs/pick_details.js";
import "../docs/pick_working.js";

interface Warning {
  emoji: string;
  label: string;
}

const g = globalThis as unknown as {
  GRQPickDetails: {
    PARCEL_DOLLARS: number;
    MIN_RED_LOTS: number;
    MIN_AMBER_LOTS: number;
    HIGH_CUT: number;
    LOW_CUT: number;
    DROP_CUT: number;
    EY_WEAK_CUT: number;
    EY_STRONG_CUT: number;
    DELIST_PRICE: number;
    WARNINGS: Record<string, Warning>;
  };
  GRQPickWorking: {
    LIGHTS: Record<string, { word: string; meaning: string }>;
  };
};

const README = await Deno.readTextFile("README.md");
const CONTRIBUTING = await Deno.readTextFile("CONTRIBUTING.md");
const SIDECAR_SOURCE = await Deno.readTextFile("src/picks_sidecar.rs");
const MAIN_SOURCE = await Deno.readTextFile("src/main.rs");

/** The Features bullet documenting the pick-detail columns, on its own. */
function featuresEntry(): string {
  const start = README.indexOf("- **Pick-Detail Columns**");
  assert(
    start >= 0,
    "README Features must carry a '- **Pick-Detail Columns**' entry",
  );
  const rest = README.slice(start + 1);
  const end = rest.search(/\n- \*\*/);
  return end >= 0 ? rest.slice(0, end) : rest;
}

/** A README section, from its heading to the next heading of any depth. */
function section(headingPrefix: string): string {
  const start = README.indexOf(headingPrefix);
  assert(start >= 0, `README must carry a section headed '${headingPrefix}'`);
  const rest = README.slice(start + headingPrefix.length);
  const end = rest.search(/\n#{2,4} /);
  return end >= 0 ? rest.slice(0, end) : rest;
}

/** Mirrors the one-decimal rounding docs/pick_details.js uses for its labels. */
function percentText(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/** The sidecar's column names, read from the Rust writer's header constant. */
function sidecarColumns(): string[] {
  const block = SIDECAR_SOURCE.match(
    /const SIDECAR_HEADER: \[&str; \d+\] = \[([\s\S]*?)\];/,
  );
  assert(block, "src/picks_sidecar.rs must declare SIDECAR_HEADER");
  const names = [...block[1].matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert(names.length > 0, "SIDECAR_HEADER must list column names");
  return names;
}

/** Every long flag the CLI actually accepts, derived from the clap struct. */
function cliLongFlags(): Set<string> {
  const struct = MAIN_SOURCE.match(/struct Args \{([\s\S]*?)\n\}/);
  assert(struct, "src/main.rs must declare the clap Args struct");
  const fields = [...struct[1].matchAll(/\n {4}([a-z_]+):/g)].map((m) => m[1]);
  assert(fields.length > 0, "the Args struct must declare fields");
  return new Set(fields.map((field) => `--${field.replaceAll("_", "-")}`));
}

Deno.test("README Features documents every pick-detail threshold", () => {
  const {
    PARCEL_DOLLARS,
    MIN_RED_LOTS,
    MIN_AMBER_LOTS,
    HIGH_CUT,
    LOW_CUT,
    DROP_CUT,
    EY_WEAK_CUT,
    EY_STRONG_CUT,
    DELIST_PRICE,
  } = g.GRQPickDetails;
  const entry = featuresEntry();
  const expected = [
    `$${PARCEL_DOLLARS.toLocaleString("en-AU")}`,
    `${MIN_RED_LOTS} lots`,
    `${MIN_AMBER_LOTS} lots`,
    `$${DELIST_PRICE}`,
    `${HIGH_CUT}`,
    `${LOW_CUT}`,
    percentText(Math.abs(DROP_CUT)),
    percentText(EY_WEAK_CUT),
    percentText(EY_STRONG_CUT),
  ];
  for (const value of expected) {
    assert(
      entry.includes(value),
      `README Features entry must quote the threshold '${value}' from docs/pick_details.js`,
    );
  }
});

Deno.test("README Features documents every light and warning emoji", () => {
  const entry = featuresEntry();
  const emojis = [
    ...Object.keys(g.GRQPickWorking.LIGHTS),
    ...Object.values(g.GRQPickDetails.WARNINGS).map((w) => w.emoji),
  ];
  for (const emoji of emojis) {
    assert(
      entry.includes(emoji),
      `README Features entry must decode the ${emoji} marker`,
    );
  }
});

Deno.test("README Features names the single sources of truth and the caveats", () => {
  const entry = featuresEntry();
  for (
    const reference of ["docs/pick_details.js", "docs/volume_recommend.js"]
  ) {
    assert(
      entry.includes(reference),
      `README Features entry must name ${reference} as the source of truth`,
    );
  }
  assert(
    /as at the score date/i.test(entry),
    "README Features entry must state the figures are as at the score date",
  );
  assert(
    /blank/i.test(entry),
    "README Features entry must state that an unknown value renders blank",
  );
});

Deno.test("README documents every column the sidecar writer emits", () => {
  const sidecar = section("#### Pick-details sidecar");
  for (const column of sidecarColumns()) {
    assert(
      sidecar.includes(`\`${column}\``),
      `README sidecar section must document the '${column}' column`,
    );
  }
});

Deno.test("README places the sidecar beside the other per-score-date files", () => {
  const sidecar = section("#### Pick-details sidecar");
  for (const sibling of ["-analysis.csv", "-dividends.csv"]) {
    assert(
      sidecar.includes(sibling),
      `README sidecar section must say where the sidecar sits relative to ${sibling}`,
    );
  }
});

Deno.test("the documented sidecar backfill uses flags the CLI accepts", () => {
  const backfill = section("#### Backfilling the pick-details sidecar");
  const flags = new Set(
    [...backfill.matchAll(/--[a-z][a-z-]+/g)].map((m) => m[0]),
  );
  assert(flags.size > 0, "the backfill section must show a command to run");
  const accepted = cliLongFlags();
  for (const flag of flags) {
    assert(
      accepted.has(flag),
      `README documents '${flag}', which src/main.rs does not accept`,
    );
  }
  for (const root of ["--market-data-path", "--dividend-data-path"]) {
    assert(
      flags.has(root),
      `the backfill section must show the ${root} data root it needs`,
    );
  }
});

Deno.test("CONTRIBUTING documents the backfill beside the processor invocations", () => {
  assert(
    CONTRIBUTING.includes("-picks.csv"),
    "CONTRIBUTING must document the pick-details sidecar backfill",
  );
  assert(
    CONTRIBUTING.includes("--process-all"),
    "CONTRIBUTING's backfill note must show the flag that regenerates every date",
  );
});
