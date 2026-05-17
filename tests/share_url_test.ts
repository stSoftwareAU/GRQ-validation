import { assertEquals } from "@std/assert";

// Mirrors the share-URL helpers added to docs/app.js for issue #11.
// Keeping a parallel copy in the test file follows the project's existing
// pattern (see star_rating_test.ts) — app.js is browser-only and is not a
// module, so behaviour is duplicated and asserted here.

interface ScoreEntry {
  file: string;
  date: string;
  month?: string;
  day?: string;
}

interface ShareParams {
  file: string | null;
  date: string | null;
  stock: string | null;
}

function parseShareParams(search: string): ShareParams {
  const params = new URLSearchParams(search || "");
  return {
    file: params.get("file"),
    date: params.get("date"),
    stock: params.get("stock"),
  };
}

function buildShareSearch(
  state: { file?: string | null; stock?: string | null },
): string {
  const params = new URLSearchParams();
  if (state.file) params.set("file", state.file);
  if (state.stock) params.set("stock", state.stock);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function resolveScoreByParams(
  state: { file?: string | null; date?: string | null },
  scores: ScoreEntry[],
): ScoreEntry | null {
  if (!Array.isArray(scores) || scores.length === 0) return null;
  if (state.file) {
    const match = scores.find((s) => s.file === state.file);
    if (match) return match;
  }
  if (state.date) {
    const match = scores.find((s) => s.date === state.date);
    if (match) return match;
  }
  return null;
}

const SAMPLE_SCORES: ScoreEntry[] = [
  { file: "2025/January/15.tsv", date: "2025-01-15" },
  { file: "2025/February/14.tsv", date: "2025-02-14" },
  { file: "2024/December/3.tsv", date: "2024-12-3" },
];

Deno.test("parseShareParams - returns nulls when no parameters", () => {
  const result = parseShareParams("");
  assertEquals(result.file, null);
  assertEquals(result.date, null);
  assertEquals(result.stock, null);
});

Deno.test("parseShareParams - reads file parameter", () => {
  const result = parseShareParams("?file=2025/January/15.tsv");
  assertEquals(result.file, "2025/January/15.tsv");
  assertEquals(result.date, null);
  assertEquals(result.stock, null);
});

Deno.test("parseShareParams - reads date parameter", () => {
  const result = parseShareParams("?date=2025-02-14");
  assertEquals(result.date, "2025-02-14");
  assertEquals(result.file, null);
});

Deno.test("parseShareParams - reads stock parameter", () => {
  const result = parseShareParams("?stock=SCHW");
  assertEquals(result.stock, "SCHW");
});

Deno.test("parseShareParams - reads combined parameters", () => {
  const result = parseShareParams("?date=2025-02-14&stock=SCHW");
  assertEquals(result.date, "2025-02-14");
  assertEquals(result.stock, "SCHW");
});

Deno.test("buildShareSearch - empty state returns empty string", () => {
  assertEquals(buildShareSearch({}), "");
});

Deno.test("buildShareSearch - serialises file only", () => {
  assertEquals(
    buildShareSearch({ file: "2025/January/15.tsv" }),
    "?file=2025%2FJanuary%2F15.tsv",
  );
});

Deno.test("buildShareSearch - serialises file and stock together", () => {
  assertEquals(
    buildShareSearch({ file: "2025/February/14.tsv", stock: "SCHW" }),
    "?file=2025%2FFebruary%2F14.tsv&stock=SCHW",
  );
});

Deno.test("buildShareSearch - drops null and empty values", () => {
  assertEquals(
    buildShareSearch({ file: null, stock: "" }),
    "",
  );
});

Deno.test("resolveScoreByParams - matches by file when provided", () => {
  const match = resolveScoreByParams(
    { file: "2025/February/14.tsv" },
    SAMPLE_SCORES,
  );
  assertEquals(match?.date, "2025-02-14");
});

Deno.test("resolveScoreByParams - matches by date when file missing", () => {
  const match = resolveScoreByParams(
    { date: "2024-12-3" },
    SAMPLE_SCORES,
  );
  assertEquals(match?.file, "2024/December/3.tsv");
});

Deno.test("resolveScoreByParams - returns null when neither matches", () => {
  const match = resolveScoreByParams(
    { date: "1999-01-01", file: "missing.tsv" },
    SAMPLE_SCORES,
  );
  assertEquals(match, null);
});

Deno.test("resolveScoreByParams - returns null for empty inputs", () => {
  assertEquals(resolveScoreByParams({}, SAMPLE_SCORES), null);
  assertEquals(resolveScoreByParams({ date: "2025-02-14" }, []), null);
});

Deno.test("parse then build round-trip preserves state", () => {
  const parsed = parseShareParams("?file=2025/February/14.tsv&stock=SCHW");
  const rebuilt = buildShareSearch({
    file: parsed.file,
    stock: parsed.stock,
  });
  const reparsed = parseShareParams(rebuilt);
  assertEquals(reparsed.file, "2025/February/14.tsv");
  assertEquals(reparsed.stock, "SCHW");
});
