# cc-auto-model-and-effort

A Claude Code plugin (mod: `auto-model-effort`) that automatically picks the model and effort level for each prompt based on how hard it looks. Works with a Claude subscription (OAuth); no proxy or background process needed.

## Install

Requires Claude Code 2.1.296+ (the mod API is in early access).

```
/plugin install auto-model-effort --marketplace Anqarium/cc-auto-model-and-effort
```

From a local clone (code changes apply with `/reload-plugins`):

```
claude plugin marketplace add <path to this repo>
claude plugin install auto-model-effort@anqarium
```

## Usage

Once installed, plain `claude` is enough. Whatever model the session starts on (or you switch to with `/model`), every prompt gets a 0–100 score:

| Prompt | Score | Model / effort |
|---|---|---|
| Clearly mechanical (rename, typo, list…) | 0–5 | Haiku / medium |
| No clear difficulty signal, or moderate | 0–30 | Sonnet / medium |
| Moderately hard (a heavy signal plus analysis: investigate and compare a race condition…) | 31–40 | Sonnet / high |
| Hard (architecture + design, root cause + security…) | 41–75 | Opus / medium |
| Very hard and many-sided | 76+ | Opus / high |

Medium is every model's default effort, so it covers the widest range; low is never used. Prompts are scored in English and Turkish. Subagents keep their own model. The chosen model and effort show as a dim label right of the prompt: `⚡ Opus 5.5 · medium · complex 49`.

To force a specific model, type `/auto off`: routing stops for that session and your chosen model is used; `/auto on` turns it back on, `/auto` alone toggles. Every new session starts on. At startup and after `/auto`, a notice (`⚡ auto on · /auto to turn off` or `auto off · /auto to turn on`) shows for a few seconds. If a rewritten request is rejected, the same request is sent again on the session's own model.

`/auto-log` summarizes the decisions, the model that actually answered, and cache usage.

## Development

```
node --test test/*.test.mjs
claude plugin validate .
```

See `CLAUDE.md` for the architecture, risks, and the approaches that were tried.
