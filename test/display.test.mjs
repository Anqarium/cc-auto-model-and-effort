import test from "node:test";
import assert from "node:assert/strict";
import { autoCommand, fableNotice, label, labelStyle, logSummary, requestNotice, statusNotice, withFableCommand } from "../lib/display.mjs";

test("a forced model: label without a score, the draft's request line, the log without (null)", () => {
  const decision = { model: "claude-fable-5-2", effort: "medium", level: "forced", score: null, reason: "keyword", forced: true };
  assert.equal(label({ decision }), "🔮 Fable 5.2 · medium · forced");
  assert.equal(label({ decision: { ...decision, reason: "short-followup" } }), "🔮 Fable 5.2 · medium · forced · short-followup");
  assert.equal(requestNotice("claude-fable-5-2"), "Fable 5.2 requested for this turn");
  const log = logSummary([{ t: "2026-11-12T10:00:00.000Z", step: 0, ...decision, responseModel: "claude-fable-5-2" }]);
  assert.match(log, /Fable 5\.2 medium {2}forced · keyword/);
  assert.doesNotMatch(log, /null/);
});

test("label: no prefix, short; nothing shown without a decision", () => {
  assert.equal(label(null), undefined);
  const decision = { model: "claude-opus-5-5", effort: "medium", level: "complex", score: 49, reason: "score" };
  assert.equal(label({ decision }), "🎼 Opus 5.5 · medium · complex 49");
  assert.equal(label({ decision, responseModel: "claude-haiku-5-5" }), "⚡ Haiku 5.5 · medium · complex 49");
  assert.equal(label({ decision, responseModel: "claude-opus-5-5", sentEffort: "xhigh" }), "🎼 Opus 5.5 · xhigh · complex 49");
  assert.equal(label({ decision: { ...decision, reason: "short-followup" } }), "🎼 Opus 5.5 · medium · complex 49 · short-followup");
  // The style follows the model that answered: Opus decided, Haiku answered → plain.
  assert.deepEqual(labelStyle({ decision }), { icon: "🎼", color: "warning" });
  assert.deepEqual(labelStyle({ decision, responseModel: "claude-haiku-5-5" }), {});
  assert.deepEqual(labelStyle({ decision: { passive: true }, responseModel: "claude-opus-5-5" }), {});
  assert.equal(labelStyle({ decision: { model: "fable" } }).color, "merged");
  assert.equal(label({ decision: { passive: true, reason: "rejected" }, responseModel: "claude-sonnet-5-5" }), "auto ↩ Sonnet 5.5");
});

test("statusNotice: on/off and how to change it", () => {
  assert.equal(statusNotice(true), "⚡ auto on · /auto to turn off");
  assert.equal(statusNotice(false), "auto off · /auto to turn on");
});

test("autoCommand: no argument toggles, on/off set, unknown keeps the state", () => {
  assert.equal(autoCommand("", true).enabled, false);
  assert.equal(autoCommand("  ", false).enabled, true);
  for (const a of ["on", "ON"]) assert.equal(autoCommand(a, false).enabled, true, a);
  for (const a of ["off", "OFF"]) assert.equal(autoCommand(a, true).enabled, false, a);
  const unknown = autoCommand("maybe", true);
  assert.equal(unknown.enabled, true);
  assert.match(unknown.message, /Usage: \/auto \[on\|off\]/);
  assert.doesNotMatch(autoCommand("off", true).message, /auto-model-effort/); // Claude Code adds the plugin name itself
});

test("withFableCommand: toggles like /auto, unknown keeps the state; Fable ids are named", () => {
  assert.equal(withFableCommand("", false).enabled, true);
  assert.equal(withFableCommand("OFF", true).enabled, false);
  assert.equal(withFableCommand("on", false).enabled, true);
  const unknown = withFableCommand("maybe", true);
  assert.equal(unknown.enabled, true);
  assert.match(unknown.message, /Usage: \/with-fable \[on\|off\]/);
  assert.doesNotMatch(withFableCommand("on", false).message, /auto-model-effort/);
  assert.equal(fableNotice(true), "⚡ Fable on · /with-fable to turn off");
  assert.equal(fableNotice(false), "Fable off · /with-fable to turn on");
  const decision = { model: "claude-fable-5-2", effort: "medium", level: "expert", score: 80, reason: "score" };
  assert.equal(label({ decision }), "🔮 Fable 5.2 · medium · expert 80");
});

test("logSummary: distribution, actual model/cache totals, fallbacks and skipped", () => {
  assert.equal(logSummary([]), "No records yet.");
  assert.equal(logSummary(undefined), "No records yet.");
  const summary = logSummary([
    { t: "2026-10-11T14:00:00.000Z", step: 0, model: "claude-haiku-5-5", effort: "medium", level: "trivial", score: 0, reason: "score", responseModel: "claude-haiku-5-5", cacheWrite: 100, cacheRead: 0 },
    { t: "2026-10-11T14:00:05.000Z", step: 1, model: "claude-haiku-5-5", effort: "medium", level: "trivial", score: 0, reason: "score", responseModel: "claude-haiku-5-5", cacheWrite: 0, cacheRead: 300 },
    { t: "2026-10-11T14:02:00.000Z", step: 0, model: "claude-opus-5-5", effort: "high", level: "expert", score: 80, reason: "score", responseModel: "claude-sonnet-5-5", fallback: true },
    { t: "2026-10-11T14:03:00.000Z", step: 0, skipped: "off" },
    { t: "2026-10-11T14:04:00.000Z", step: 0, model: "claude-sonnet-5-5", effort: "xhigh", chosenEffort: "medium", level: "simple", score: 12, reason: "score", responseModel: "claude-sonnet-5-5" },
  ]);
  assert.match(summary, /5 model requests, 3 prompt decisions/);
  assert.match(summary, /Haiku 5\.5: 2 requests, write 100, read 300 \(75% read\)/);
  assert.match(summary, /Fallbacks: 1 · Skipped: 1 · Session effort kept: 1/);
  assert.match(summary, /Sonnet 5\.5 xhigh  simple \(12\) · session effort \(mod: medium\)/);
  assert.doesNotMatch(summary, /Opus 5\.5 high .*session effort/);
});
