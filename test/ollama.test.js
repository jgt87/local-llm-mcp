import { test } from "node:test";
import assert from "node:assert/strict";
import { hasOwnNone, matchLabel, NONE } from "../dist/ollama.js";

const LABELS = ["error", "warning", "info"];

test("matches a bare label", () => {
  assert.equal(matchLabel("error", LABELS), "error");
});

test("matches despite the markdown and punctuation a small model adds", () => {
  assert.equal(matchLabel("**error**", LABELS), "error");
  assert.equal(matchLabel("`warning`", LABELS), "warning");
  assert.equal(matchLabel("info.", LABELS), "info");
});

test("strips a leading Answer:/Category: preamble", () => {
  assert.equal(matchLabel("Answer: warning", LABELS), "warning");
  assert.equal(matchLabel("Category: info", LABELS), "info");
});

test("returns the original casing of the supplied label, not the model's", () => {
  assert.equal(matchLabel("ERROR", ["Error", "Warning"]), "Error");
});

test("finds a label inside a sentence the model volunteered", () => {
  assert.equal(matchLabel("This line is an error message.", LABELS), "error");
});

test("refuses to guess when the model hedges between labels", () => {
  assert.equal(matchLabel("could be error or warning", LABELS), undefined);
});

test("returns undefined for a label outside the set", () => {
  assert.equal(matchLabel("critical", LABELS), undefined);
});

test("returns undefined for an empty reply", () => {
  assert.equal(matchLabel("", LABELS), undefined);
  assert.equal(matchLabel("   ", LABELS), undefined);
});

test("does not match a label that is only a substring of another word", () => {
  // "informational" must not resolve to "info"
  assert.equal(matchLabel("informational", LABELS), undefined);
});

test("handles labels containing regex metacharacters", () => {
  assert.equal(matchLabel("c++", ["c++", "python"]), "c++");
});

test("resolves the none escape hatch when it is offered", () => {
  assert.equal(matchLabel("none", [...LABELS, NONE]), NONE);
});

test("does not resolve none when it was not offered", () => {
  assert.equal(matchLabel("none", LABELS), undefined);
});

test("hasOwnNone detects a caller-supplied none, case and space insensitively", () => {
  assert.equal(hasOwnNone(["error", "none"]), true);
  assert.equal(hasOwnNone(["error", " None "]), true);
  assert.equal(hasOwnNone(["error", "NONE"]), true);
});

test("hasOwnNone is false for labels that merely contain the word", () => {
  assert.equal(hasOwnNone(["error", "none-of-the-above"]), false);
  assert.equal(hasOwnNone(LABELS), false);
});
