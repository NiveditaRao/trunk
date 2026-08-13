import assert from "node:assert/strict";
import test from "node:test";
import { isVisibleToBranch, type RecallScopeMemory } from "./scope.ts";

function visible(memory: RecallScopeMemory, branchId = "br_a"): boolean {
  return isVisibleToBranch(memory, branchId);
}

test("active trunk facts are visible to every branch", () => {
  assert.equal(visible({ kind: "fact", scope: "trunk", superseded_by: null }), true);
  assert.equal(
    visible({ kind: "fact", scope: "trunk", superseded_by: null }, "br_b"),
    true,
  );
});

test("branch hypotheses are visible only to the exact owning branch", () => {
  assert.equal(
    visible({ kind: "hypothesis", scope: "br_a", superseded_by: null }, "br_a"),
    true,
  );
  assert.equal(
    visible({ kind: "hypothesis", scope: "br_a", superseded_by: null }, "br_b"),
    false,
  );
});

test("branch id prefix and substring collisions do not leak", () => {
  const memory = { kind: "hypothesis" as const, scope: "branch-12", superseded_by: null };
  assert.equal(visible(memory, "branch-1"), false);
  assert.equal(visible(memory, "12"), false);
  assert.equal(visible(memory, "branch-12-extra"), false);
  assert.equal(visible(memory, "branch-12"), true);
});

test("literal trunk branch name cannot see trunk-scoped hypotheses", () => {
  assert.equal(
    visible({ kind: "hypothesis", scope: "trunk", superseded_by: null }, "trunk"),
    false,
  );
  assert.equal(visible({ kind: "fact", scope: "trunk", superseded_by: null }, "trunk"), true);
});

test("empty or missing scopes are never visible", () => {
  assert.equal(visible({ kind: "fact", scope: "", superseded_by: null }), false);
  assert.equal(visible({ kind: "hypothesis", scope: "", superseded_by: null }), false);
  assert.equal(visible({ kind: "fact", superseded_by: null }), false);
  assert.equal(visible({ kind: "hypothesis", superseded_by: null }), false);
});

test("superseded memories are hidden regardless of kind or scope", () => {
  assert.equal(visible({ kind: "fact", scope: "trunk", superseded_by: "new" }), false);
  assert.equal(visible({ kind: "hypothesis", scope: "br_a", superseded_by: "new" }), false);
});
