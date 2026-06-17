#!/usr/bin/env -S deno run --allow-read --allow-run --allow-net --allow-env
//
// Supply-chain quarantine gate for the Cargo and GitHub Actions ecosystems
// (Issue #193).
//
// Dependabot's `cooldown` keyword is an in-preview, non-native release-age
// gate. The audit policy treats a "Dependabot-only" ecosystem with no
// compensating CI gate as having a *missing* quarantine: if the keyword is
// silently ignored, renamed, or changes behaviour, a freshly-hijacked crate
// or Action release could be auto-proposed inside the 24h window the project
// intends to enforce.
//
// This script is the deterministic, native-Deno backstop. It mirrors the Deno
// ecosystem's `--minimum-dependency-age=P1D` gate: on a dependency-bump PR it
// computes which external Cargo crates and GitHub Actions changed, fetches
// each one's upstream publish timestamp, and *fails closed* when a bump is
// younger than VIBE_BUMP_QUARANTINE_HOURS (default 24h) or its age cannot be
// verified. Internal stSoftwareAU/* dependencies bypass the quarantine and
// update immediately, matching the deno.json minimumDependencyAge policy.
//
// The cooldown block in .github/dependabot.yml is retained as defence in
// depth — this gate does not replace it, it backs it with a primitive that
// does not depend on a preview keyword taking effect.
//
// Pure decision logic (parsing, age maths, verdicts) is exported and unit
// tested in tests/bump_quarantine_gate_test.ts. Network and git glue runs
// only when the file is invoked directly.

export type Ecosystem = "cargo" | "github-actions";

export interface Bump {
  ecosystem: Ecosystem;
  /** Crate name, or `owner/repo` for an Action. */
  name: string;
  /** New version, or the Action ref/SHA. */
  version: string;
  /** Upstream publish time (ISO-8601), or null when it could not be resolved. */
  publishedAt: string | null;
}

/** A blocking verdict ("quarantined"/"unknown") fails the gate. */
export type Verdict = "ok" | "quarantined" | "internal" | "unknown";

export interface Evaluation {
  bump: Bump;
  verdict: Verdict;
  ageHours: number | null;
  reason: string;
}

const DEFAULT_QUARANTINE_HOURS = 24;

/**
 * Resolve the quarantine window in hours from the raw env value. Defaults to
 * 24h when unset/empty; throws on a non-positive or non-numeric override so a
 * misconfigured gate fails loudly rather than silently disabling itself.
 */
export function parseQuarantineHours(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_QUARANTINE_HOURS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `VIBE_BUMP_QUARANTINE_HOURS must be a positive number, got '${raw}'`,
    );
  }
  return value;
}

/**
 * Internal stSoftwareAU dependencies bypass the quarantine. For Cargo this is
 * any crate whose name begins with `stsoftware`; for Actions it is any
 * `owner/repo` owned by `stSoftwareAU`. Matching is case-insensitive.
 */
export function isInternal(ecosystem: Ecosystem, name: string): boolean {
  const lower = name.toLowerCase();
  if (ecosystem === "github-actions") {
    return lower.startsWith("stsoftwareau/");
  }
  return lower.startsWith("stsoftware");
}

/** Whole-and-fractional hours between `publishedAt` and `now`, or null. */
export function ageInHours(publishedAt: string, now: string): number | null {
  const published = Date.parse(publishedAt);
  const ref = Date.parse(now);
  if (Number.isNaN(published) || Number.isNaN(ref)) return null;
  return (ref - published) / 3_600_000;
}

