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
