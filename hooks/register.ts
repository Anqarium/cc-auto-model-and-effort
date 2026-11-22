// Claude Code mod: scores every user prompt and sends the main conversation's model requests (turn.step)
// with the chosen model + effort. The decision logic and the display text live in pure modules under lib/
// (lib/select.mjs, lib/display.mjs), kept out of the mod code so they can be tested with Node.
import type { EngineInterface, Register, RenderElement, Timer, TurnStepChunk } from 'claude-code'
import { MODELS, SEED_IDS, decide, effortToSend, forcedModel, learnModel, modelKeywords, withoutFable } from '../lib/select.mjs'
import { effortsFromCatalog, idsFromCatalog } from '../lib/catalog.mjs'
import { autoCommand, fableNotice, fallbackNotice, label, labelStyle, logSummary, modelStyle, requestNotice, statusNotice, withFableCommand } from '../lib/display.mjs'
import { TRIAGE_HEADERS, TRIAGE_URL, parseTriageResponse, promptImages, triageBody } from '../lib/triage.mjs'

// Above this many conversation tokens the model is not downgraded (the new model would rewrite the cache).
const DOWNGRADE_LIMIT = 30000
// Haiku triage: a prompt shorter than this after a first decision is not sent to Haiku. The call has no timeout.
const SHORT_PROMPT = 25
// Calibration log in $.store (kept across sessions): the last this-many main-conversation model requests.
const LOG_KEY = 'decisions'
const LOG_MAX = 2000
// How long the status notice stays at startup and after /auto.
const NOTICE_MS = 4000
// The Fable → Opus fallback notice stays a little longer: the user may want to press Esc or run /with-fable off.
const FALLBACK_NOTICE_MS = 8000
// The mode label and token-weather's readings are shared through $.state (contract in types/index.d.ts).
const modeLabel = { plugin: 'auto-model-effort', key: 'label' } as const
// modeLabel may only be used as a $.state reference (validator rule), so the plugin's own name is repeated for Placed rows.
const PLUGIN_NAME = 'auto-model-effort'
const weatherReadings = { plugin: 'token-weather', key: 'readings' } as const

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

// Haiku triage over the Messages API with the session's own credential: $.model.complete takes text only, and
// the prompt's screenshots must go along. Never throws: a missing credential or a failed call becomes a note.
async function triageCall($: EngineInterface, text: string, images: unknown[], model: string): Promise<{ score?: number; note?: string }> {
  try {
    const auth = await $.session.authorize()
    if (!auth) return { note: 'no-credential' }
    return parseTriageResponse(
      await $.http.fetch(TRIAGE_URL, {
        method: 'POST',
        auth: auth.handle,
        headers: TRIAGE_HEADERS,
        body: JSON.stringify(triageBody(text, images, model)),
      }),
    )
  } catch (error) {
    return { note: `fetch-error: ${String(error).slice(0, 60)}` }
  }
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
// Color of the lasting label (Fable, Opus); none for the dim default.
let lastingColor: string | undefined
let lastingBold = false
let notice: string | undefined
let noticeTimer: Timer | undefined

// The label as token-weather draws it on the desktop: published to $.state whenever the label or a notice changes
// (the state may not be written while a ui.render hook draws, so this runs from the events that change it).
function publishLabel($: EngineInterface) {
  const text = notice ?? lasting
  const value = text ? { text, ...(!notice && lastingColor ? { color: lastingColor, bold: lastingBold } : {}) } : null
  $.state.set(modeLabel, value).catch(err => $.ui.log(`auto-model-effort: the label state was not written: ${String(err)}`))
}

// The mobile app draws neither SessionMode nor AbovePrompt (types: "Raised on the terminal and desktop surfaces
// only"), so there the label goes into the transcript: one placed row after each turn (`$.ui.place`, drawn by the
// `Placed` hook below). Every row keeps the label as it was when the turn ended, so history is not relabelled.
// Display only: the row is not in the model's context and `--resume` does not bring it back.
type PlacedRow = { text: string; color?: string; bold: boolean }
const PLACED_MAX = 200
const placedRows = new Map<string, PlacedRow>()
let placedCount = 0
// True once a model step has run since the last row, so a measurement that only moved a rate-limit window adds none.
let rowPending = false

async function placeRow($: EngineInterface) {
  if (!rowPending || !lasting) return
  rowPending = false
  try {
    if (!(await $.session.surfaces()).includes('mobile')) return
    const id = `mode-${++placedCount}`
    placedRows.set(id, { text: lasting, color: lastingColor, bold: lastingBold })
    if (placedRows.size > PLACED_MAX) placedRows.delete(placedRows.keys().next().value as string)
    await $.ui.place({ id })
  } catch (error) {
    $.ui.log(`auto-model-effort: the mobile label row was not placed: ${String(error)}`)
  }
}

function show($: EngineInterface, d: Parameters<typeof label>[0]) {
  lasting = label(d)
  const style = labelStyle(d)
  lastingColor = style.color
  lastingBold = !!style.bold
  publishLabel($)
  $.ui.invalidate('ui.render')
}

// The label as drawn: in the model's color (bold for Opus and Fable), dim otherwise (the notice is always dim).
// The JSX factory `h` is typed as returning a RenderNode (it may yield a plain string or nothing), but a `ui.render`
// hook must return a RenderElement. Every element built here is one, so this narrows the type.
function el(...args: Parameters<typeof h>): RenderElement {
  return h(...args) as RenderElement
}

function labelText($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], text: string): RenderElement {
  const { Text } = $.ui.resolve(e)
  return !notice && lastingColor ? el(Text, { color: lastingColor, bold: lastingBold }, text) : el(Text, { dimColor: true }, text)
}

