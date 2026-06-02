// Tests for the SBOM-generation step in the CI/CD `build` job (Issue #53).
//
// SCR-SBOM readiness: the `build` job compiles a release binary and uploads
// it as an artefact. To shorten incident triage after a dependency
// compromise is disclosed, the job must also generate a machine-readable
// Software Bill of Materials (CycloneDX JSON) from the Rust lockfile and
// attach it to the uploaded artefact. These tests verify that the workflow
// generates the SBOM before uploading and includes it in the artefact.

import { assert, assertEquals } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

const WORKFLOW_PATH = ".github/workflows/ci.yml";
const SBOM_FILE = "grq-validation.cdx.json";

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

async function buildSteps(): Promise<Step[]> {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as { jobs?: Record<string, { steps?: Step[] }> };
  assert(doc.jobs, "workflow must declare jobs");
  const build = doc.jobs.build;
  assert(build, "build job must exist");
  assert(
    Array.isArray(build.steps) && build.steps.length > 0,
    "build job needs steps",
  );
  return build.steps!;
}

Deno.test("build job generates a CycloneDX SBOM from the Rust lockfile", async () => {
  const steps = await buildSteps();
  const runs = steps.map((s) => s.run ?? "").join("\n");
  assert(
    /cargo\s+(install\s+cargo-cyclonedx|cyclonedx)/.test(runs),
    "build job must install/run cargo-cyclonedx",
  );
  assert(
    /cargo\s+cyclonedx/.test(runs),
    "build job must invoke `cargo cyclonedx` to generate the SBOM",
  );
  assert(
    runs.includes(SBOM_FILE),
    `SBOM step must produce ${SBOM_FILE}`,
  );
});

Deno.test("SBOM is generated before the artefact upload", async () => {
  const steps = await buildSteps();
  const sbomIdx = steps.findIndex((s) => /cargo\s+cyclonedx/.test(s.run ?? ""));
  const uploadIdx = steps.findIndex((s) =>
    typeof s.uses === "string" && s.uses.includes("actions/upload-artifact")
  );
  assert(sbomIdx >= 0, "an SBOM-generation step must exist");
  assert(uploadIdx >= 0, "an upload-artifact step must exist");
  assert(
    sbomIdx < uploadIdx,
    "SBOM must be generated before the artefact is uploaded",
  );
});

Deno.test("uploaded artefact includes both the binary and the SBOM", async () => {
  const steps = await buildSteps();
  const upload = steps.find((s) =>
    typeof s.uses === "string" && s.uses.includes("actions/upload-artifact")
  );
  assert(upload, "upload-artifact step must exist");
  const path = String(upload!.with?.path ?? "");
  assert(
    path.includes("target/release/grq-validation"),
    "artefact must still include the release binary",
  );
  assert(
    path.includes(SBOM_FILE),
    `artefact path must include ${SBOM_FILE}`,
  );
});

Deno.test("SBOM workflow file parses as valid YAML with expected name", async () => {
  const text = await Deno.readTextFile(WORKFLOW_PATH);
  const doc = parseYaml(text) as Record<string, unknown>;
  assertEquals(doc.name, "CI/CD Pipeline");
});
