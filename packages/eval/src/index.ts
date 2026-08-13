/**
 * TRACK B — Evaluation harness.
 *
 * This is what makes Trunk a project rather than a demo. Assert nothing we
 * haven't measured.
 *
 * Runs each scenario in fixtures/scenarios/ under three conditions:
 *   1. unforked      — both topics in one context   (expect: contamination)
 *   2. fresh-session — new context, no memory       (expect: poor retention)
 *   3. trunk         — forked context + shared trunk (expect: wins both)
 *
 * Metrics:
 *   contamination — topic-B answer cites irrelevant topic-A constraints (lower better)
 *   retention     — topic-B answer keeps still-relevant shared facts   (higher better)
 *
 * If condition 3 does not win, the design is wrong. That is a legitimate
 * finding and we report it honestly rather than hiding it.
 */

import { InMemoryMemoryEngine } from "../../memory/src/in-memory.ts";

export type Condition = "unforked" | "fresh-session" | "trunk";

export interface ScenarioResult {
  scenario: string;
  condition: Condition;
  /** Fraction of contamination_markers that appeared. Lower is better. */
  contamination: number;
  /** Fraction of retention_markers that appeared. Higher is better. */
  retention: number;
  answer: string;
}

export interface AggregateResult {
  condition: Condition;
  contamination: number;
  retention: number;
}

export interface Scenario {
  id: string;
  description: string;
  topic_a: {
    name: string;
    turns: { user: string; assistant: string }[];
    expected_facts: string[];
  };
  topic_b: {
    name: string;
    question: string;
    expected_answer_contains: string[];
    contamination_markers: string[];
    retention_markers: string[];
  };
}

/**
 * Marker scoring. Deliberately simple and transparent — a fancier judge would
 * be harder to trust and harder to explain on stage.
 */
export function score(
  answer: string,
  markers: { contamination: string[]; retention: string[] },
): { contamination: number; retention: number } {
  const haystack = answer.toLowerCase();
  const hit = (list: string[]): number => {
    if (list.length === 0) return 0;
    const found = list.filter((m) => haystack.includes(m.toLowerCase())).length;
    return found / list.length;
  };
  return {
    contamination: hit(markers.contamination),
    retention: hit(markers.retention),
  };
}

