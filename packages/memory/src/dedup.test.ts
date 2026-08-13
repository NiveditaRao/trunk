import assert from "node:assert/strict";
import test from "node:test";
import {
  decideDedup,
  inferContradiction,
  reinforceConfidence,
  REINFORCE_SIMILARITY_THRESHOLD,
  SUPERSESSION_PREFILTER_THRESHOLD,
  type DedupCandidate,
  type ExistingMemoryForDedup,
} from "./dedup.ts";

const candidate: DedupCandidate = {
  text: "Prices are stored in cents",
  tags: ["prices"],
  kind: "fact",
  scope: "trunk",
  confidence: 0.8,
};

function neighbour(
  overrides: Partial<ExistingMemoryForDedup>,
): ExistingMemoryForDedup {
  return {
    _id: "mem_old",
    text: "Prices are stored in cents",
    tags: ["prices"],
    kind: "fact",
    scope: "trunk",
    confidence: 0.6,
    superseded_by: null,
    similarity: 1,
    ...overrides,
  };
}

test("exact duplicates reinforce instead of inserting another row", () => {
  assert.deepEqual(decideDedup(candidate, [neighbour({})]), {
    action: "reinforce",
    id: "mem_old",
    confidence: 0.68,
  });
});

test("safe near-duplicates reinforce at the documented threshold", () => {
  const decision = decideDedup(candidate, [
    neighbour({
      text: "Prices are in cents",
      similarity: REINFORCE_SIMILARITY_THRESHOLD,
    }),
  ]);
  assert.equal(decision.action, "reinforce");
});

test("near-duplicates below the reinforcement threshold insert", () => {
  assert.deepEqual(
    decideDedup(candidate, [
      neighbour({
        text: "Prices are in cents",
        similarity: REINFORCE_SIMILARITY_THRESHOLD - 0.001,
      }),
    ]),
    { action: "insert" },
  );
});

test("compatible refinements are not collapsed just because embeddings are close", () => {
  assert.deepEqual(
    decideDedup(candidate, [
      neighbour({
        text: "Prices are integers",
        similarity: 0.95,
      }),
    ]),
    { action: "insert" },
  );
});

test("contradicting facts supersede at the documented threshold", () => {
  assert.deepEqual(
    decideDedup(candidate, [
      neighbour({
        text: "Prices are stored in dollars",
        similarity: SUPERSESSION_PREFILTER_THRESHOLD,
      }),
    ]),
    { action: "supersede", supersededId: "mem_old" },
  );
});

test("contradictions below the supersession prefilter do not destroy facts", () => {
  assert.deepEqual(
    decideDedup(candidate, [
      neighbour({
        text: "Prices are stored in dollars",
        similarity: SUPERSESSION_PREFILTER_THRESHOLD - 0.001,
      }),
    ]),
    { action: "insert" },
  );
});

test("uncertain high-similarity facts are kept and flagged", () => {
  assert.deepEqual(
    decideDedup(candidate, [
      neighbour({
        _id: "mem_uncertain",
        text: "Billing amounts use minor units",
        similarity: 0.8,
        contradiction: "unknown",
      }),
    ]),
    { action: "insert", flaggedIds: ["mem_uncertain"] },
  );
});

test("low-similarity unrelated facts insert without flags", () => {
  assert.deepEqual(
    decideDedup(candidate, [
      neighbour({
        text: "Rate limits use token buckets",
        similarity: 0.2,
        contradiction: "unknown",
      }),
    ]),
    { action: "insert" },
  );
});

test("superseded and differently scoped memories are ignored", () => {
  assert.deepEqual(
    decideDedup(candidate, [
      neighbour({ superseded_by: "newer" }),
      neighbour({ scope: "branch-a", kind: "hypothesis" }),
    ]),
    { action: "insert" },
  );
});

test("confidence reinforcement is damped and capped", () => {
  assert.equal(reinforceConfidence(0.6, 0.8), 0.68);
  assert.equal(reinforceConfidence(0.99, 1), 0.9925);
  assert.equal(reinforceConfidence(1, 1), 1);
});

test("contradiction inference distinguishes conflicts from compatible facts", () => {
  assert.equal(
    inferContradiction("Prices are stored in cents", "Prices are stored in dollars"),
    "contradicts",
  );
  assert.equal(
    inferContradiction("Redis is enabled", "Redis is not enabled"),
    "contradicts",
  );
  assert.equal(
    inferContradiction("Prices are stored in cents", "Prices are integers"),
    "compatible",
  );
});