/** Classify a single bump against the quarantine window. */
export function evaluateBump(
  bump: Bump,
  now: string,
  thresholdHours: number,
): Evaluation {
  if (isInternal(bump.ecosystem, bump.name)) {
    return {
      bump,
      verdict: "internal",
      ageHours: null,
      reason: "internal stSoftwareAU dependency — quarantine bypassed",
    };
  }
  if (bump.publishedAt === null) {
    return {
      bump,
      verdict: "unknown",
      ageHours: null,
      reason: "upstream publish time could not be resolved — failing closed",
    };
  }
  const age = ageInHours(bump.publishedAt, now);
  if (age === null) {
    return {
      bump,
      verdict: "unknown",
      ageHours: null,
      reason: `unparseable publish time '${bump.publishedAt}' — failing closed`,
    };
  }
  if (age < thresholdHours) {
    return {
      bump,
      verdict: "quarantined",
      ageHours: age,
      reason: `published ${
        age.toFixed(1)
      }h ago, under the ${thresholdHours}h quarantine`,
    };
  }
  return {
    bump,
    verdict: "ok",
    ageHours: age,
    reason: `published ${
      age.toFixed(1)
    }h ago, clears the ${thresholdHours}h quarantine`,
  };
}

/** Classify every bump. */
export function evaluateBumps(
  bumps: Bump[],
  now: string,
  thresholdHours: number,
): Evaluation[] {
  return bumps.map((b) => evaluateBump(b, now, thresholdHours));
}

/** The blocking subset of evaluations (too-fresh or unverifiable). */
export function violations(evaluations: Evaluation[]): Evaluation[] {
  return evaluations.filter(
    (e) => e.verdict === "quarantined" || e.verdict === "unknown",
  );
}

/** Parse a Cargo.lock into a name -> version map. */
export function parseCargoLock(text: string): Map<string, string> {
  const map = new Map<string, string>();
  // Split on the package table header; each chunk holds one package's keys.
  for (const chunk of text.split(/\[\[package\]\]/)) {
    const name = chunk.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const version = chunk.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
    if (name && version) map.set(name, version);
  }
  return map;
}

/** Crates added or upgraded between two Cargo.lock revisions. */
export function diffCargoLock(oldText: string, newText: string): Bump[] {
  const before = parseCargoLock(oldText);
  const after = parseCargoLock(newText);
  const bumps: Bump[] = [];
  for (const [name, version] of after) {
    if (before.get(name) !== version) {
      bumps.push({ ecosystem: "cargo", name, version, publishedAt: null });
    }
  }
  return bumps;
}

/** Parse `uses:` directives into an `owner/repo` -> ref map. */
export function parseUses(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /uses:\s*([\w.-]+\/[\w.-]+)@([\w.-]+)/g;
  for (const m of text.matchAll(re)) {
    map.set(m[1], m[2]);
  }
  return map;
}

/** Actions added or re-pinned between two sets of workflow file contents. */
export function diffUses(oldText: string, newText: string): Bump[] {
  const before = parseUses(oldText);
  const after = parseUses(newText);
  const bumps: Bump[] = [];
  for (const [name, version] of after) {
    if (before.get(name) !== version) {
      bumps.push({
        ecosystem: "github-actions",
        name,
        version,
        publishedAt: null,
      });
    }
  }
  return bumps;
}

// --------------------------------------------------------------------------
// Network + git glue (integration only; not unit tested).
// --------------------------------------------------------------------------

const USER_AGENT = "GRQ-validation-quarantine-gate (github.com/stSoftwareAU)";

