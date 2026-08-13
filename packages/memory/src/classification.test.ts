import assert from "node:assert/strict";
import test from "node:test";
import { classifyMemoryText } from "./classification.ts";

test("verified system properties classify as facts", () => {
  assert.equal(
    classifyMemoryText("Prices are stored in cents as integers, never as floats").kind,
    "fact",
  );
});

test("assumptions and proposals classify as hypotheses", () => {
  assert.equal(
    classifyMemoryText("Assume for now that checkout will migrate to Redis").kind,
    "hypothesis",
  );
  assert.equal(
    classifyMemoryText("Try a token bucket with a 100 req/min ceiling per API key").kind,
    "hypothesis",
  );
});

test("ambiguous memories default to hypothesis", () => {
  assert.equal(classifyMemoryText("Pricing service migration").kind, "hypothesis");
});
