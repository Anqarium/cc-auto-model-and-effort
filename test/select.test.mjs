// decide(): the mod's (hooks/register.ts) decision logic. The mod runs without Node and the test kit cannot
// raise turn.step, so the logic is tested here directly.
import test from "node:test";
import assert from "node:assert/strict";
import { MODELS, SEED_IDS, decide, effortFor, effortToSend, learnModel, versionOf } from "../lib/select.mjs";

test("ultrathink: an incoming xhigh/max effort is kept, anything else takes the mod's choice", () => {
  assert.equal(effortToSend("xhigh", "medium"), "xhigh");
  assert.equal(effortToSend("max", "high"), "max");
  assert.equal(effortToSend("high", "medium"), "medium");
  assert.equal(effortToSend(undefined, "high"), "high");
});

test("model ids: versions parse, only a newer plain id is learned", () => {
  assert.deepEqual(["claude-opus-5-5", "claude-haiku-4-5-20251001", "claude-opus-4-20250514"].map(versionOf), [[5, 5], [4, 5], [4, 0]]);
  assert.equal(versionOf("claude-opus-5-5[1m]"), undefined);
  assert.equal(learnModel(SEED_IDS, "claude-opus-5-6").opus, "claude-opus-5-6");
  assert.equal(learnModel(SEED_IDS, "claude-opus-6-0").opus, "claude-opus-6-0");
  assert.equal(learnModel(SEED_IDS, "claude-opus-5-5"), SEED_IDS); // same version: unchanged
  assert.equal(learnModel(SEED_IDS, "claude-opus-4-1"), SEED_IDS); // older: ignored
  assert.equal(learnModel(SEED_IDS, "claude-opus-5-9[1m]"), SEED_IDS); // suffixed: ignored
  assert.equal(learnModel(SEED_IDS, "us.anthropic.claude-opus-5-9"), SEED_IDS); // provider id: ignored
});

test("effort bands: medium is wide, high only above the model's threshold, no low", () => {
  assert.equal(effortFor(MODELS.haiku, 100), "medium");
  assert.deepEqual([30, 31].map((s) => effortFor(MODELS.sonnet, s)), ["medium", "high"]);
  assert.deepEqual([41, 75, 76].map((s) => effortFor(MODELS.opus, s)), ["medium", "medium", "high"]);
  const moderate = decide("veri çekme kodunda race condition olabilir mi? incele"); // 27
  assert.deepEqual([moderate.model, moderate.effort], [MODELS.sonnet, "medium"]);
  const moderateHigh = decide("veri çekme kodunda race condition olabilir mi? neden olur, incele ve alternatifleri karşılaştır"); // 37
  assert.deepEqual([moderateHigh.model, moderateHigh.effort], [MODELS.sonnet, "high"]);
  const architecture = decide("bu servisin mimari tasarımını yap"); // 44
  assert.deepEqual([architecture.model, architecture.effort], [MODELS.opus, "medium"]);
});

test("defaults: easy → haiku/medium, no signal → sonnet/medium, hard → opus", () => {
  const easy = decide("bu fonksiyonu yeniden adlandır");
  assert.deepEqual([easy.model, easy.effort], [MODELS.haiku, "medium"]);
  const plain = decide("Implement the feature");
  assert.deepEqual([plain.model, plain.effort], [MODELS.sonnet, "medium"]);
  assert.equal(decide("bu servisin mimari tasarımını yap").model, MODELS.opus);
});

test("a short follow-up with no signal keeps the previous decision; a passive one is not kept", () => {
  const previous = decide("bu servisin mimari tasarımını yap");
  const followup = decide("devam et", { previous });
  assert.deepEqual([followup.model, followup.reason], [MODELS.opus, "short-followup"]);
  assert.equal(decide("devam et", { previous: { passive: true, reason: "rejected" } }).reason, "score");
});

test("a short prompt with a signal is scored, not inherited", () => {
  const previous = decide("bu servisin mimari tasarımını yap");
  assert.equal(decide("neden çalışmıyor?", { previous }).reason, "score");
});

test("hysteresis: with a large context, no downgrade below the previous or the client model", () => {
  const previous = decide("bu servisin mimari tasarımını yap");
  const kept = decide("bu fonksiyonu yeniden adlandır", { previous, contextTokens: 50000 });
  assert.deepEqual([kept.model, kept.reason, kept.effort], [MODELS.opus, "cache-hysteresis", "medium"]);
  const first = decide("bu fonksiyonu yeniden adlandır", { clientModel: MODELS.sonnet, contextTokens: 50000 });
  assert.equal(first.model, MODELS.sonnet);
  assert.equal(decide("bu fonksiyonu yeniden adlandır", { previous, contextTokens: 1000 }).model, MODELS.haiku);
});

test("effortFor follows the default effort the catalog gives; without it medium / high", () => {
  const efforts = { sonnet: { base: "high", up: "xhigh" } };
  assert.deepEqual([10, 31].map((s) => effortFor(MODELS.sonnet, s, efforts)), ["high", "xhigh"]);
  assert.equal(effortFor(MODELS.opus, 10, efforts), "medium");
  assert.equal(decide("explain the architecture and root cause of this bug in detail", { triage: 90, efforts: { opus: { base: "low", up: "high" } } }).effort, "high");
});
