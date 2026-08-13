import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatComparisonTable,
  loadScenarios,
  runScenario,
  score,
  type Scenario,
} from "./index.ts";

const scenario: Scenario = {
  id: "demo",
  description: "demo scenario",
  topic_a: {
    name: "Checkout",
    turns: [],
    expected_facts: ["Prices are stored in cents", "snake_case schema"],
  },
  topic_b: {
    name: "Rate limiter",
    question: "Design one",
    expected_answer_contains: ["token bucket", "Redis"],
    contamination_markers: ["cents", "snake_case"],
    retention_markers: ["Redis 7", "cluster mode"],
  },
};

test("score is case-insensitive and reports fractions", () => {
  assert.deepEqual(
    score("Use REDIS 7 in cluster mode. Do not mention cents.", {
      contamination: ["cents", "checkout"],
      retention: ["redis 7", "cluster mode"],
    }),
    { contamination: 0.5, retention: 1 },
  );
});

test("score returns zero when marker lists are empty", () => {
  assert.deepEqual(score("anything", { contamination: [], retention: [] }), {
    contamination: 0,
    retention: 0,
  });
});

test("scenario harness compares unforked, fresh-session, and trunk", async () => {
  const results = await runScenario(scenario);
  const unforked = results.find((result) => result.condition === "unforked");
  const fresh = results.find((result) => result.condition === "fresh-session");
  const trunk = results.find((result) => result.condition === "trunk");

  assert.ok(unforked);
  assert.ok(fresh);
  assert.ok(trunk);
  assert.equal(unforked.contamination, 1);
  assert.equal(fresh.contamination, 0);
  assert.equal(fresh.retention, 0);
  assert.equal(trunk.contamination, 0);
  assert.equal(trunk.retention, 1);
});

test("comparison table includes transparent metrics", async () => {
  const table = formatComparisonTable(await runScenario(scenario));
  assert.match(table, /contamination/);
  assert.match(table, /retention/);
  assert.match(table, /trunk/);
});

test("loads real fixture scenarios", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const scenariosDir = resolve(here, "..", "..", "..", "fixtures", "scenarios");
  const scenarios = await loadScenarios(scenariosDir);
  assert.ok(scenarios.some((loaded) => loaded.id === "checkout-then-ratelimit"));
});
