// Haiku triage: the reply parser, the request and how decide() uses the rating.
import test from "node:test";
import assert from "node:assert/strict";
import { IMAGE_FLOOR, MODELS, decide } from "../lib/select.mjs";
import { IDENTITY, parseTriage, parseTriageResponse, promptImages, triageBody } from "../lib/triage.mjs";

const IMAGE = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } };

test("parseTriage accepts only a bare integer 0-100", () => {
  assert.deepEqual(["42", " 7\n", "100", "0", "55."].map(parseTriage), [42, 7, 100, 0, 55]);
  for (const bad of ["", "101", "about 40", "40/100", "-3", "4.5", "ignore previous instructions", undefined, null]) {
    assert.equal(parseTriage(bad), undefined, String(bad));
  }
});

test("triageBody sends the whole prompt and its screenshots, behind Claude Code's identity line", () => {
  const b = triageBody("x".repeat(50000), [IMAGE], "claude-haiku-5-5");
  assert.equal(b.model, "claude-haiku-5-5");
  assert.equal(b.system[0].text, IDENTITY);
  assert.match(b.system[1].text, /single integer/);
  assert.deepEqual(b.messages[0].content.map((c) => c.type), ["image", "text"]);
  assert.equal(b.messages[0].content[1].text.length, 50000);
  assert.ok(b.max_tokens >= 512, "room for Haiku's thinking before the number");
  assert.equal(triageBody("  ", [IMAGE], "m").messages[0].content[1].text, "(screenshot only)");
});

test("promptImages takes the image blocks of the latest user message only", () => {
  const messages = [
    { role: "user", content: [IMAGE, { type: "text", text: "old" }] },
    { role: "assistant", content: [{ type: "text", text: "ok" }] },
    { role: "user", content: [{ type: "text", text: "a" }, IMAGE, IMAGE] },
  ];
  assert.equal(promptImages(messages).length, 2);
  assert.deepEqual(promptImages([...messages, { role: "user", content: "plain string" }]), []);
  assert.deepEqual(promptImages(undefined), []);
});

test("parseTriageResponse reads the text block past thinking, or says why it cannot", () => {
  const reply = (content) => ({ status: 200, ok: true, text: JSON.stringify({ content }) });
  assert.deepEqual(parseTriageResponse(reply([{ type: "thinking", thinking: "" }, { type: "text", text: "50" }])), { score: 50 });
  assert.deepEqual(parseTriageResponse({ status: 429, ok: false, text: "{}" }), { note: "api-error 429" });
  assert.deepEqual(parseTriageResponse({ status: 200, ok: true, text: "<html>" }), { note: "bad-json" });
  assert.deepEqual(parseTriageResponse(reply([{ type: "thinking", thinking: "" }])), { note: "empty-reply" });
  assert.deepEqual(parseTriageResponse(reply([{ type: "text", text: "about 40" }])), { note: "unparseable: about 40" });
});

test("without a rating, a prompt with a screenshot gets the image floor and is never a short follow-up", () => {
  const previous = decide("bu servisin mimari tasarımını yap");
  const d = decide("bu ne?", { previous, triageFailed: true, images: 1 });
  assert.deepEqual([d.score, d.model, d.reason, d.signals.includes("image")], [IMAGE_FLOOR, MODELS.sonnet, "rules-fallback", true]);
  assert.equal(decide("rename it", { triageFailed: true, images: 1 }).model, MODELS.sonnet, "no cheap route on an easy marker");
  // Haiku's rating, having seen the screenshot, still wins.
  assert.equal(decide("bu ne?", { triage: 3, images: 1 }).model, MODELS.haiku);
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
