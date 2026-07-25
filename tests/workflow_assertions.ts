// Shared assertions and parsing helpers for the GitHub Actions workflow tests
// (Issue #202).
//
// The workflow tests used to assert behaviour by regex-matching the command
// *text* inside `.github/workflows/*.yml` — e.g. `/\bdeno\s+fmt\s+--check\b/`
// on a joined blob of every step's `run` script. That is the
// grep-as-assertion anti-pattern: a behaviour-preserving edit (reordering
// flags, splitting a step, continuing a line with `\`) breaks the test even
// though CI does the same thing.
//
// These helpers replace the source-text greps with structured assertions on
// the parsed workflow: load the YAML once, look at steps as data, and decide
// whether a step *invokes a tool/subcommand* by tokenising the command rather
// than matching its exact spelling. The SHA-pinning supply-chain guard — the
// one genuine source-text invariant, since it is about the literal `uses:`
// ref — is deduplicated here so the fix lands in a single place.

import { assert } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

export interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface WorkflowJob {
  "runs-on"?: string;
  "timeout-minutes"?: number;
  container?: { image?: string } | string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
}

export interface Workflow {
  name?: string;
  permissions?: Record<string, string>;
  concurrency?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
}

/** Read and parse a workflow file, returning both the raw text and the doc. */
export async function loadWorkflow(
  path: string,
): Promise<{ text: string; doc: Workflow }> {
  const text = await Deno.readTextFile(path);
  return { text, doc: parseYaml(text) as Workflow };
}

/**
 * Return the workflow's `on` trigger map. YAML 1.1 parses a bare `on:` key as
 * the boolean `true`, so accept either spelling.
 */
export function workflowTriggers(
  doc: Workflow,
): Record<string, unknown> | undefined {
  const raw = doc as Record<string, unknown>;
  return (raw.on ?? raw["true"] ??
    raw[true as unknown as string]) as Record<string, unknown> | undefined;
}

/**
 * The `branches:` filter of a trigger, or `undefined` when the trigger is
 * present but unfiltered (a bare `pull_request:` runs on every base branch).
 * Returns `null` when the trigger itself is absent.
 */
export function triggerBranches(
  doc: Workflow,
  trigger: string,
): string[] | undefined | null {
  const on = workflowTriggers(doc);
  if (!on || !(trigger in on)) return null;
  const spec = on[trigger] as { branches?: string[] } | null | undefined;
  return spec?.branches;
}

/**
 * Translate one GitHub Actions filter pattern into a regular expression.
 *
 * Follows the documented filter-pattern semantics: `*` matches any character
 * except `/`, `**` matches any character including `/`, `?` matches zero or
 * one of the preceding character, `+` matches one or more of the preceding
 * character, and every other character is literal. This is why `["*"]` does
 * *not* match a `milestone/<slug>` base branch (Issue #788).
 */
function filterPatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i++;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?" || char === "+") {
      // Quantifiers apply to the preceding pattern element, which the loop
      // has already emitted — pass them through untouched.
      source += char;
    } else {
      source += char.replace(/[.\\/^$|()[\]{}]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * True when a workflow's `branches:` filter runs for a pull request against
 * `branch`. An absent filter (`undefined`) means "every branch". A leading
 * `!` marks an exclusion: the branch must match at least one positive pattern
 * and no negative one.
 */
export function branchFilterMatches(
  branches: string[] | undefined,
  branch: string,
): boolean {
  if (branches === undefined) return true;
  const positive = branches.filter((p) => !p.startsWith("!"));
  const negative = branches.filter((p) => p.startsWith("!")).map((p) =>
    p.slice(1)
  );
  if (negative.some((p) => filterPatternToRegExp(p).test(branch))) return false;
  return positive.some((p) => filterPatternToRegExp(p).test(branch));
}

/**
 * Every step across every job, or just the named job's steps when `jobName`
 * is given (empty array when the job or its steps are absent).
 */
export function workflowSteps(
  doc: Workflow,
  jobName?: string,
): WorkflowStep[] {
  const jobs = doc.jobs ?? {};
  if (jobName !== undefined) return jobs[jobName]?.steps ?? [];
  return Object.values(jobs).flatMap((job) => job.steps ?? []);
}

/**
 * Split a shell script into individual command segments. Line continuations
 * (`\` at end-of-line) are joined first, then the script is split on newlines
 * and the common shell separators so each segment is a single invocation.
 */
export function commandSegments(script: string): string[] {
  return script
    .replace(/\s*\\\r?\n\s*/g, " ")
    .split(/\r?\n|&&|\|\||[;|&]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export interface ToolInvocation {
  /** Expected first non-flag token after the tool (its subcommand). */
  subcommand?: string;
  /**
   * Tokens (flags or operands) that must all appear after the tool token. A
   * required arg matches a token exactly or as the name part of `name=value`,
   * so `--coverage` matches `--coverage=cov_profile`.
   */
  args?: string[];
}

function segmentInvokes(
  segment: string,
  tool: string,
  opts: ToolInvocation,
): boolean {
  const tokens = segment.split(/\s+/).filter(Boolean);
  const toolIdx = tokens.indexOf(tool);
  if (toolIdx === -1) return false;
  const after = tokens.slice(toolIdx + 1);
  if (opts.subcommand !== undefined) {
    const firstOperand = after.find((token) => !token.startsWith("-"));
    if (firstOperand !== opts.subcommand) return false;
  }
  if (opts.args) {
    const matchesArg = (arg: string) =>
      after.some((token) => token === arg || token.startsWith(`${arg}=`));
    if (!opts.args.every(matchesArg)) return false;
  }
  return true;
}

/**
 * True when any step's `run` invokes `tool` with the optional `subcommand`
 * and all required `args`. Operates on the parsed steps and tokenises each
 * command, so flag reordering, extra flags, and `\`-continued lines are all
 * tolerated — only the semantic invariant (which tool/subcommand runs) is
 * asserted, never the exact source-text spelling.
 */
export function invokesTool(
  steps: WorkflowStep[],
  tool: string,
  opts: ToolInvocation = {},
): boolean {
  return steps.some((step) =>
    commandSegments(step.run ?? "").some((segment) =>
      segmentInvokes(segment, tool, opts)
    )
  );
}

/** Index of the first step whose `run` invokes `tool` (or -1 if none). */
export function stepIndexInvoking(
  steps: WorkflowStep[],
  tool: string,
  opts: ToolInvocation = {},
): number {
  return steps.findIndex((step) => invokesTool([step], tool, opts));
}

/** Index of the first step that uses an action whose ref starts with `prefix`. */
export function stepIndexUsing(
  steps: WorkflowStep[],
  prefix: string,
): number {
  return steps.findIndex((step) =>
    typeof step.uses === "string" && step.uses.startsWith(prefix)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `vMAJOR` recorded in the version-annotation comment directly above each
 * SHA-pinned `uses: <actionPrefix>@<40-char-sha>` line, in source order.
 *
 * A GitHub Actions pin is an opaque 40-char SHA, so the adjacent
 * `# owner/action@vX.Y.Z` comment is the only human-readable record of which
 * release the SHA points at — and the record an audit reads to judge the
 * runtime the action ships (Issue #789). When that comment drifts from the SHA
 * it labels, the audit misjudges the runtime. Each returned entry is the major
 * version parsed from the nearest preceding comment (blank lines skipped), or
 * `NaN` when no `@vN` annotation precedes the pin. Empty when the action is
 * unused.
 */
export function annotatedActionMajors(
  text: string,
  actionPrefix: string,
): number[] {
  const prefix = escapeRegExp(actionPrefix);
  const usesRe = new RegExp(`^\\s*-?\\s*uses:\\s*${prefix}@[0-9a-f]{40}`);
  const commentRe = new RegExp(`${prefix}@v(\\d+)`);
  const lines = text.split("\n");
  const majors: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!usesRe.test(lines[i])) continue;
    // Walk up through the contiguous comment block above the pin (skipping a
    // blank gap), so a multi-line annotation is matched wherever the `@vN`
    // token sits within it.
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === "") j--;
    let major = NaN;
    while (j >= 0 && lines[j].trim().startsWith("#")) {
      const match = lines[j].match(commentRe);
      if (match) {
        major = Number(match[1]);
        break;
      }
      j--;
    }
    majors.push(major);
  }
  return majors;
}

/**
 * Assert every SHA-pinned `actions/setup-node` step is annotated with a
 * node24-era major (v5 or newer). setup-node v4 and older ship the `node20`
 * Actions runtime, which GitHub removes on 2026-09-16; an annotation still
 * claiming v4 either pins the removed runtime or misrecords the release the SHA
 * points at, misleading the runtime audit (Issue #789).
 */
export function assertSetupNodeRuntimeSupported(text: string): void {
  const majors = annotatedActionMajors(text, "actions/setup-node");
  assert(majors.length > 0, "workflow must pin actions/setup-node");
  for (const major of majors) {
    assert(
      Number.isFinite(major),
      "each actions/setup-node pin must carry a `# actions/setup-node@vX.Y.Z` version annotation recording the release it points at",
    );
    assert(
      major >= 5,
      `actions/setup-node must be annotated with a node24-era major (v5+); found v${major}, which maps to the removed node20 runtime`,
    );
  }
}

/**
 * Assert every SHA-pinned `actions/cache` step is annotated with a node24-era
 * major (v5 or newer). actions/cache v4 and older ship the `node20` Actions
 * runtime, which GitHub removes on 2026-09-16; an annotation still claiming v4
 * either pins the removed runtime or misrecords the release the SHA points at,
 * misleading the runtime audit (Issue #790).
 */
export function assertCacheRuntimeSupported(text: string): void {
  const majors = annotatedActionMajors(text, "actions/cache");
  assert(majors.length > 0, "workflow must pin actions/cache");
  for (const major of majors) {
    assert(
      Number.isFinite(major),
      "each actions/cache pin must carry a `# actions/cache@vX.Y.Z` version annotation recording the release it points at",
    );
    assert(
      major >= 5,
      `actions/cache must be annotated with a node24-era major (v5+); found v${major}, which maps to the removed node20 runtime`,
    );
  }
}

/**
 * Assert every `uses:` action in the workflow source is pinned to a 40-char
 * commit SHA, not a mutable tag/branch. SHA pinning is a genuine source-text
 * invariant (the literal ref is what runs), so this is the one grep we keep —
 * deduplicated here per Issue #202 so the supply-chain guard lands once.
 */
export function assertActionsPinnedToSha(text: string): void {
  const usesLines = text.split("\n").filter((line) =>
    /^\s*-?\s*uses:/.test(line)
  );
  assert(usesLines.length > 0, "workflow must use at least one action");
  for (const line of usesLines) {
    assert(
      /@[0-9a-f]{40}\s*$/.test(line.trim()),
      `action not pinned to 40-char SHA: ${line.trim()}`,
    );
  }
}
