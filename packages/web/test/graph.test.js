import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyStreamMessage, classifyMemories, computeLayout, findCrossBranchUses } from "../public/graph.js";

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../../../fixtures/${name}.json`, import.meta.url), "utf8"));
}

const branches = fixture("branches");
const checkpoints = fixture("checkpoints");
const memories = fixture("memories");

test("real fixture layout assigns stable lanes from DAG timestamps", () => {
  const layout = computeLayout({ branches, checkpoints });
  assert.equal(layout.lanes.get("br_main"), 0);
  assert.equal(layout.lanes.get("br_ratelimit"), 1);
  assert.equal(layout.nodeById.get("cp_005").parent_id, "cp_003");
  assert.equal(layout.nodeById.get("cp_005").isFork, true);
  assert.equal(layout.nodes.length, checkpoints.length);
  for (const checkpoint of checkpoints) {
    const node = layout.nodeById.get(checkpoint._id);
    assert.ok(Number.isFinite(node.x), `${checkpoint._id} has x`);
    assert.ok(Number.isFinite(node.y), `${checkpoint._id} has y`);
  }
});

test("layout handles empty checkpoints without crashing", () => {
  const layout = computeLayout({ branches, checkpoints: [] });
  assert.deepEqual(layout.nodes, []);
  assert.equal(layout.lanes.get("br_main"), 0);
  assert.ok(layout.height > 0);
});

test("a third branch gets a computed lane and fork edge", () => {
  const extraBranches = [
    ...branches,
    { _id: "br_experiment", name: "experiment", root_checkpoint: "cp_002", topic: "third lane", created_at: "2026-08-13T18:12:00.000Z" },
  ];
  const extraCheckpoints = [
    ...checkpoints,
    { _id: "cp_008", branch_id: "br_experiment", parent_id: "cp_002", label: null, summary: "Explore a third branch", ts: "2026-08-13T18:13:00.000Z" },
  ];
  const layout = computeLayout({ branches: extraBranches, checkpoints: extraCheckpoints });
  assert.equal(layout.lanes.get("br_main"), 0);
  assert.ok(layout.lanes.get("br_experiment") > 0);
  assert.equal(layout.nodeById.get("cp_008").isFork, true);
  assert.ok(layout.edges.some((edge) => edge.from === "cp_002" && edge.to === "cp_008" && edge.isFork));
});

test("branch hypotheses never enter the shared cross-lane fact category", () => {
  const groups = classifyMemories(memories, checkpoints);
  assert.ok(groups.sharedFacts.every((memory) => memory.kind === "fact" && memory.scope === "trunk"));
  assert.ok(groups.branchHypotheses.every((memory) => memory.kind === "hypothesis" && memory.scope !== "trunk"));
  assert.equal(groups.sharedFacts.some((memory) => memory.kind === "hypothesis"), false);
});

test("Redis trunk fact is detected as crossing from rate-limiter back to main", () => {
  const redis = memories.find((memory) => memory._id === "mem_004");
  const uses = findCrossBranchUses(redis, checkpoints);
  assert.deepEqual(uses.map((cp) => cp._id), ["cp_007"]);
});

test("stream reducer accepts out-of-order checkpoint events and infers the branch", () => {
  const result = applyStreamMessage({ branches: [], checkpoints: [], memories: [] }, {
    type: "checkpoint",
    doc: { _id: "cp_late", branch_id: "br_live", parent_id: "cp_missing", summary: "Live checkpoint", ts: "2026-08-13T19:00:00.000Z" },
  });

  assert.equal(result.changed, true);
  assert.equal(result.kind, "checkpoint");
  assert.equal(result.state.checkpoints[0]._id, "cp_late");
  assert.deepEqual(result.state.branches.map((branch) => branch._id), ["br_live"]);
  assert.equal(computeLayout(result.state).nodeById.get("cp_late").branchName, "br_live");
});

test("stream reducer ignores duplicate checkpoint events", () => {
  const current = { branches, checkpoints, memories };
  const duplicate = checkpoints[0];
  const result = applyStreamMessage(current, { type: "checkpoint", doc: duplicate });

  assert.equal(result.changed, false);
  assert.equal(result.state.checkpoints.length, checkpoints.length);
});

test("stream reducer upserts memories defensively and ignores unknown event types", () => {
  const current = { branches, checkpoints, memories: [] };
  const inserted = applyStreamMessage(current, {
    type: "memory",
    doc: { _id: "mem_live", text: "Live facts animate in", kind: "fact", scope: "trunk", source_checkpoint: "cp_002" },
  });
  const ignored = applyStreamMessage(inserted.state, { type: "toast", doc: { _id: "nope" } });
  const malformed = applyStreamMessage(inserted.state, { type: "memory", doc: { _id: "bad", kind: "fact" } });

  assert.equal(inserted.changed, true);
  assert.equal(inserted.state.memories[0].scope, "trunk");
  assert.equal(ignored.changed, false);
  assert.equal(malformed.changed, false);
  assert.equal(ignored.state.memories.length, 1);
});
