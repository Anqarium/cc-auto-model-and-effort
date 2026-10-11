// Claude Code's model catalog cache -> the ids the mod learns from.
import test from "node:test";
import assert from "node:assert/strict";
import { SEED_IDS, learnModel } from "../lib/select.mjs";
import { idsFromCatalog } from "../lib/catalog.mjs";

const catalog = (ids) => JSON.stringify({ version: 2, catalog: { config: { id: "ccd", models: ids.map((id) => ({ id, name: id })) } } });

test("idsFromCatalog lists the model ids of a catalog and nothing for other input", () => {
  assert.deepEqual(idsFromCatalog(catalog(["claude-opus-5-5", "claude-fable-5-1"])), ["claude-opus-5-5", "claude-fable-5-1"]);
  for (const bad of ["", "not json", "{}", '{"catalog":{"config":{"models":"x"}}}', "null"]) assert.deepEqual(idsFromCatalog(bad), []);
});

test("a newer release in the catalog becomes the routed id; other families and older ids do not matter", () => {
  const ids = idsFromCatalog(catalog(["claude-opus-5-6", "claude-sonnet-5-5", "claude-haiku-4-5-20251001", "claude-fable-5-1"]));
  const learned = ids.reduce(learnModel, SEED_IDS);
  assert.deepEqual(learned, { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-6" });
});
