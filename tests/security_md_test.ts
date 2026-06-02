// Tests for SECURITY.md supply-chain readiness runbook (Issue #52).
//
// Verify the repository publishes a root SECURITY.md that names a
// disclosure contact and documents an emergency dependency-bump
// procedure for both the Deno (JSR) and Rust (Cargo) sides of this
// hybrid project. This is the SCR-RUNBOOK posture/readiness gap: a
// reporter must know who to tell, and the team must have a rehearsed
// steer for an out-of-band update.

import { assert } from "@std/assert";

const SECURITY_PATH = "SECURITY.md";

async function readSecurity(): Promise<string> {
  return await Deno.readTextFile(SECURITY_PATH);
}

Deno.test("SECURITY.md exists at the repository root", async () => {
  const stat = await Deno.stat(SECURITY_PATH);
  assert(stat.isFile, `${SECURITY_PATH} should be a file`);
});

Deno.test("SECURITY.md publishes a disclosure contact", async () => {
  const text = await readSecurity();
  assert(
    text.includes("security@stsoftware.com.au"),
    "SECURITY.md must publish a disclosure contact email",
  );
});

Deno.test("SECURITY.md documents the Deno emergency-bump procedure", async () => {
  const text = await readSecurity();
  assert(
    text.includes("deno.json"),
    "Deno procedure must reference pinning the safe version in deno.json",
  );
  assert(
    text.includes("deno.lock"),
    "Deno procedure must reference refreshing deno.lock",
  );
  assert(
    /deno test/.test(text),
    "Deno procedure must reference running deno test before merging",
  );
});

Deno.test("SECURITY.md documents the Rust emergency-bump procedure", async () => {
  const text = await readSecurity();
  assert(
    /cargo update -p/.test(text),
    "Rust procedure must reference cargo update -p <crate> --precise",
  );
  assert(
    /cargo audit/.test(text),
    "Rust procedure must reference cargo audit",
  );
  assert(
    /cargo test/.test(text),
    "Rust procedure must reference running cargo test",
  );
});
