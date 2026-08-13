import assert from "node:assert/strict";
import { test } from "node:test";
import { branchNameFromTopic, newId } from "./ids.ts";

test("branchNameFromTopic creates CLI-friendly branch names from topics", () => {
  assert.equal(
    branchNameFromTopic("Redesigning the API rate limiter!"),
    "redesigning-the-api-rate-limiter",
  );
});

test("branchNameFromTopic falls back when the topic has no usable characters", () => {
  assert.equal(branchNameFromTopic("???"), "branch");
});

test("branchNameFromTopic truncates long generated names", () => {
  assert.equal(
    branchNameFromTopic("abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz"),
    "abcdefghijklmnopqrstuvwxyz-abcde",
  );
});

test("newId prefixes generated ids", () => {
  const id = newId("cp");
  assert.match(id, /^cp_[0-9a-f-]+$/);
});
