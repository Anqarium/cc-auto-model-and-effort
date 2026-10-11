import test from "node:test";
import assert from "node:assert/strict";
import { autoCommand, label, logSummary, statusNotice } from "../lib/display.mjs";

test("label: no prefix, short; nothing shown without a decision", () => {
  assert.equal(label(null), undefined);
  const decision = { model: "claude-opus-5-5", effort: "medium", level: "complex", score: 49, reason: "score" };
  assert.equal(label({ decision }), "⚡ Opus 5.5 · medium · complex 49");
  assert.equal(label({ decision, responseModel: "claude-haiku-5-5" }), "⚡ Haiku 5.5 · medium · complex 49");
  assert.equal(label({ decision: { ...decision, reason: "short-followup" } }), "⚡ Opus 5.5 · medium · complex 49 · short-followup");
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

test("logSummary: distribution, actual model/cache totals, fallbacks and skipped", () => {
  assert.equal(logSummary([]), "No records yet.");
  assert.equal(logSummary(undefined), "No records yet.");
  const summary = logSummary([
    { t: "2026-10-11T14:00:00.000Z", step: 0, model: "claude-haiku-5-5", effort: "medium", level: "trivial", score: 0, reason: "score", responseModel: "claude-haiku-5-5", cacheWrite: 100, cacheRead: 0 },
    { t: "2026-10-11T14:00:05.000Z", step: 1, model: "claude-haiku-5-5", effort: "medium", level: "trivial", score: 0, reason: "score", responseModel: "claude-haiku-5-5", cacheWrite: 0, cacheRead: 300 },
    { t: "2026-10-11T14:02:00.000Z", step: 0, model: "claude-opus-5-5", effort: "high", level: "expert", score: 80, reason: "score", responseModel: "claude-sonnet-5-5", fallback: true },
    { t: "2026-10-11T14:03:00.000Z", step: 0, skipped: "off" },
  ]);
  assert.match(summary, /4 model requests, 2 prompt decisions/);
  assert.match(summary, /Haiku 5\.5: 2 requests, write 100, read 300 \(75% read\)/);
  assert.match(summary, /Fallbacks: 1 · Skipped: 1/);
});
