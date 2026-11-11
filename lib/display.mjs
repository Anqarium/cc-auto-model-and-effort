// Everything the mod shows: the label next to the prompt, the status notice, /auto and /auto-log text.
// Pure module: the mod runs in an environment without Node.
// "claude-opus-5-5" -> "Opus 5.5" (a trailing date is ignored); a bare family alias -> "Opus"; anything else as is.
const displayName = (model) => {
  const m = /^claude-(haiku|sonnet|opus|fable)(?:-(\d+)(?:-(\d{1,2})(?!\d))?)?/.exec(model ?? "") ?? /^(haiku|sonnet|opus|fable)$/.exec(model ?? "");
  if (!m) return model ?? "?";
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return m[2] ? `${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : family;
};

// The /auto-log command: a summary of the records in $.store. Each record is one main-conversation model request:
// chosenEffort is set only when the session's xhigh/max (ultrathink) was sent instead of the mod's own effort.
// { t, step, model, effort, level, score, reason, triageNote?, images?, chosenEffort?, responseModel?, cacheWrite?, cacheRead?, fallback?, skipped? }
export function logSummary(records, lastCount = 15) {
  if (!records?.length) return "No records yet.";
  const models = {};
  for (const r of records) {
    if (!r.responseModel) continue;
    const m = (models[displayName(r.responseModel)] ??= { requests: 0, write: 0, read: 0 });
    m.requests++;
    m.write += r.cacheWrite ?? 0;
    m.read += r.cacheRead ?? 0;
  }
  const prompts = records.filter((r) => r.step === 0 && !r.skipped);
  const distribution = {};
  for (const r of prompts) {
    const key = `${displayName(r.model)} / ${r.effort}`;
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  const lines = [`${records.length} model requests, ${prompts.length} prompt decisions`, "", "Decisions:"];
  for (const [key, n] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) lines.push(`  ${key}: ${n}`);
  lines.push("", "Actual model and cache (tokens):");
  for (const [name, v] of Object.entries(models)) {
    const ratio = v.write + v.read ? Math.round((v.read / (v.write + v.read)) * 100) : 0;
    lines.push(`  ${name}: ${v.requests} requests, write ${v.write}, read ${v.read} (${ratio}% read)`);
  }
  const fallbacks = records.filter((r) => r.fallback).length;
  const skipped = records.filter((r) => r.skipped).length;
  const kept = prompts.filter((r) => r.chosenEffort).length;
  lines.push("", `Fallbacks: ${fallbacks} · Skipped: ${skipped} · Session effort kept: ${kept}`, "", `Last ${Math.min(lastCount, prompts.length)} decisions:`);
  for (const r of prompts.slice(-lastCount)) {
    const time = String(r.t ?? "").slice(5, 16).replace("T", " ");
    lines.push(`  ${time}  ${displayName(r.model)} ${r.effort}  ${r.level} (${r.score})${r.reason !== "score" ? ` · ${r.reason}` : ""}${r.triageNote ? ` (${r.triageNote})` : ""}${r.images ? ` · ${r.images} image${r.images > 1 ? "s" : ""}` : ""}${r.chosenEffort ? ` · session effort (mod: ${r.chosenEffort})` : ""}`);
  }
  return lines.join("\n");
}

// Shown for a few seconds at startup and after /auto.
export const statusNotice = (enabled) => (enabled ? "⚡ auto on · /auto to turn off" : "auto off · /auto to turn on");

// The /auto command: no argument toggles, "on" turns on, "off" turns off. Returns the new state and a message.
// The message does not start with the plugin name: Claude Code prefixes command output with it.
export function autoCommand(args, enabled) {
  const a = String(args ?? "").trim().toLowerCase();
  const next = a === "" ? !enabled : a === "on" ? true : a === "off" ? false : null;
  if (next === null) return { enabled, message: `Unknown argument: "${a}". Usage: /auto [on|off]` };
  return {
    enabled: next,
    message: next
      ? "On: model and effort are picked automatically for every prompt."
      : "Off for this session: the session's own model and effort are used. Turn back on with /auto on.",
  };
}

// Shown for a few seconds after /with-fable.
export const fableNotice = (enabled) => (enabled ? "⚡ Fable on · /with-fable to turn off" : "Fable off · /with-fable to turn on");

// The /with-fable command: no argument toggles, "on" turns on, "off" turns off. Returns the new state and a message.
export function withFableCommand(args, enabled) {
  const a = String(args ?? "").trim().toLowerCase();
  const next = a === "" ? !enabled : a === "on" ? true : a === "off" ? false : null;
  if (next === null) return { enabled, message: `Unknown argument: "${a}". Usage: /with-fable [on|off]` };
  return {
    enabled: next,
    message: next
      ? "On for this session: prompts rated expert go to Fable (about twice Opus's price per token) and stay on it in a long conversation. If the plan cannot call the newest Fable, the request falls back to the session's own model."
      : "Off: Fable is no longer picked, expert prompts use Opus. Turn back on with /with-fable on.",
  };
}

// The mode label right of the prompt (SessionMode). Unlike $.ui.status, Claude Code does not prefix it
// with the plugin name. undefined without a decision: no label is shown.
// d: { decision?, responseModel?, sentEffort? }. Once a response arrived, the model the API reported is shown,
// and the effort actually sent (an ultrathink turn's xhigh) wins over the decision's;
// only exceptional reasons are appended.
export function label(d) {
  if (!d) return undefined;
  const k = d.decision ?? {};
  if (k.passive) return `auto ↩ ${displayName(d.responseModel)}`;
  const parts = [`⚡ ${displayName(d.responseModel ?? k.model)}`, d.sentEffort ?? k.effort, `${k.level} ${k.score ?? "-"}`];
  if (k.reason && k.reason !== "score") parts.push(k.reason);
  return parts.filter(Boolean).join(" · ");
}