// While the draft names a model with a `+` ("+fable", "+opus"...), a line above the prompt says that model will
// answer it. The `+` replaced an ignore key (user's choice 2026-11-12): a plain name no longer triggers anything.
let draftModel: string | undefined

function setDraftModel($: EngineInterface, model: string | undefined) {
  if (model === draftModel) return
  draftModel = model
  $.ui.invalidate('ui.render')
}

// Each `+name` in the draft, painted in its own model's color (lib/display.mjs modelStyle).
function keywordPaint(text: string) {
  return modelKeywords(text).map(w => ({ start: w.start, end: w.end, color: modelStyle(w.family).color ?? 'claude', bold: true }))
}

function notify($: EngineInterface, text: string, ms: number = NOTICE_MS) {
  noticeTimer?.cancel()
  notice = text
  noticeTimer = $.clock.after(ms, () => {
    notice = undefined
    publishLabel($)
    $.ui.invalidate('ui.render')
  })
  publishLabel($)
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
  // /with-fable: an expert prompt may go to Fable (4 models instead of 3). Off at every session start: it is pricey.
  let withFable = false
  // Why the last prompt's Haiku triage gave no rating (undefined when it did or was skipped); logged with its first step.
  let triageNote: string | undefined
  // How many screenshots the last prompt carried; logged with its first step.
  let imageCount = 0

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const text = notice ?? lasting
    // The desktop draws the label inside token-weather's band (or above the band below), not here at the right.
    if (!text || e.surface === 'desktop') return next(e)
    // A plain label joins the engine's dim modes; a styled one (Fable, Opus) is drawn by us, after the other modes.
    if (notice || !lastingColor) return next({ ...e, props: { ...e.props, modes: [...e.props.modes, text] } })
    const mine = labelText($, e, text)
    if (!e.props.modes.length) return mine
    const { Box, Text } = $.ui.resolve(e)
    return el(Box, { flexDirection: 'row' }, await next(e), el(Text, { dimColor: true }, ' & '), mine)
  })

  // Above the prompt (terminal and desktop): the draft's model request, like ultracode's line, and on the desktop the mode
  // label when token-weather is not drawing it. The band beneath is an opaque engine node (type `engine`, no props or
  // children; a v0.1.44-0.1.45 diagnostic showed it): nothing can be added to its row, and every flex or absolute layout
  // beside it drew the label on a row of its own or half a row off (v0.1.35-0.1.46). So with token-weather running, IT
  // draws the label inside its own row, from the label state published above, and this hook draws none; without it the
  // label goes right-aligned on a row above whatever band there is. The render event's own surface is used because
  // session.start reports null for the desktop's SDK-style process. The terminal keeps the SessionMode label.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    const { value: weather } = await $.state.get(weatherReadings)
    const weatherDraws = Array.isArray(weather) && weather.length > 0
    const text = e.surface === 'desktop' && !weatherDraws ? (notice ?? lasting) : undefined
    if (!text && !draftModel) return inner
    const { Box, Text } = $.ui.resolve(e)
    // Ours, right-aligned: the draft's model request (every surface, like ultracode's line) over the desktop label.
    const rows = [
      ...(draftModel ? [el(Text, { dimColor: true }, requestNotice(draftModel))] : []),
      ...(text ? [labelText($, e, text)] : []),
    ]
    const right = el(Box, { paddingX: 1, flexDirection: 'column', alignItems: 'flex-end' }, ...rows)
    return el(Box, { flexDirection: 'column' }, el(Box, { justifyContent: 'flex-end' }, right), inner)
  })

  // The mobile app: the turn's label as a row at the transcript's end (placed by session.measure below). Other surfaces
  // already have the label elsewhere, so a row seen there draws nothing.
  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    const row = e.props.plugin === PLUGIN_NAME && e.surface === 'mobile' ? placedRows.get(e.props.id) : undefined
    if (!row) return next(e)
    const { Text } = $.ui.resolve(e)
    return row.color ? el(Text, { color: row.color, bold: row.bold }, row.text) : el(Text, { dimColor: true }, row.text)
  })

  // Fires after each main-thread turn (and when a rate-limit window moves): place the turn's row for a mobile app.
  on('session.measure', async ($, e, next) => {
    await placeRow($)
    return next(e)
  })

  // A `+name` in the draft: painted in the box and announced above it; the decision is made at turn.start.
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    const words = enabled ? modelKeywords(r.text) : []
    const forced = words.length ? forcedModel(r.text) : undefined
    setDraftModel($, forced ? (ids[forced] ?? forced) : undefined)
    if (!words.length) return r
    return { ...r, decorations: [...(r.decorations ?? []), ...keywordPaint(r.text)] }
  })

  on('prompt.change', ($, e, next) => {
    const forced = enabled ? forcedModel(e.text) : undefined
    setDraftModel($, forced ? (ids[forced] ?? forced) : undefined)
    return next(e)
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
    await $.command.register({
      name: 'with-fable',
      description: 'auto-model-effort: let expert prompts use Fable (4 models instead of 3) for this session',
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

  on('command.run', { command: 'with-fable' }, async ($, e) => {
    const result = withFableCommand(e.args, withFable)
    withFable = result.enabled
    // Turning Fable off also rewrites a standing Fable decision, which a turn without a typed prompt would reuse.
    if (!withFable && decision) decision = withoutFable(decision, efforts)
    show($, enabled && decision ? { decision } : null)
    notify($, fableNotice(withFable))
    return { text: result.message }
  })

  on('turn.start', async ($, e, next) => {
    // Empty text is a turn without a typed prompt (a background agent's notification, a continuation):
    // the previous decision stands.
    if (e.text.trim()) setDraftModel($, undefined)
    if (enabled && e.text.trim()) {
      const learned = await learnFromCatalog($, ids)
      ids = learned.ids
      efforts = Object.fromEntries(Object.entries(ids).flatMap(([family, id]) => (learned.efforts[id] ? [[family, learned.efforts[id]]] : [])))
      const messages = await $.session.messages()
      const images = promptImages(await $.session.messages({ as: 'api' }))
      imageCount = images.length
      // Haiku rates the prompt with its screenshots; a short follow-up with no screenshot after a decision skips
      // the call (the rules handle it), and a failed or unparseable call leaves `triage` undefined, so the
      // rule-based score stands in.
      let triage: number | undefined
      let triageFailed = false
      triageNote = undefined
      // A `+name` decides on its own (lib/select.mjs forcedModel), so Haiku is not asked.
      if (!forcedModel(e.text) && !(decision && e.text.trim().length < SHORT_PROMPT && !images.length)) {
        const r = await triageCall($, e.text, images, ids.haiku ?? SEED_IDS.haiku)
        triage = r.score
        triageFailed = triage === undefined
        triageNote = r.note
      }
      decision = decide(e.text, {
        previous: decision,
        clientModel,
        contextTokens: JSON.stringify(messages).length / 4,
        downgradeLimit: DOWNGRADE_LIMIT,
        triage,
        triageFailed,
        images: images.length,
        efforts,
        fable: withFable,
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

    const { model, level, score, reason } = decision
    const effort = effortToSend(e.effort, decision.effort) // keeps an ultrathink turn's xhigh
    const stream = next({ ...e, model: ids[model] ?? e.model, effort })
    let gotContent = false
    // An 'engine' chunk is opaque bookkeeping (envelope, retry marker): a Fable usage-limit reply (verified
    // 2026-11-22) streams only one of these, with usage and stopReason null, so it must not count as a response.
    // They are held back until the first content chunk, so that a failed attempt's chunk (it drew a red "out of
    // usage credits" line above the Opus answer, seen 2026-11-22) can be dropped when the request is retried.
    const held: TurnStepChunk[] = []
    for await (const chunk of stream) {
      if (chunk.kind === 'engine' && !gotContent) {
        held.push(chunk)
        continue
      }
      if (!gotContent) {
        gotContent = true
        for (const h of held) yield h
        held.length = 0
      }
      yield chunk
    }
    let result = await stream.result

    // No response at all (the API rejected the rewritten request, or Fable's usage limit answered) and the user
    // did not interrupt: leave the rest of this prompt alone and send the request once more on the session's own model.
    const fallback = !gotContent && result.usage === null && result.stopReason === null && !next.signal.aborted
    if (!fallback) for (const h of held) yield h // an empty but real response (or Esc) keeps its chunks
    let fallbackFailed = fallback
    // What the log records: the first choice, or Opus when a Fable request fell back to it.
    let logged = { model, effort, reason, chosen: decision.effort }
    if (fallback && model === MODELS.fable) {
      // Fable has its own usage limit; Opus is the nearest model (user's choice 2026-11-22), and the rest of the
      // prompt stays on it (the decision is not passive). A short notice lets the user cancel (Esc) or turn Fable off.
      decision = { ...withoutFable(decision, efforts), reason: 'fable-limit' }
      const opusEffort = effortToSend(e.effort, decision.effort)
      logged = { model: decision.model, effort: opusEffort, reason: decision.reason, chosen: decision.effort }
      notify($, fallbackNotice(ids.opus ?? SEED_IDS.opus), FALLBACK_NOTICE_MS)
      result = yield* next({ ...e, model: ids.opus ?? SEED_IDS.opus, effort: opusEffort })
      fallbackFailed = result.usage === null && result.stopReason === null && result.answer === '' && !next.signal.aborted
    }
    if (fallbackFailed) {
      decision = { ...decision, passive: true, reason: 'rejected' }
      result = yield* next(e)
    }

    const u = result.usage
    ids = await remember($, ids, u?.model)
    show($, { decision, responseModel: u?.model, sentEffort: fallback ? undefined : effort })
    rowPending = true
    await record($, {
      step: e.index,
      model: logged.model,
      effort: logged.effort,
      level,
      score,
      reason: logged.reason,
      ...(e.index === 0 && triageNote ? { triageNote } : {}),
      ...(e.index === 0 && imageCount ? { images: imageCount } : {}),
      ...(logged.effort !== logged.chosen ? { chosenEffort: logged.chosen } : {}), // session's xhigh/max kept
      responseModel: u?.model,
      cacheWrite: u?.cache_creation_input_tokens,
      cacheRead: u?.cache_read_input_tokens,
      ...(fallback ? { fallback: true } : {}),
    })
    return result
  })
}
