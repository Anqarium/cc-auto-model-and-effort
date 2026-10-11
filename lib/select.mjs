// Picks the model + effort for a prompt. Pure module with no Node dependencies, because the
// Claude Code mod (hooks/register.ts) runs in an environment without Node.
import { scorePrompt } from "./score.mjs";

export const MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};
const RANK = { [MODELS.haiku]: 0, [MODELS.sonnet]: 1, [MODELS.opus]: 2 };

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

// Effort by score, per model: medium is every model's default, so its band is kept wide;
// above the model's threshold it is high. low is never used.
export const HIGH_EFFORT_THRESHOLD = { [MODELS.haiku]: Infinity, [MODELS.sonnet]: 30, [MODELS.opus]: 75 };
export const effortFor = (model, score) => (score > (HIGH_EFFORT_THRESHOLD[model] ?? Infinity) ? "high" : "medium");

const SHORT_FOLLOWUP = 25; // a short reply with no signals ("yes", "go on") keeps the previous decision.

// Decision for a new user prompt.
// previous: the session's previous decision (or null); clientModel: the session's own model;
// contextTokens: estimated conversation tokens; downgradeLimit: above this the model is not downgraded (cache).
export function decide(text, { previous = null, clientModel = MODELS.sonnet, contextTokens = 0, downgradeLimit = 30000 } = {}) {
  const s = scorePrompt(text);
  if (previous && !previous.passive && s.score === 0 && text.length < SHORT_FOLLOWUP) return { ...previous, reason: "short-followup" };

  const targetModel = (s.signals.includes("easy-marker") && EASY_LEVEL_MODEL[s.level]) || LEVEL_MODEL[s.level];
  let decision = { model: targetModel, score: s.score, level: s.level, signals: s.signals, reason: "score" };

  // On the first decision the baseline is the client's model: a session resumed with a large context is not downgraded.
  const current = (previous && !previous.passive && previous.model) || clientModel;
  if (RANK[targetModel] < RANK[current] && contextTokens > downgradeLimit) {
    decision = { ...decision, model: current, reason: "cache-hysteresis" };
  }
  // Effort follows the threshold of the model that will actually run.
  decision.effort = effortFor(decision.model, s.score);
  return decision;
}
