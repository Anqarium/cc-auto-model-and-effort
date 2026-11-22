// Claude Code mod: scores every user prompt and sends the main conversation's model requests (turn.step)
// with the chosen model + effort. The decision logic and the display text live in pure modules under lib/
// (lib/select.mjs, lib/display.mjs), kept out of the mod code so they can be tested with Node.
import type { EngineInterface, Register, RenderElement, Timer, TurnStepChunk } from 'claude-code'
import { MODELS, SEED_IDS, decide, effortToSend, forcedModel, learnModel, modelKeywords, withoutFable } from '../lib/select.mjs'
import { effortsFromCatalog, idsFromCatalog } from '../lib/catalog.mjs'
import { autoCommand, compactLabel, fableNotice, fallbackNotice, label, labelStyle, logSummary, modelStyle, requestNotice, statusNotice, withFableCommand } from '../lib/display.mjs'
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
// Desktop band widths (`bodyColumns`; the proportional font makes a column narrower than a character). Measured
// 2026-11-10: a ~770 px band reports 98-99 columns, a ~575 px one 74, and token-weather's band takes about 60 of them.
// Below FULL_LABEL_COLUMNS the label is shortened (compactLabel); below SAME_ROW_COLUMNS (plus the request line's own
// length when the draft names a model) it gets its own row above the band instead of sharing token-weather's.
const FULL_LABEL_COLUMNS = 80
const SAME_ROW_COLUMNS = 60

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

function show($: EngineInterface, d: Parameters<typeof label>[0]) {
  lasting = label(d)
  const style = labelStyle(d)
  lastingColor = style.color
  lastingBold = !!style.bold
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
  // /with-fable: an expert prompt may go to Fable (4 models instead of 3). Off at every session start: it is pricey.
  let withFable = false
  // Why the last prompt's Haiku triage gave no rating (undefined when it did or was skipped); logged with its first step.
  let triageNote: string | undefined
  // How many screenshots the last prompt carried; logged with its first step.
  let imageCount = 0

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const text = notice ?? lasting
    // The desktop draws the label at the left of the footer (PromptHint below), not here at the right.
    if (!text || e.surface === 'desktop') return next(e)
    // A plain label joins the engine's dim modes; a styled one (Fable, Opus) is drawn by us, after the other modes.
    if (notice || !lastingColor) return next({ ...e, props: { ...e.props, modes: [...e.props.modes, text] } })
    const mine = labelText($, e, text)
    if (!e.props.modes.length) return mine
    const { Box, Text } = $.ui.resolve(e)
    return el(Box, { flexDirection: 'row' }, await next(e), el(Text, { dimColor: true }, ' & '), mine)
  })

  // The desktop draws SessionMode too, but the label there was cut off and doubled the band's copy, so on the desktop it
  // goes only into the AbovePrompt band (PromptHint, at the left of the footer, was tried in v0.1.34: the desktop does not
  // draw it). The render event's own surface is used because session.start reports null for the desktop's SDK-style
  // process. The terminal keeps SessionMode. Other bands (token-weather) are kept.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (e.props.hasSurvey) return inner
    let text = e.surface === 'desktop' ? (notice ?? lasting) : undefined
    if (!text && !draftModel) return inner
    const { Box, Text } = $.ui.resolve(e)
    // A narrow band gets the shorter label (no effort part); a notice keeps its text, it says what to type.
    // The width may be missing on the desktop (the types: "absent where no surface has measured"; the label sat on its own
    // row at full length, which only a non-number width explains): fall back to the viewport's, else assume it is wide.
    const measured = e.props.bodyColumns ?? e.viewport?.columns
    const columns = typeof measured === 'number' && Number.isFinite(measured) ? measured : Infinity
    if (text && !notice && columns < FULL_LABEL_COLUMNS) text = compactLabel(text)
    // Ours, right-aligned: the draft's model request (every surface, like ultracode's line) over the desktop label.
    const rows = [
      ...(draftModel ? [el(Text, { dimColor: true }, requestNotice(draftModel))] : []),
      ...(text ? [labelText($, e, text)] : []),
    ]
    const right = el(Box, { paddingX: 1, flexDirection: 'column', alignItems: 'flex-end' }, ...rows)
    // Same row as the band beneath (token-weather's), ours at the far right (the band shrinks for it; wrapping the row
    // instead, v0.1.35, sent ours under the band every time because the band fills the width). Only in a very narrow
    // window, or for the draft's longer request line without room, ours goes on its own row above the band.
    const need = SAME_ROW_COLUMNS + (draftModel ? requestNotice(draftModel).length + 4 : 0)
    if (inner && columns >= need) {
      return el(Box, { flexDirection: 'row', justifyContent: 'space-between' }, inner, right)
    }
    return el(Box, { flexDirection: 'column' }, el(Box, { justifyContent: 'flex-end' }, right), inner)
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
