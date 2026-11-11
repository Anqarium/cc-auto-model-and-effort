// Claude Code's model catalog cache -> the ids the mod learns from.
import test from "node:test";
import assert from "node:assert/strict";
import { SEED_IDS, learnModel } from "../lib/select.mjs";
import { effortsFromCatalog, idsFromCatalog } from "../lib/catalog.mjs";

const catalog = (ids) => JSON.stringify({ version: 2, catalog: { config: { id: "ccd", models: ids.map((id) => ({ id, name: id })) } } });

test("idsFromCatalog lists the model ids of a catalog and nothing for other input", () => {
  assert.deepEqual(idsFromCatalog(catalog(["claude-opus-5-5", "claude-fable-5-1"])), ["claude-opus-5-5", "claude-fable-5-1"]);
  for (const bad of ["", "not json", "{}", '{"catalog":{"config":{"models":"x"}}}', "null"]) assert.deepEqual(idsFromCatalog(bad), []);
});

test("a newer release in the catalog becomes the routed id; other families and older ids do not matter", () => {
  const ids = idsFromCatalog(catalog(["claude-opus-5-6", "claude-sonnet-5-5", "claude-haiku-4-5-20251001", "claude-fable-5-1"]));
  const learned = ids.reduce(learnModel, SEED_IDS);
  // An older Fable (5.1) does not lower the seed's 5.2.
  assert.deepEqual(learned, { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-6", fable: "claude-fable-5-2" });
});

test("effortsFromCatalog reads the Recommended effort as the default and the next option as the step up", () => {
  const model = (id, options) => ({ id, thinking: { type: "effort", effort_options: options } });
  const opt = (id, rec) => (rec ? { id, badge: { message: "Recommended" } } : { id });
  const text = JSON.stringify({
    catalog: { config: { models: [
      model("claude-opus-5-5", [opt("low"), opt("medium", true), opt("high"), opt("max")]),
      model("claude-fable-5-1", [opt("low"), opt("high", true), opt("max")]),
      model("claude-opus-4-7", [opt("high"), opt("xhigh", true)]),
      model("claude-haiku-4-5-20251001", undefined),
      model("claude-x-no-badge", [opt("low"), opt("high")]),
    ] } },
  });
  assert.deepEqual(effortsFromCatalog(text), {
    "claude-opus-5-5": { base: "medium", up: "high" },
    "claude-fable-5-1": { base: "high", up: "max" },
    "claude-opus-4-7": { base: "xhigh", up: "xhigh" },
  });
  for (const bad of ["", "not json", "{}", "null"]) assert.deepEqual(effortsFromCatalog(bad), {});
});
