// Claude Code mod: scores every user prompt and sends the main conversation's model requests (turn.step)
// with the chosen model + effort. The decision logic and the display text live in pure modules under lib/
// (lib/select.mjs, lib/display.mjs), kept out of the mod code so they can be tested with Node.
import type { EngineInterface, Register, Timer } from 'claude-code'
import { MODELS, SEED_IDS, decide, learnModel } from '../lib/select.mjs'
import { effortsFromCatalog, idsFromCatalog } from '../lib/catalog.mjs'
import { autoCommand, label, logSummary, statusNotice } from '../lib/display.mjs'
import { parseTriage, triageRequest } from '../lib/triage.mjs'

// Above this many conversation tokens the model is not downgraded (the new model would rewrite the cache).
const DOWNGRADE_LIMIT = 30000
// Haiku triage: a prompt shorter than this after a first decision is not sent to Haiku. The call has no timeout.
const SHORT_PROMPT = 25
// Calibration log in $.store (kept across sessions): the last this-many main-conversation model requests.
const LOG_KEY = 'decisions'
const LOG_MAX = 2000
// How long the status notice stays at startup and after /auto.
const NOTICE_MS = 4000

type Decision = ReturnType<typeof decide>
type ModelIds = Record<string, string>
type Efforts = Record<string, { base: string; up: string }>

// Newest full model id seen per family, kept across sessions: turn.step does not resolve aliases, so the routed
// request needs a real id. Any id the mod sees (session model, subagents, responses) can raise an entry.
const IDS_KEY = 'modelIds'

// Claude Code keeps its own model catalog under <config dir>/cache/model-catalog and refreshes it itself; every
// plain Claude id in it raises its family's entry, so a new release (Opus 5.6) is picked up with no change here.
// An unreadable catalog is logged once per session, not on every prompt.
let catalogErrorLogged = false

async function learnFromCatalog($: EngineInterface, ids: ModelIds): Promise<{ ids: ModelIds; efforts: Efforts }> {
  let efforts: Efforts = {}
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const dir = `${configDir}/cache/model-catalog`
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      const text = await $.fs.read(`${dir}/${entry.name}`)
      for (const id of idsFromCatalog(text)) ids = await remember($, ids, id)
      efforts = { ...efforts, ...effortsFromCatalog(text) }
    }
  } catch (error) {
    if (!catalogErrorLogged) {
      catalogErrorLogged = true
      await record($, { skipped: 'catalog-unreadable', error: String(error) })
    }
  }
  return { ids, efforts }
}

async function remember($: EngineInterface, ids: ModelIds, seen: string | undefined): Promise<ModelIds> {
  const next = learnModel(ids, seen)
  if (next !== ids) await $.store.set(IDS_KEY, next)
  return next
}

async function record($: EngineInterface, entry: Record<string, unknown>) {
  const old = ((await $.store.get(LOG_KEY)) as unknown[] | undefined) ?? []
  const t = new Date(await $.clock.now()).toISOString()
  await $.store.set(LOG_KEY, [...old, { t, ...entry }].slice(-LOG_MAX))
}

// The mode label right of the prompt (SessionMode). $.ui.status is not used: Claude Code prefixes it with
// "⚠<plugin name>:". Two layers: a lasting label (the last decision; none while off) and a notice shown in
// its place for a few seconds. When either changes, ui.render runs again.
// $ may only be passed to functions declared at the top level of this file (validator rule), hence these here.
let lasting: string | undefined
let notice: string | undefined
let noticeTimer: Timer | undefined

function show($: EngineInterface, d: Parameters<typeof label>[0]) {
  lasting = label(d)
  $.ui.invalidate('ui.render')
}

