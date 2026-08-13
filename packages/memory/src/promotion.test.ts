import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPromotable,
  promotionTags,
  type PromotableMemory,
} from "./promotion.ts";

const hypothesis: PromotableMemory = {
  _id: "hyp",
  kind: "hypothesis",
  scope: "branch-a",
  tags: ["prices", " "],
  source_checkpoint: "cp_1",
  superseded_by: null,
};

test("promotion guards reject already-trunk and superseded memories", () => {
  assert.doesNotThrow(() => assertPromotable(hypothesis, "hyp"));
  assert.throws(
    () => assertPromotable({ ...hypothesis, kind: "fact", scope: "trunk" }, "fact"),
    /already trunk-scoped/,
  );
  assert.throws(
    () => assertPromotable({ ...hypothesis, superseded_by: "new" }, "old"),
    /superseded/,
  );
});

test("promotion tags preserve branch-hypothesis provenance", () => {
  assert.deepEqual(promotionTags(hypothesis), [
    "prices",
    "provenance:promoted-from-hypothesis",
    "provenance:source-branch:branch-a",
    "provenance:source-checkpoint:cp_1",
  ]);
});
