import assert from "node:assert/strict";
import { test } from "node:test";
import type { Checkpoint } from "@trunk/core";
import { buildAncestryPath } from "./ancestry.ts";

function checkpoint(id: string, parent: string | null): Checkpoint {
  return {
    _id: id,
    branch_id: "br_main",
    parent_id: parent,
    label: null,
    summary: id,
    ts: new Date("2026-08-13T18:00:00.000Z"),
  };
}

test("buildAncestryPath walks parent pointers from root to leaf", () => {
  const path = buildAncestryPath(
    [
      checkpoint("cp_3", "cp_2"),
      checkpoint("cp_1", null),
      checkpoint("cp_2", "cp_1"),
    ],
    "cp_3",
  );

  assert.deepEqual(
    path.map((item) => item._id),
    ["cp_1", "cp_2", "cp_3"],
  );
});

test("buildAncestryPath returns a single root checkpoint", () => {
  const path = buildAncestryPath([checkpoint("cp_1", null)], "cp_1");
  assert.deepEqual(
    path.map((item) => item._id),
    ["cp_1"],
  );
});

test("buildAncestryPath rejects cycles instead of looping forever", () => {
  assert.throws(
    () =>
      buildAncestryPath(
        [checkpoint("cp_1", "cp_2"), checkpoint("cp_2", "cp_1")],
        "cp_1",
      ),
    /cycle/,
  );
});

test("buildAncestryPath reports missing parent links", () => {
  assert.throws(
    () => buildAncestryPath([checkpoint("cp_2", "cp_missing")], "cp_2"),
    /Missing checkpoint/,
  );
});