function notify($: EngineInterface, text: string) {
  noticeTimer?.cancel()
  notice = text
  noticeTimer = $.clock.after(NOTICE_MS, () => {
    notice = undefined
    $.ui.invalidate('ui.render')
  })
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  let decision: Decision | null = null
  let clientModel: string = MODELS.sonnet
  let ids: ModelIds = SEED_IDS
  // Default effort per family (the catalog's "Recommended" option) and the step above it; empty until the catalog is read.
  let efforts: Efforts = {}
  // Routes whatever model the session is on; /auto off stops it (this session only).
  let enabled = true
  // Why the last prompt's Haiku triage gave no rating (undefined when it did or was skipped); logged with its first step.
  let triageNote: string | undefined

  on('ui.render', { component: 'SessionMode' }, ($, e, next) => {
    const text = notice ?? lasting
    return text ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, text] } }) : next(e)
  })

  on('session.start', async ($, e, next) => {
    $.ui.status(undefined) // clear a status line an older version may have left
    const stored = ((await $.store.get(IDS_KEY)) as ModelIds | undefined) ?? {}
    for (const id of Object.values(stored)) ids = learnModel(ids, id)
    await $.command.register({
      name: 'auto-log',
      description: 'auto-model-effort: summary of model/effort decisions and cache usage',
    })
    await $.command.register({
      name: 'auto',
      description: 'auto-model-effort: turn automatic model/effort selection on or off for this session',
      argumentHint: '[on|off]',
    })
    notify($, statusNotice(enabled))
    return next(e)
  })

  on('command.run', { command: 'auto-log' }, async $ => ({
    text: logSummary((await $.store.get(LOG_KEY)) as Parameters<typeof logSummary>[0]),
  }))

  on('command.run', { command: 'auto' }, async ($, e) => {
    const result = autoCommand(e.args, enabled)
    enabled = result.enabled
    show($, enabled && decision ? { decision } : null)
    notify($, statusNotice(enabled))
    return { text: result.message }
  })

  on('turn.start', async ($, e, next) => {
    // Empty text is a turn without a typed prompt (a background agent's notification, a continuation):
    // the previous decision stands.
    if (enabled && e.text.trim()) {
      const learned = await learnFromCatalog($, ids)
      ids = learned.ids
      efforts = Object.fromEntries(Object.entries(ids).flatMap(([family, id]) => (learned.efforts[id] ? [[family, learned.efforts[id]]] : [])))
      const messages = await $.session.messages()
      // Haiku rates the prompt; a short follow-up after a decision skips the call (the rules handle it), and
      // a failed or unparseable call leaves `triage` undefined, so the rule-based score stands in.
      let triage: number | undefined
      let triageFailed = false
      triageNote = undefined
      if (!(decision && e.text.trim().length < SHORT_PROMPT)) {
        const r = await $.model.complete({
          model: 'haiku',
          ...triageRequest(e.text),
          maxTokens: 8,
          effort: 'low',
        })
        triage = r.isAnswered ? parseTriage(r.text) : undefined
        triageFailed = triage === undefined
        triageNote = !triageFailed ? undefined : !r.isAnswered ? (r.reason === 'api-error' ? `api-error ${r.status ?? 'no-response'}` : r.reason) : `unparseable: ${r.text.slice(0, 40)}`
      }
      decision = decide(e.text, {
        previous: decision,
        clientModel,
        contextTokens: JSON.stringify(messages).length / 4,
        downgradeLimit: DOWNGRADE_LIMIT,
        triage,
        triageFailed,
        efforts,
      })
      show($, { decision })
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    ids = await remember($, ids, e.model) // subagent steps teach ids too
    if (e.agentId !== undefined) return yield* next(e) // subagents keep their own model
    clientModel = e.model
    if (!enabled) {
      if (e.index === 0) await record($, { step: e.index, skipped: 'off' })
      return yield* next(e)
    }
    if (!decision || decision.passive) return yield* next(e)

    const { model, effort, level, score, reason } = decision
    const stream = next({ ...e, model: ids[model] ?? e.model, effort })
    let gotChunk = false
    for await (const chunk of stream) {
      gotChunk = true
      yield chunk
    }
    let result = await stream.result

    // No response at all (the API rejected the rewritten request) and the user did not interrupt:
    // leave the rest of this prompt alone and send the request once more on the session's own model.
    const fallback = !gotChunk && result.usage === null && result.stopReason === null && !next.signal.aborted
    if (fallback) {
      decision = { ...decision, passive: true, reason: 'rejected' }
      result = yield* next(e)
    }

    const u = result.usage
    ids = await remember($, ids, u?.model)
    show($, { decision, responseModel: u?.model })
    await record($, {
      step: e.index,
      model,
      effort,
      level,
      score,
      reason,
      ...(e.index === 0 && triageNote ? { triageNote } : {}),
      responseModel: u?.model,
      cacheWrite: u?.cache_creation_input_tokens,
      cacheRead: u?.cache_read_input_tokens,
      ...(fallback ? { fallback: true } : {}),
    })
    return result
  })
}
