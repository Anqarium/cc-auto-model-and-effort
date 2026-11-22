# Mod surface (compact map for the weekly release check)

Purpose: the weekly cloud routine "Claude Code ve Desktop sürüm takibi" reads THIS file instead of `lib/` and `hooks/register.ts` (about 12k tokens of code) to judge release notes. Keep it short and current: update it in the same commit whenever a hook, a `$.` call or a Claude Code internal the mod relies on is added or removed. Details live in `CLAUDE.md`; this file only lists what could break or what a release could improve.

## What the mod does

`auto-model-effort` picks the model and effort for every main-conversation model request. On each typed prompt it rates difficulty (Haiku triage over raw `/v1/messages`, rule-based score as fallback), then maps score to model family (haiku/sonnet/opus, optional fable) and effort. Slash commands: `/auto`, `/auto-log`, `/with-fable`. It runs in the CLI and in Claude Desktop's Code tab.

## Hooks (events the mod registers)

`turn.start`, `turn.step` (rewrites model/effort with `next({...e, model, effort})`, retries once on the session model if the rewritten request yields no content), `session.start`, `command.run`, `prompt.edit`, `prompt.change`, `ui.render` (components `SessionMode`, `AbovePrompt`).

## `$` API calls used

- `$.http.fetch` + `$.session.authorize()`: raw Haiku triage call (needs Claude Code's identity line as first system block; no `anthropic-beta` header).
- `$.session.messages({ as: 'api' })`: context estimate and screenshots of the prompt.
- `$.store.get/set` (decisions log, learned model ids), `$.state.get/set` (label shared with token-weather), `$.fs.read/list` (model catalog cache), `$.command.register`, `$.ui.invalidate/resolve/status/log`, `$.clock.now/after`, `$.env.get`, `$.model.complete` (fallback path only).

## Claude Code internals the mod depends on

- Model catalog cache `<config dir>/cache/model-catalog/*.json` (new models and the default/"Recommended" effort are read from it).
- Full model ids in `turn.step` (aliases were not resolved before 2.1.309).
- Incoming `e.effort` of `xhigh`/`max` (ultrathink) is passed through as is.
- Opaque `engine` stream chunks (do not count as a response); `usage`/`stopReason` null when no response arrived.
- Plugin marketplace `anqarium` (GitHub source, update detected by `version` in `plugin.json`).
- Desktop: `SessionMode` is not drawn there, so the label goes through `AbovePrompt` / token-weather. Remote Control (phone) attaches no mod surface.
- Tool search behind a custom `ANTHROPIC_BASE_URL` (only relevant to the old proxy path and the spike observer).

## Not used today (ideas a release could unlock)

An official prompt-only small-model call to replace the raw triage request; model alias resolution inside `turn.step`; any mod surface on mobile / Remote Control; a hook that can bind keys.

## Open report issues

#4 (ultrathink xhigh vs `turn.step`), #7 (2.1.318 headless `turn.step` fixes).
