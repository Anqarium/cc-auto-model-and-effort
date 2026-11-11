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

Medium is every model's default effort, so it covers the widest range; low is never used. The built-in fallback rules understand English and Turkish prompts. Subagents keep their own model. The chosen model and effort show as a label right of the prompt, with an icon and color tied to the model's name: green `🍃 Haiku 5.5` (a haiku is a short nature poem), blue-violet `🪶 Sonnet 5.5 · medium · simple 12` (a poem written with a quill), bold amber `🎼 Opus 5.5 · medium · complex 49` (an opus is a musical work) and bold purple `🦊 Fable 5.2 · high · expert 94` (the fox of Aesop's fables).

To force a specific model, type `/auto off`: routing stops for that session and your chosen model is used; `/auto on` turns it back on, `/auto` alone toggles. Every new session starts on. At startup and after `/auto`, a notice (`⚡ auto on · /auto to turn off` or `auto off · /auto to turn on`) shows for a few seconds. If a rewritten request is rejected, the same request is sent again on the session's own model.

**Fable (opt-in, 4 models instead of 3):** Fable costs about twice Opus per token, so it is never used by default. Type `/with-fable` (or `/with-fable on`) to let prompts rated expert (above 65) go to Fable instead of Opus; effort is Fable's default (medium), one step up above 85. Once on, it stays on Fable in a long conversation (the same no-downgrade rule as the other models, above 30K tokens) so the cache is kept. `/with-fable off` (or `/with-fable` alone to toggle) turns it off and a standing Fable decision goes back to Opus. It applies to the current session only; every new session starts with Fable off. If your plan cannot call the newest Fable, the rejected request is sent again on the session's own model.

**Naming a model:** write `fable`, `opus`, `sonnet` or `haiku` as a word in the prompt and that prompt goes to that model, like `ultrathink` (the Haiku rating is skipped, effort is the model's default, `fable` works even with `/with-fable` off). While you type, the name is painted in the prompt box and a line above it, on the right of the band, says `Fable 5.2 requested for this turn · ctrl+x b to ignore`. Press ctrl+x, then b, to ignore the name for that prompt (its color goes, and the prompt is rated as usual); press it again to undo. (A plugin cannot define its own keys, only borrow one of Claude Code's: ctrl+x b normally switches the diff base in the `/diff` panel and is free elsewhere; alt+w is taken by `ultracode`.) A follow-up such as "go on" stays on the named model; the next real prompt is rated as usual. Only a whole word counts, not an id (`claude-opus-5-5`), a command (`/with-fable`) or a file name (`fable.md`); with several names the most capable wins. Mind that a sentence that merely mentions a model ("Haiku gave the wrong answer") also forces it, so check the line before sending.

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
