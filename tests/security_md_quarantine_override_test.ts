// Tests for the SECURITY.md emergency quarantine-override steer (Issue #197).
//
// The repository enforces a deliberate 24h dependency-age quarantine across
// its external-dependency channels (the Cargo/Action "Dependency Quarantine
// Gate" workflow and the Deno `minimumDependencyAge` policy). SECURITY.md
// documents an emergency dependency-bump procedure but, before this change,
// never addressed how to land a patched version that is itself *younger* than
// the quarantine window during an actively-exploited CVE.
//
// Following the anti-brittleness lessons of Issue #81, these tests assert
// *derivable relationships* rather than hand-copied prose: the override steer
// in SECURITY.md must reference the same quarantine-window hours configured in
// the gate workflow and the same `minimumDependencyAge` age token configured
// in deno.json, so editing either control and the runbook together keeps the
// test green while a silent drift between them fails. Exact wording remains
// policed by the Markdown linter and human review.

import { assert } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const SECURITY_PATH = "SECURITY.md";
const WORKFLOW_PATH = ".github/workflows/bump-quarantine-gate.yml";
const DENO_JSON_PATH = "deno.json";

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

// Source of truth for the Cargo/Action quarantine window: the gate workflow's
// VIBE_BUMP_QUARANTINE_HOURS env value.
async function quarantineHoursFromWorkflow(): Promise<string> {
  const doc = parseYaml(await readText(WORKFLOW_PATH)) as Record<
    string,
    unknown
  >;
  const jobs = doc.jobs as Record<string, { env?: Record<string, string> }>;
  const hours = jobs.quarantine?.env?.["VIBE_BUMP_QUARANTINE_HOURS"];
  assert(hours, "workflow must configure VIBE_BUMP_QUARANTINE_HOURS");
  return String(hours);
}

// Source of truth for the Deno channel quarantine: deno.json
// minimumDependencyAge.age (an ISO-8601 duration, e.g. "P1D").
async function denoMinimumAgeToken(): Promise<string> {
  const doc = JSON.parse(await readText(DENO_JSON_PATH)) as {
    minimumDependencyAge?: { age?: string };
  };
  const age = doc.minimumDependencyAge?.age;
  assert(age, "deno.json must configure minimumDependencyAge.age");
  return age;
}

// Locate the emergency-bump section and the override subsection within it.
function overrideSubsection(text: string): string {
  const emergencyIdx = text.indexOf("## Emergency dependency-bump procedure");
  assert(
    emergencyIdx >= 0,
    "SECURITY.md must keep the emergency dependency-bump procedure",
  );
  const section = text.slice(emergencyIdx);
  const match = section.match(/###\s+Overriding the quarantine window/);
  assert(
    match,
    "SECURITY.md must document an 'Overriding the quarantine window' " +
      "subsection under the emergency dependency-bump procedure",
  );
  return section.slice(match.index!);
}

Deno.test(
  "SECURITY.md documents overriding the quarantine window",
  async () => {
    const text = await readText(SECURITY_PATH);
    // Asserts the subsection exists in the right place.
    overrideSubsection(text);
  },
);

Deno.test(
  "quarantine override references the configured Cargo/Action window",
  async () => {
    const subsection = overrideSubsection(await readText(SECURITY_PATH));
    const hours = await quarantineHoursFromWorkflow();
    assert(
      subsection.includes(hours),
      `override steer must reference the ${hours}h quarantine window from ` +
        "the gate workflow so the runbook cannot drift from the control",
    );
  },
);

Deno.test(
  "quarantine override addresses the Deno minimumDependencyAge channel",
  async () => {
    const subsection = overrideSubsection(await readText(SECURITY_PATH));
    const age = await denoMinimumAgeToken();
    // The Deno steer must name both the control and its configured age token
    // so the explicit-pin escape hatch stays tied to deno.json.
    assert(
      subsection.includes("minimumDependencyAge"),
      "override steer must name the deno.json minimumDependencyAge control",
    );
    assert(
      subsection.includes(age),
      `override steer must reference the configured age token '${age}' ` +
        "from deno.json",
    );
  },
);