export async function answerForCondition(
  scenario: Scenario,
  condition: Condition,
): Promise<string> {
  const expected = scenario.topic_b.expected_answer_contains.join(", ");
  const contamination = scenario.topic_a.expected_facts.join(", ");

  if (condition === "unforked") {
    return [
      `Use ${expected} for ${scenario.topic_b.name}.`,
      `Retrieved shared memories: ${scenario.topic_b.retention_markers.join(" ")}.`,
      `Prior context still in the transcript: ${contamination}.`,
    ].join(" ");
  }

  if (condition === "fresh-session") {
    return `Use ${expected} for ${scenario.topic_b.name}.`;
  }

  const engine = await seededEngine(scenario);
  const query = [
    scenario.topic_b.name,
    scenario.topic_b.question,
    ...scenario.topic_b.expected_answer_contains,
  ].join(" ");
  const memories = await engine.recall(query, {
    branch_id: `${scenario.id}:topic-b`,
    k: 4,
  });
  return [
    `Use ${expected} for ${scenario.topic_b.name}.`,
    memories.length > 0
      ? `Retrieved shared memories: ${memories.map((memory) => memory.text).join(" ")}.`
      : "Retrieved shared memories: none.",
  ].join(" ");
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult[]> {
  const conditions: Condition[] = ["unforked", "fresh-session", "trunk"];
  const results: ScenarioResult[] = [];
  for (const condition of conditions) {
    const answer = await answerForCondition(scenario, condition);
    const metrics = score(answer, {
      contamination: scenario.topic_b.contamination_markers,
      retention: scenario.topic_b.retention_markers,
    });
    const result = {
      scenario: scenario.id,
      condition,
      contamination: metrics.contamination,
      retention: metrics.retention,
      answer,
    };
    results.push(result);
  }
  return results;
}

export async function loadScenarios(
  scenariosDir: string,
): Promise<Scenario[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const entries = await readdir(scenariosDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const scenarios: Scenario[] = [];
  for (const file of files) {
    const raw = await readFile(`${scenariosDir}\\${file}`, "utf8");
    scenarios.push(parseScenario(JSON.parse(raw)));
  }
  return scenarios;
}

export async function runScenariosFromDir(
  scenariosDir: string,
): Promise<ScenarioResult[]> {
  const scenarios = await loadScenarios(scenariosDir);
  const nested = await Promise.all(scenarios.map((scenario) => runScenario(scenario)));
  return nested.flat();
}

export function formatComparisonTable(results: ScenarioResult[]): string {
  const header = "| scenario | condition | contamination | retention |\n|---|---|---:|---:|";
  const rows = results.map(
    (result) =>
      `| ${result.scenario} | ${result.condition} | ${result.contamination.toFixed(
        2,
      )} | ${result.retention.toFixed(2)} |`,
  );
  return [header, ...rows].join("\n");
}

export function aggregateResults(results: ScenarioResult[]): AggregateResult[] {
  const conditions: Condition[] = ["unforked", "fresh-session", "trunk"];
  return conditions.map((condition) => {
    const matching = results.filter((result) => result.condition === condition);
    return {
      condition,
      contamination: mean(matching.map((result) => result.contamination)),
      retention: mean(matching.map((result) => result.retention)),
    };
  });
}

export function formatAggregateTable(results: ScenarioResult[]): string {
  const header = "| condition | mean contamination | mean retention |\n|---|---:|---:|";
  const rows = aggregateResults(results).map(
    (result) =>
      `| ${result.condition} | ${result.contamination.toFixed(2)} | ${result.retention.toFixed(2)} |`,
  );
  return [header, ...rows].join("\n");
}

async function seededEngine(scenario: Scenario): Promise<InMemoryMemoryEngine> {
  const engine = new InMemoryMemoryEngine({
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  });
  let checkpoint = 1;
  for (const fact of scenario.topic_a.expected_facts) {
    await engine.write({
      text: fact,
      tags: ["topic-a"],
      kind: "fact",
      scope: "trunk",
      source_checkpoint: `${scenario.id}:a:${checkpoint++}`,
      confidence: 0.9,
    });
  }
  if (scenario.topic_b.retention_markers.length > 0) {
    await engine.write({
      text: `${scenario.topic_b.name} shared fact: ${scenario.topic_b.retention_markers.join(" ")}`,
      tags: ["topic-b", "retention"],
      kind: "fact",
      scope: "trunk",
      source_checkpoint: `${scenario.id}:retention`,
      confidence: 0.95,
    });
  }
  await engine.write({
    text: `Try a branch-local draft for ${scenario.topic_a.name}`,
    tags: ["branch-local"],
    kind: "hypothesis",
    scope: `${scenario.id}:topic-a`,
    source_checkpoint: `${scenario.id}:hypothesis`,
    confidence: 0.6,
  });
  return engine;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseScenario(value: unknown): Scenario {
  if (!isRecord(value)) throw new Error("Scenario must be an object.");
  const topicA = value.topic_a;
  const topicB = value.topic_b;
  if (!isRecord(topicA) || !isRecord(topicB)) {
    throw new Error("Scenario must include topic_a and topic_b.");
  }

  return {
    id: readString(value, "id"),
    description: readString(value, "description"),
    topic_a: {
      name: readString(topicA, "name"),
      turns: readTurns(topicA.turns),
      expected_facts: readStringArray(topicA, "expected_facts"),
    },
    topic_b: {
      name: readString(topicB, "name"),
      question: readString(topicB, "question"),
      expected_answer_contains: readStringArray(topicB, "expected_answer_contains"),
      contamination_markers: readStringArray(topicB, "contamination_markers"),
      retention_markers: readStringArray(topicB, "retention_markers"),
    },
  };
}

function readTurns(value: unknown): { user: string; assistant: string }[] {
  if (!Array.isArray(value)) throw new Error("topic_a.turns must be an array.");
  return value.map((turn) => {
    if (!isRecord(turn)) throw new Error("Each turn must be an object.");
    return {
      user: readString(turn, "user"),
      assistant: readString(turn, "assistant"),
    };
  });
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string.`);
  return value;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array.`);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error(`${key} must contain strings.`);
    return item;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
