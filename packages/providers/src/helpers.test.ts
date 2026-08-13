import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkByCount,
  isRetryableStatus,
  joinUrl,
  knownEmbeddingDims,
  parseProviderId,
  providerId,
  retryDelays,
} from "./helpers.ts";

test("provider ids round-trip", () => {
  assert.equal(providerId("ollama", "nomic-embed-text"), "ollama:nomic-embed-text");
  assert.deepEqual(parseProviderId("openai:text-embedding-3-small"), {
    provider: "openai",
    model: "text-embedding-3-small",
  });
});

test("known dimensions include required defaults", () => {
  assert.equal(knownEmbeddingDims("ollama", "nomic-embed-text"), 768);
  assert.equal(knownEmbeddingDims("openai", "text-embedding-3-small"), 1536);
  assert.equal(knownEmbeddingDims("voyage", "voyage-3"), 1024);
});

test("chunking handles noUncheckedIndexedAccess-safe batches", () => {
  assert.deepEqual(chunkByCount([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkByCount([], 2), []);
  assert.throws(() => chunkByCount([1], 0), /positive integer/);
});

test("retry helpers classify transient failures", () => {
  assert.deepEqual(retryDelays(4, 100, 250), [100, 200, 250, 250]);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
});

test("joinUrl avoids duplicate slashes", () => {
  assert.equal(joinUrl("http://localhost:11434/", "/api/embed"), "http://localhost:11434/api/embed");
});
