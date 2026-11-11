// decide(): the mod's (hooks/register.ts) decision logic. The mod runs without Node and the test kit cannot
// raise turn.step, so the logic is tested here directly.
import test from "node:test";
import assert from "node:assert/strict";
import { MODELS, SEED_IDS, decide, effortFor, effortToSend, familyOf, forcedModel, learnModel, modelKeywords, versionOf, withoutFable } from "../lib/select.mjs";

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

const EXPERT = "explain the architecture and root cause of this bug in detail";

test("fable ids: family, version and learning", () => {
  assert.equal(familyOf("claude-fable-5-2"), MODELS.fable);
  assert.deepEqual(["claude-fable-5-2", "claude-fable-5"].map(versionOf), [[5, 2], [5, 0]]);
  assert.equal(learnModel(SEED_IDS, "claude-fable-5-3").fable, "claude-fable-5-3");
  assert.equal(learnModel(SEED_IDS, "claude-fable-5-1"), SEED_IDS); // older than the seed: ignored
});

test("with Fable off nothing changes: an expert prompt stays on Opus", () => {
  const d = decide(EXPERT, { triage: 90 });
  assert.deepEqual([d.model, d.effort], [MODELS.opus, "high"]);
});

test("with Fable on only an expert prompt goes to Fable; effort follows its own threshold", () => {
  const expert = decide(EXPERT, { triage: 70, fable: true });
  assert.deepEqual([expert.model, expert.level, expert.effort], [MODELS.fable, "expert", "medium"]);
  assert.equal(decide(EXPERT, { triage: 90, fable: true }).effort, "high");
  assert.equal(decide(EXPERT, { triage: 60, fable: true }).model, MODELS.opus); // complex, not expert
  assert.equal(decide("bu servisin mimari tasarımını yap", { fable: true }).model, MODELS.opus);
  assert.equal(decide(EXPERT, { triage: 90, fable: true, efforts: { fable: { base: "high", up: "xhigh" } } }).effort, "xhigh");
});

test("hysteresis holds on Fable while it is on, and never once it is off", () => {
  const previous = decide(EXPERT, { triage: 90, fable: true });
  const held = decide("bu fonksiyonu yeniden adlandır", { previous, contextTokens: 50000, fable: true });
  assert.deepEqual([held.model, held.reason], [MODELS.fable, "cache-hysteresis"]);
  const off = decide("bu fonksiyonu yeniden adlandır", { previous, contextTokens: 50000 });
  assert.deepEqual([off.model, off.reason], [MODELS.opus, "cache-hysteresis"]); // Fable counts as Opus
  assert.equal(decide("bu fonksiyonu yeniden adlandır", { previous, contextTokens: 1000, fable: true }).model, MODELS.haiku);
  assert.equal(decide("hello", { clientModel: "claude-fable-5-2", contextTokens: 50000 }).model, MODELS.opus); // session itself on Fable
});

test("a standing Fable decision is rewritten for Opus when Fable is turned off", () => {
  const previous = decide(EXPERT, { triage: 90, fable: true });
  const followup = decide("devam et", { previous });
  assert.deepEqual([followup.model, followup.effort, followup.reason], [MODELS.opus, "high", "fable-off"]);
  assert.equal(decide("devam et", { previous, fable: true }).model, MODELS.fable);
  assert.deepEqual(withoutFable(previous, {}).model, MODELS.opus);
  const sonnet = decide("Implement the feature");
  assert.equal(withoutFable(sonnet), sonnet); // not a Fable decision: untouched
});

test("model keywords: only +name, with positions (the + included); the most capable name wins", () => {
  assert.deepEqual(modelKeywords("modeli +Fable'a geçir"), [{ family: "fable", start: 7, end: 13 }]);
  assert.equal(forcedModel("+fable yap, +haiku değil"), MODELS.fable);
  assert.equal(forcedModel("+opus ile bak"), MODELS.opus);
  assert.equal(forcedModel("use +Sonnet."), MODELS.sonnet); // sentence end is fine
  // A plain name only mentions the model: nothing is forced.
  for (const t of ["fable ile çöz", "Haiku yanlış cevap verdi", "claude-opus-5-5 id'si", "/with-fable on", "a+fable", "++fable", "+fable.md dosyası", "+opuslar", "no model here"]) {
    assert.equal(forcedModel(t), undefined, t);
  }
});

test("a +name forces it: no score, default effort, Fable even with /with-fable off; it carries on through go on", () => {
  const d = decide("bunu +fable ile çöz", { efforts: { fable: { base: "medium", up: "high" } } });
  assert.deepEqual([d.model, d.effort, d.level, d.score, d.reason, d.forced], [MODELS.fable, "medium", "forced", null, "keyword", true]);
  const held = decide("bu fonksiyonu +haiku ile yeniden adlandır", { previous: decide(EXPERT, { triage: 90 }), contextTokens: 50000 });
  assert.equal(held.model, MODELS.haiku); // no hysteresis for a named model
  const followup = decide("devam et", { previous: d });
  assert.deepEqual([followup.model, followup.reason], [MODELS.fable, "short-followup"]);
  const plain = decide("bunu fable ile çöz"); // no +: rated like any prompt
  assert.notEqual(plain.reason, "keyword");
  assert.notEqual(plain.model, MODELS.fable);
  const next = decide("bu fonksiyonu yeniden adlandır", { previous: d, contextTokens: 50000 });
  assert.equal(next.model, MODELS.opus); // later prompts: Fable counts as Opus while /with-fable is off
});

test("effortFor follows the default effort the catalog gives; without it medium / high", () => {
  const efforts = { sonnet: { base: "high", up: "xhigh" } };
  assert.deepEqual([10, 31].map((s) => effortFor(MODELS.sonnet, s, efforts)), ["high", "xhigh"]);
  assert.equal(effortFor(MODELS.opus, 10, efforts), "medium");
  assert.equal(decide("explain the architecture and root cause of this bug in detail", { triage: 90, efforts: { opus: { base: "low", up: "high" } } }).effort, "high");
});
