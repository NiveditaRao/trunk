import assert from "node:assert/strict";
import { test } from "node:test";
import type { Checkpoint, Memory } from "@trunk/core";
import {
  branchResponse,
  graphResponse,
  memoriesResponse,
  parseBranchRequest,
  shapeStreamEvent,
} from "./api-contract.ts";

const checkpoint: Checkpoint = {
  _id: "cp_1",
  branch_id: "br_main",
  parent_id: null,
  label: null,
  summary: "First turn",
  ts: new Date("2026-08-13T18:00:00.000Z"),
};

const memory: Memory = {
  _id: "mem_1",
  text: "MongoDB change streams power live dashboard updates.",
  embedding: [],
  tags: ["dashboard"],
  kind: "fact",
  scope: "trunk",
  source_checkpoint: "cp_1",
  confidence: 1,
  valid_from: new Date("2026-08-13T18:00:00.000Z"),
  superseded_by: null,
};

test("graphResponse returns the dashboard graph shape", () => {
  assert.deepEqual(graphResponse({ branches: [], checkpoints: [checkpoint] }), {
    branches: [],
    checkpoints: [checkpoint],
  });
});

test("memoriesResponse returns the dashboard memory shape", () => {
  assert.deepEqual(memoriesResponse([memory]), { memories: [memory] });
});

test("parseBranchRequest accepts the click-to-branch body", () => {
  assert.deepEqual(
    parseBranchRequest({ checkpoint_id: "cp_1", topic: "New checkout flow" }),
    { checkpoint_id: "cp_1", topic: "New checkout flow" },
  );
});

test("parseBranchRequest rejects missing or blank fields", () => {
  assert.throws(() => parseBranchRequest({ checkpoint_id: "cp_1", topic: "" }));
  assert.throws(() => parseBranchRequest({ topic: "Missing checkpoint" }));
});

test("branchResponse omits the MCP graph field", () => {
  assert.deepEqual(
    branchResponse({
      branch_id: "br_1",
      name: "checkout",
      resume_command: 'resume("br_1")',
    }),
    {
      branch_id: "br_1",
      name: "checkout",
      resume_command: 'resume("br_1")',
    },
  );
});

test("shapeStreamEvent wraps checkpoint and memory change documents", () => {
  assert.deepEqual(shapeStreamEvent("checkpoint", checkpoint), {
    type: "checkpoint",
    doc: checkpoint,
  });
  assert.deepEqual(shapeStreamEvent("memory", memory), { type: "memory", doc: memory });
  assert.equal(shapeStreamEvent("memory", null), null);
});
