import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestDivergence } from "./divergence.ts";

test("suggestDivergence stays silent when recent turns match the branch topic", () => {
  const suggestion = suggestDivergence({
    branchTopic: "MongoDB change stream dashboard updates",
    recentTurns: [
      "Let's wire the dashboard to MongoDB change streams.",
      "Checkpoint and memory updates should stream to connected clients.",
    ],
  });

  assert.equal(suggestion.shouldSuggest, false);
});

test("suggestDivergence stays silent for sparse evidence", () => {
  const suggestion = suggestDivergence({
    branchTopic: "MongoDB change stream dashboard updates",
    recentTurns: ["ok"],
  });

  assert.equal(suggestion.shouldSuggest, false);
  assert.equal(suggestion.confidence, 0);
});

test("suggestDivergence suggests only on strong topic drift", () => {
  const suggestion = suggestDivergence({
    branchTopic: "MongoDB change stream dashboard updates",
    recentTurns: [
      "Let's design OAuth consent screens, refresh tokens, redirect URLs, scopes, and session cookies.",
      "The login flow needs account linking, tenant selection, and browser callbacks.",
    ],
  });

  assert.equal(suggestion.shouldSuggest, true);
  assert.ok(suggestion.confidence >= 0.78);
  assert.match(suggestion.reason ?? "", /Consider forking/);
});
