# cc-auto-model-and-effort

A Claude Code plugin (mod: `auto-model-effort`) that automatically picks the model and effort level for each prompt based on how hard it looks. Works with a Claude subscription (OAuth); no proxy or background process needed.

## Install

### Requirements

- Claude Code 2.1.296 or newer (the mod API is in early access and may change between versions).
- A Claude subscription (OAuth login). It was developed and tested on one; no proxy, background process or extra dependencies are needed.
- Node is only needed to run the tests, not to use the plugin.

### From GitHub

```
claude plugin marketplace add Anqarium/cc-auto-model-and-effort
claude plugin install auto-model-effort@anqarium
```

Then start `claude` as usual (or run `/reload-plugins` in a session that is already open). The mode label `⚡ auto on` appears for a few seconds at startup. The plugin is installed at user scope, so it applies to every project.

### Update and uninstall

```
claude plugin marketplace update anqarium
claude plugin update auto-model-effort@anqarium
claude plugin uninstall auto-model-effort@anqarium
```

Updates are detected by the `version` in `.claude-plugin/plugin.json`. Run `/reload-plugins` in open sessions afterwards.

### From a local clone

```
claude plugin marketplace add <path to this repo>
claude plugin install auto-model-effort@anqarium
```

Or load it for one session only, without installing: `claude --plugin-dir <path to this repo>`.

### Check that it works

Run `claude plugin list` (it should show `auto-model-effort@anqarium`), send a prompt, then run `/auto-log` to see the model and effort chosen for it.

## Usage

Once installed, plain `claude` is enough. Whatever model the session starts on (or you switch to with `/model`), every prompt gets a 0–100 difficulty score, rated by Haiku (see [How the rating works](#how-the-rating-works)):

| Prompt | Score | Model / effort |
|---|---|---|
| Clearly mechanical (rename, typo, list…) | 0–5 | Haiku / medium |
| No clear difficulty signal, or moderate | 0–30 | Sonnet / medium |
| Moderately hard (a heavy signal plus analysis: investigate and compare a race condition…) | 31–40 | Sonnet / high |
| Hard (architecture + design, root cause + security…) | 41–75 | Opus / medium |
| Very hard and many-sided | 76+ | Opus / high |

Medium is every model's default effort, so it covers the widest range; low is never used. The built-in fallback rules understand English and Turkish prompts. Subagents keep their own model. The chosen model and effort show as a dim label right of the prompt: `⚡ Opus 5.5 · medium · complex 49`.

To force a specific model, type `/auto off`: routing stops for that session and your chosen model is used; `/auto on` turns it back on, `/auto` alone toggles. Every new session starts on. At startup and after `/auto`, a notice (`⚡ auto on · /auto to turn off` or `auto off · /auto to turn on`) shows for a few seconds. If a rewritten request is rejected, the same request is sent again on the session's own model.

`/auto-log` summarizes the decisions, the model that actually answered, and cache usage.

## How the rating works

For each prompt you type, the plugin sends one small extra request to Claude Haiku. Haiku sees only that prompt (not the conversation) plus any screenshots attached to it, and replies with a single number from 0 to 100. That number picks the model and effort in the table above.

What this means for you:

- **Quota and latency:** one extra Haiku request per typed prompt counts against your subscription quota and adds a few seconds before the answer starts. Screenshots are billed again for that request. Short follow-ups such as "go on" skip it.
- **Privacy:** the prompt text and screenshots go to `api.anthropic.com`, the same service Claude Code already talks to, using the session's own credential. Nothing is sent anywhere else, and the plugin has no server or telemetry.
- **Fallback:** if the Haiku call fails or returns something unusable, a local rule-based score (keywords, code and length signals) is used instead. `/auto-log` shows when that happened and why.
- **Local data:** decisions are kept in the plugin's own store (the last 2000 requests) for `/auto-log`. They hold scores and model names, not your prompt text.

## License

MIT, see [LICENSE](LICENSE).

## Development

```
node --test test/*.test.mjs
claude plugin test .
claude plugin validate .
```

See `CLAUDE.md` for the architecture, risks, and the approaches that were tried.
