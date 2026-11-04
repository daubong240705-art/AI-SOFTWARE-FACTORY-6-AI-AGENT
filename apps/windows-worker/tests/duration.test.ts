import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "../src/lib/formatDuration";

test("formatDuration renders sub-minute durations in seconds", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(999), "0s");
  assert.equal(formatDuration(1000), "1s");
});

test("formatDuration renders minute durations as Xm Ys", () => {
  assert.equal(formatDuration(61000), "1m 1s");
  assert.equal(formatDuration(3600000), "60m 0s");
});

test("formatDuration returns 0s for negative or non-finite input", () => {
  assert.equal(formatDuration(-1), "0s");
  assert.equal(formatDuration(NaN), "0s");
  assert.equal(formatDuration(Infinity), "0s");
});
