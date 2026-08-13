import assert from "node:assert/strict";
import { test } from "node:test";
import type { Checkpoint } from "@trunk/core";
import { distillBrief, orderCheckpoints } from "./brief.ts";

function checkpoint(id: string, summary: string, ts: string): Checkpoint {
  return {
    _id: id,
    branch_id: "br_main",
    parent_id: null,
    label: null,
    summary,
    ts: new Date(ts),
  };
}

test("orderCheckpoints sorts checkpoints chronologically", () => {
  const checkpoints = [
    checkpoint("cp_2", "second", "2026-08-13T18:02:00.000Z"),
    checkpoint("cp_1", "first", "2026-08-13T18:01:00.000Z"),
  ];

  assert.deepEqual(
    orderCheckpoints(checkpoints).map((item) => item._id),
    ["cp_1", "cp_2"],
  );
});

test("distillBrief renders a concise resume brief in ancestry order", () => {
  const checkpoints = [
    checkpoint("cp_2", "second", "2026-08-13T18:02:00.000Z"),
    checkpoint("cp_1", "first", "2026-08-13T18:01:00.000Z"),
  ];

  assert.match(
    distillBrief({ topic: "Checkout", checkpoints }),
    /Branch topic: Checkout\nRelevant checkpoint path:\n- first\n- second/,
  );
});

test("distillBrief returns an actionable empty-history brief", () => {
  assert.match(
    distillBrief({ topic: "New branch", checkpoints: [] }),
    /No checkpoints exist yet for "New branch"/,
  );
});

test("distillBrief condenses older checkpoints when history is long", () => {
  const checkpoints = Array.from({ length: 10 }, (_, index) =>
    checkpoint(
      `cp_${index + 1}`,
      `summary ${index + 1}`,
      `2026-08-13T18:${String(index).padStart(2, "0")}:00.000Z`,
    ),
  );

  const brief = distillBrief({ topic: "Long branch", checkpoints });
  assert.match(brief, /Earlier path condensed from 2 checkpoint\(s\)/);
  assert.doesNotMatch(brief, /- summary 1\n/);
  assert.match(brief, /summary 10/);
});
