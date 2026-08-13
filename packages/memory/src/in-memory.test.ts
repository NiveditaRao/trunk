import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryMemoryEngine } from "./in-memory.ts";

test("recall returns trunk facts and only the calling branch's hypotheses", async () => {
  const engine = new InMemoryMemoryEngine({
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  });
  await engine.write({
    text: "The deployed cache is Redis 7 running in cluster mode",
    tags: ["redis"],
    kind: "fact",
    scope: "trunk",
    source_checkpoint: "cp_fact",
    confidence: 0.9,
  });
  await engine.write({
    text: "Try a token bucket with burst size 50",
    tags: ["rate-limit"],
    kind: "hypothesis",
    scope: "branch-a",
    source_checkpoint: "cp_a",
    confidence: 0.6,
  });
  await engine.write({
    text: "Try a sliding window with burst size 20",
    tags: ["rate-limit"],
    kind: "hypothesis",
    scope: "branch-b",
    source_checkpoint: "cp_b",
    confidence: 0.6,
  });

  const recalled = await engine.recall("redis token bucket burst", {
    branch_id: "branch-a",
    k: 10,
  });
  assert.match(recalled.map((memory) => memory.text).join("\n"), /Redis 7/);
  assert.match(recalled.map((memory) => memory.text).join("\n"), /token bucket/);
  assert.doesNotMatch(
    recalled.map((memory) => memory.text).join("\n"),
    /sliding window/,
  );
});

test("duplicate facts reinforce and contradictory facts supersede", async () => {
  const engine = new InMemoryMemoryEngine();
  const first = await engine.write({
    text: "Prices are stored in cents",
    tags: ["pricing"],
    kind: "fact",
    scope: "trunk",
    source_checkpoint: "cp_1",
    confidence: 0.6,
  });
  const duplicate = await engine.write({
    text: "Prices are stored in cents",
    tags: ["checkout"],
    kind: "fact",
    scope: "trunk",
    source_checkpoint: "cp_2",
    confidence: 0.8,
  });
  assert.equal(duplicate, first);
  assert.equal(engine.snapshot().length, 1);
  assert.deepEqual(engine.snapshot()[0]?.tags, ["pricing", "checkout"]);

  const replacement = await engine.write({
    text: "Prices are stored in dollars",
    tags: ["pricing"],
    kind: "fact",
    scope: "trunk",
    source_checkpoint: "cp_3",
    confidence: 0.9,
  });
  const memories = engine.snapshot();
  assert.equal(memories.length, 2);
  assert.equal(memories.find((memory) => memory._id === first)?.superseded_by, replacement);
});

test("promotion is explicit and makes a branch hypothesis visible as trunk fact", async () => {
  const engine = new InMemoryMemoryEngine();
  const id = await engine.write({
    text: "The fraud service supports idempotency keys",
    tags: ["fraud"],
    kind: "hypothesis",
    scope: "branch-a",
    source_checkpoint: "cp_1",
    confidence: 0.7,
  });

  assert.equal(
    (await engine.recall("fraud idempotency", { branch_id: "branch-b", k: 5 })).length,
    0,
  );
  await engine.promote(id);
  assert.equal(
    (await engine.recall("fraud idempotency", { branch_id: "branch-b", k: 5 })).length,
    1,
  );
});