/** Resolve a crate version's crates.io `created_at` timestamp. */
export async function fetchCratePublishedAt(
  name: string,
  version: string,
): Promise<string | null> {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${
    encodeURIComponent(version)
  }`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const body = await res.json() as { version?: { created_at?: string } };
    return body.version?.created_at ?? null;
  } catch {
    return null;
  }
}

/** Resolve an Action ref's upstream publish time via the GitHub commits API. */
export async function fetchActionPublishedAt(
  repo: string,
  ref: string,
): Promise<string | null> {
  const token = Deno.env.get("GITHUB_TOKEN");
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "application/vnd.github+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${repo}/commits/${ref}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const body = await res.json() as {
      commit?: { committer?: { date?: string }; author?: { date?: string } };
    };
    return body.commit?.committer?.date ?? body.commit?.author?.date ?? null;
  } catch {
    return null;
  }
}

/** Run a git command and return stdout, or null on failure. */
async function git(...args: string[]): Promise<string | null> {
  try {
    const cmd = new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "null",
    });
    const { success, stdout } = await cmd.output();
    if (!success) return null;
    return new TextDecoder().decode(stdout);
  } catch {
    return null;
  }
}

/** List repository files under a directory at a given git ref. */
async function lsFiles(ref: string, dir: string): Promise<string[]> {
  const out = await git("ls-tree", "-r", "--name-only", ref, "--", dir);
  if (!out) return [];
  return out.split("\n").filter((l) =>
    l.endsWith(".yml") || l.endsWith(".yaml")
  );
}

/** Read a file's contents at a git ref (empty string when absent). */
async function showAt(ref: string, path: string): Promise<string> {
  return (await git("show", `${ref}:${path}`)) ?? "";
}

/** Collect the Cargo + Actions bumps between `baseRef` and the working tree. */
export async function collectBumps(baseRef: string): Promise<Bump[]> {
  const bumps: Bump[] = [];

  // Cargo: diff the committed lock at base against the working tree.
  const oldLock = await showAt(baseRef, "Cargo.lock");
  let newLock = "";
  try {
    newLock = await Deno.readTextFile("Cargo.lock");
  } catch {
    newLock = "";
  }
  if (oldLock || newLock) bumps.push(...diffCargoLock(oldLock, newLock));

  // Actions: diff every workflow/action file's `uses:` refs.
  const dirs = [".github/workflows", ".github/actions"];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const baseFiles = await lsFiles(baseRef, dir);
    const headFiles = await lsFiles("HEAD", dir);
    for (const path of new Set([...baseFiles, ...headFiles])) {
      if (seen.has(path)) continue;
      seen.add(path);
      const oldText = await showAt(baseRef, path);
      let newText = "";
      try {
        newText = await Deno.readTextFile(path);
      } catch {
        newText = oldText; // file deleted in working tree — no new refs
      }
      bumps.push(...diffUses(oldText, newText));
    }
  }
  return bumps;
}

/** Attach upstream publish timestamps to a list of bumps. */
export async function resolvePublishTimes(bumps: Bump[]): Promise<Bump[]> {
  return await Promise.all(bumps.map(async (b) => {
    if (isInternal(b.ecosystem, b.name)) return b; // skip lookup; bypassed anyway
    const publishedAt = b.ecosystem === "cargo"
      ? await fetchCratePublishedAt(b.name, b.version)
      : await fetchActionPublishedAt(b.name, b.version);
    return { ...b, publishedAt };
  }));
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Entry point: evaluate the current PR's bumps and exit non-zero on a breach. */
export async function main(): Promise<number> {
  const thresholdHours = parseQuarantineHours(
    Deno.env.get("VIBE_BUMP_QUARANTINE_HOURS"),
  );
  const baseRef = Deno.args[0] ??
    (Deno.env.get("GITHUB_BASE_REF")
      ? `origin/${Deno.env.get("GITHUB_BASE_REF")}`
      : "origin/main");

  const raw = await collectBumps(baseRef);
  if (raw.length === 0) {
    console.log(
      `✅ No Cargo or GitHub Actions bumps detected against ${baseRef}.`,
    );
    return 0;
  }

  const resolved = await resolvePublishTimes(raw);
  const evaluations = evaluateBumps(resolved, nowIso(), thresholdHours);

  console.log(
    `🔍 Quarantine gate: ${thresholdHours}h window, base ${baseRef}\n`,
  );
  for (const e of evaluations) {
    const icon = e.verdict === "ok"
      ? "✅"
      : e.verdict === "internal"
      ? "➡️ "
      : "⛔";
    console.log(
      `${icon} [${e.bump.ecosystem}] ${e.bump.name}@${e.bump.version} — ${e.reason}`,
    );
  }

  const blocked = violations(evaluations);
  if (blocked.length > 0) {
    console.error(
      `\n❌ ${blocked.length} dependency bump(s) violate the ${thresholdHours}h quarantine.`,
    );
    return 1;
  }
  console.log(
    `\n✅ All external bumps clear the ${thresholdHours}h quarantine.`,
  );
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
