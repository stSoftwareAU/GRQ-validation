// Tests for the model-training documentation section (Issue #602).
//
// The README gains a high-level, conceptual overview of how the GRQ
// prediction model is trained and the processes around it: training-data
// production, key observations, multi-node continuous learning, and the major
// market feeds. These tests assert that the required topics, the public
// NEAT-AI repositories, and the named data providers are present — derivable
// requirements from the issue's accepted scope rather than brittle prose
// matches.

import { assert } from "@std/assert";

const README = "README.md";

async function readReadme(): Promise<string> {
  return await Deno.readTextFile(README);
}

// Return only the body of the training section, so the assertions below verify
// the content lives in that section rather than coincidentally elsewhere.
async function trainingSection(): Promise<string> {
  const text = await readReadme();
  const start = text.indexOf("## How the GRQ model is trained");
  assert(
    start !== -1,
    "README.md must contain a '## How the GRQ model is trained' section",
  );
  // The section runs until the next top-level (## ) heading, or end of file.
  const rest = text.slice(start + 3);
  const nextHeading = rest.indexOf("\n## ");
  return nextHeading === -1 ? text.slice(start) : rest.slice(0, nextHeading);
}

Deno.test("README documents the model-training section", async () => {
  const section = await trainingSection();
  assert(section.length > 0, "training section must not be empty");
});

Deno.test("README training section covers the four required topics", async () => {
  const section = (await trainingSection()).toLowerCase();
  for (
    const topic of [
      "training data", // training-data production
      "observation", // key observations
      "continuous learning", // multi-node continuous learning
      "market feed", // the major market feeds
    ]
  ) {
    assert(
      section.includes(topic),
      `training section must cover "${topic}"`,
    );
  }
});

Deno.test("README training section names the major data providers", async () => {
  const section = await trainingSection();
  for (
    const provider of [
      "Alpha Vantage",
      "FRED", // Federal Reserve Economic Data
      "World Uncertainty Index",
    ]
  ) {
    assert(
      section.includes(provider),
      `training section must name the "${provider}" data provider`,
    );
  }
});

Deno.test("README training section names the major exchanges", async () => {
  const section = await trainingSection();
  for (const exchange of ["NYSE", "NASDAQ", "ASX"]) {
    assert(
      section.includes(exchange),
      `training section must name the "${exchange}" exchange`,
    );
  }
});

Deno.test("README training section references the public NEAT-AI repositories", async () => {
  const section = await trainingSection();
  for (
    const repo of [
      "NEAT-AI",
      "NEAT-AI-core",
      "NEAT-AI-Discovery",
      "NEAT-AI-scorer",
    ]
  ) {
    assert(
      section.includes(repo),
      `training section must reference the public "${repo}" repository`,
    );
  }
});

Deno.test("README training section explains the fitness score formula", async () => {
  const section = (await trainingSection()).toLowerCase();
  // The scorer emits fitness = 1 − error − complexityPenalty − versionPenalty.
  assert(
    section.includes("fitness"),
    "training section must describe the fitness score",
  );
  assert(
    section.includes("complexity") && section.includes("version"),
    "training section must mention the complexity and version penalties",
  );
});

Deno.test("README training section includes a Mermaid diagram", async () => {
  const section = await trainingSection();
  assert(
    section.includes("```mermaid"),
    "training section must include a Mermaid diagram",
  );
});
