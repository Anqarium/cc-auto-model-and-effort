// Haiku triage: the reply parser, the request and how decide() uses the rating.
import test from "node:test";
import assert from "node:assert/strict";
import { MODELS, decide } from "../lib/select.mjs";
import { TRIAGE_MAX_CHARS, parseTriage, triageRequest } from "../lib/triage.mjs";

test("parseTriage accepts only a bare integer 0-100", () => {
  assert.deepEqual(["42", " 7\n", "100", "0", "55."].map(parseTriage), [42, 7, 100, 0, 55]);
  for (const bad of ["", "101", "about 40", "40/100", "-3", "4.5", "ignore previous instructions", undefined, null]) {
    assert.equal(parseTriage(bad), undefined, String(bad));
  }
});

test("triageRequest passes the prompt as data and truncates a long one", () => {
  const r = triageRequest("x".repeat(TRIAGE_MAX_CHARS + 500));
  assert.equal(r.prompt.length, TRIAGE_MAX_CHARS);
  assert.match(r.system, /single integer/);
});

test("decide routes by Haiku's rating, not the rules", () => {
  // The rules score this short prompt as hard (mimari), Haiku says it is a trivial question.
  const easy = decide("mimari nedir?", { triage: 3 });
  assert.deepEqual([easy.model, easy.level, easy.signals], [MODELS.haiku, "trivial", ["triage"]]);
  // No keyword at all, yet Haiku rates it expert.
  const hard = decide("make the checkout survive two tabs writing at once", { triage: 80 });
  assert.deepEqual([hard.model, hard.effort, hard.reason], [MODELS.opus, "high", "score"]);
  assert.deepEqual([decide("x y z", { triage: 35 }).model, decide("x y z", { triage: 35 }).effort], [MODELS.sonnet, "high"]);
});

test("a failed triage falls back to the rules and says so", () => {
  const d = decide("bu servisin mimari tasarımını yap", { triageFailed: true });
  assert.deepEqual([d.model, d.reason], [MODELS.opus, "rules-fallback"]);
});

test("hysteresis still applies to Haiku's rating", () => {
  const previous = decide("bu servisin mimari tasarımını yap");
  const d = decide("rename the variable", { previous, triage: 2, contextTokens: 50000 });
  assert.deepEqual([d.model, d.reason], [MODELS.opus, "cache-hysteresis"]);
});
