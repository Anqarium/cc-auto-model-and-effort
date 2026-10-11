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
