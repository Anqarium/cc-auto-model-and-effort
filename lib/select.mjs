// Picks the model + effort for a prompt. Pure module with no Node dependencies, because the
// Claude Code mod (hooks/register.ts) runs in an environment without Node.
import { levelFor, scorePrompt } from "./score.mjs";

// Family aliases, not version ids: Claude Code resolves an alias to the newest model of that family, so a new
// release needs no change here. Ids from the client ("claude-opus-5-5") are mapped to their family.
export const MODELS = { haiku: "haiku", sonnet: "sonnet", opus: "opus" };
const RANK = { [MODELS.haiku]: 0, [MODELS.sonnet]: 1, [MODELS.opus]: 2 };
export const familyOf = (model) => /haiku|sonnet|opus/i.exec(String(model ?? ""))?.[0].toLowerCase();

// turn.step sends the model name as given (an alias like "opus" is NOT resolved, the API answers 404), so the
// request needs a full id. SEED_IDS is only the starting point; the mod learns newer ids from every model id it
// sees (the session's own model, subagents' models, responses) with learnModel, and keeps them in $.store.
export const SEED_IDS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };

// "claude-opus-5-5" -> [5, 5]; "claude-haiku-4-5-20251001" -> [4, 5]; "claude-opus-4-20250514" -> [4, 0]
export function versionOf(id) {
  // Anchored: only a plain id is learned, never one with a suffix such as "[1m]" or a provider prefix.
  const m = /^claude-(?:haiku|sonnet|opus)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(String(id ?? ""));
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : undefined;
}

// Returns `ids` with `seen` in place of its family's entry when `seen` is a newer version; else `ids` itself.
export function learnModel(ids, seen) {
  const family = familyOf(seen);
  const v = versionOf(seen);
  if (!family || !v) return ids;
  const old = versionOf(ids[family]);
  if (old && (old[0] > v[0] || (old[0] === v[0] && old[1] >= v[1]))) return ids;
  return { ...ids, [family]: seen };
}

// Level -> model. A wrongly cheap model hurts more than a wrongly expensive one, so a prompt with
// no or few signals stays on sonnet; haiku only with an explicit easy marker (rename, list...).
export const LEVEL_MODEL = {
  trivial: MODELS.sonnet,
  simple: MODELS.sonnet,
  moderate: MODELS.sonnet,
  complex: MODELS.opus,
  expert: MODELS.opus,
};
export const EASY_LEVEL_MODEL = { trivial: MODELS.haiku };

// Effort by score, per model: the model's default effort (medium for today's models) has a wide band;
// above the model's threshold it is the step above the default (high). low is never used.
export const HIGH_EFFORT_THRESHOLD = { [MODELS.haiku]: Infinity, [MODELS.sonnet]: 30, [MODELS.opus]: 75 };
// `efforts` ({family: {base, up}}, from the model catalog, see lib/catalog.mjs) names the model's default effort and
// the step above it; without it the defaults are medium / high.
export const effortFor = (model, score, efforts = {}) => {
  const { base = "medium", up = "high" } = efforts[model] ?? {};
  return score > (HIGH_EFFORT_THRESHOLD[model] ?? Infinity) ? up : base;
};

// The session's own effort (`e.effort` at turn.step) wins when it is xhigh/max: that is what Claude Code sends for
// an `ultrathink` turn (v2.1.311+) or when the user pinned a top level; the mod's own choice never goes that high.
export const EFFORT_OVERRIDE = new Set(["xhigh", "max"]);
export const effortToSend = (incoming, chosen) => (EFFORT_OVERRIDE.has(incoming) ? incoming : chosen);

const SHORT_FOLLOWUP = 25; // a short reply with no signals ("yes", "go on") keeps the previous decision.
// The rules cannot see a screenshot, so without Haiku's rating a prompt with one scores at least this (moderate).
export const IMAGE_FLOOR = 30;

// Decision for a new user prompt.
// previous: the session's previous decision (or null); clientModel: the session's own model;
// contextTokens: estimated conversation tokens; downgradeLimit: above this the model is not downgraded (cache);
// triage: the 0-100 difficulty Haiku gave the prompt (lib/triage.mjs), when it answered; `triageFailed` marks a
// triage attempt that gave nothing, so the rule-based score stands in and the log says so;
// images: how many screenshots the prompt carries; efforts: {family: {base, up}} learned from the model catalog (optional).
export function decide(text, { previous = null, clientModel = MODELS.sonnet, contextTokens = 0, downgradeLimit = 30000, triage, triageFailed = false, images = 0, efforts } = {}) {
  let rules = scorePrompt(text);
  if (images > 0 && rules.score < IMAGE_FLOOR) {
    rules = { score: IMAGE_FLOOR, level: levelFor(IMAGE_FLOOR), signals: [...rules.signals.filter((x) => x !== "easy-marker"), "image"] };
  }
  if (previous && !previous.passive && triage === undefined && rules.score === 0 && text.length < SHORT_FOLLOWUP) {
    return { ...previous, reason: "short-followup" };
  }

  // Haiku's rating wins when there is one; its "trivial" is real evidence, so it may route to haiku,
  // unlike the rules where only an explicit easy marker may.
  const s = triage === undefined ? rules : { score: triage, level: levelFor(triage), signals: ["triage"] };
  const cheap = triage === undefined ? s.signals.includes("easy-marker") : true;
  const targetModel = (cheap && EASY_LEVEL_MODEL[s.level]) || LEVEL_MODEL[s.level];
  let decision = { model: targetModel, score: s.score, level: s.level, signals: s.signals, reason: triageFailed ? "rules-fallback" : "score" };

  // On the first decision the baseline is the client's model: a session resumed with a large context is not downgraded.
  const current = familyOf((previous && !previous.passive && previous.model) || clientModel);
  if (RANK[targetModel] < RANK[current] && contextTokens > downgradeLimit) {
    decision = { ...decision, model: current, reason: "cache-hysteresis" };
  }
  // Effort follows the threshold of the model that will actually run.
  decision.effort = effortFor(decision.model, s.score, efforts);
  return decision;
}
