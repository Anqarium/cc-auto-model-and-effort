// Reads the model ids out of Claude Code's own model catalog cache (~/.claude/cache/model-catalog/*.json):
// {"catalog":{"config":{"models":[{"id":"claude-opus-5-5", ...}, ...]}}}. Claude Code refreshes it itself, so a
// new release shows up there without any change here. Pure module (no I/O); the file reads are in hooks/register.ts.

// Returns every model id the catalog lists (strings), or [] for anything that is not a catalog.
export function idsFromCatalog(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const models = json?.catalog?.config?.models;
  return Array.isArray(models) ? models.map((m) => m?.id).filter((id) => typeof id === "string") : [];
}

// Returns {modelId: {base, up}} for every model with an effort ladder: `base` is the option the catalog marks
// "Recommended" (the model's default effort) and `up` the next option above it (the base itself if it is the top).
export function effortsFromCatalog(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const models = json?.catalog?.config?.models;
  const out = {};
  for (const m of Array.isArray(models) ? models : []) {
    const options = m?.thinking?.effort_options;
    if (typeof m?.id !== "string" || !Array.isArray(options)) continue;
    const ladder = options.map((o) => o?.id).filter((id) => typeof id === "string");
    const i = options.findIndex((o) => o?.badge?.message === "Recommended" && typeof o.id === "string");
    if (i < 0) continue;
    out[m.id] = { base: options[i].id, up: ladder[ladder.indexOf(options[i].id) + 1] ?? options[i].id };
  }
  return out;
}
