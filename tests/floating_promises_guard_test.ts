// Tests for issue #89 — top-level async calls in the debug helper scripts must
// not be floating promises. Each script now exports its entry function and only
// invokes it behind an `import.meta.main` guard that attaches a `.catch`.
//
// Behaviour verified here: importing each module (as a dependency, i.e.
// `import.meta.main` is false) is side-effect-free — it must NOT run the script
// body. The whole suite runs under `deno test --allow-read` only; if importing
// re-triggered the old floating-promise call, the body would attempt network or
// subprocess work and fail the import on a permission error (or call Deno.exit
// and kill the runner). A clean import therefore proves the guard works.
//
// Each module also exposes its entry function as a named export so the call can
// be awaited/guarded rather than discarded.
import { assertEquals } from "@std/assert";

Deno.test("check_syntax.ts - imports without running the check", async () => {
  const mod = await import("../scripts/debug/check_syntax.ts");
  assertEquals(typeof mod.checkSyntax, "function");
});

Deno.test("debug_schw_current_price.ts - imports without running the debug", async () => {
  const mod = await import("../scripts/debug/debug_schw_current_price.ts");
  assertEquals(typeof mod.debugSCHWCurrentPrice, "function");
});

Deno.test("test_page_load.ts - imports without booting the server", async () => {
  const mod = await import("../scripts/debug/test_page_load.ts");
  assertEquals(typeof mod.testPageLoad, "function");
});
