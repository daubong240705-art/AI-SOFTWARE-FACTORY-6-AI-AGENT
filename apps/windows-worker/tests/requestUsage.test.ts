import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRequestUsage } from "../src/lib/formatRequestUsage";

test("formatRequestUsage renders used and limit", () => {
  assert.equal(formatRequestUsage(3, 40), "3/40 request");
});

test("formatRequestUsage renders zero usage", () => {
  assert.equal(formatRequestUsage(0, 40), "0/40 request");
});

test("formatRequestUsage does not clamp over-budget usage", () => {
  assert.equal(formatRequestUsage(41, 40), "41/40 request");
});

test("formatRequestUsage normalises negative used and zero limit", () => {
  assert.equal(formatRequestUsage(-1, 0), "0/1 request");
});

test("formatRequestUsage floors fractional values", () => {
  assert.equal(formatRequestUsage(2.9, 40.9), "2/40 request");
});

test("formatRequestUsage handles non-finite values", () => {
  assert.equal(formatRequestUsage(NaN, Infinity), "0/1 request");
});
