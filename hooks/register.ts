// Claude Code mod'u: her kullanıcı prompt'unu skorlar ve ana konuşmanın model isteklerini (turn.step)
// seçilen model + effort ile gönderir. Seçim mantığı ve etiket metni lib/ altındaki saf modüllerde
// (lib/secim.mjs, lib/gorunum.mjs); Node ile test edilebilsinler diye mod kodundan ayrı tutulur.
import type { EngineInterface, Register } from 'claude-code'
import { MODELLER, secimYap } from '../lib/secim.mjs'
import { etiket, logOzeti } from '../lib/gorunum.mjs'

// Yalnızca oturum bu modeldeyken yönlendirilir; /model ile başka modele geçmek yönlendirmeyi kapatır.
const YONLENDIRILECEK = new Set<string>([MODELLER.sonnet])
// Konuşma bu kadar token'ı aşınca model düşürülmez (yeni model için cache baştan yazılır).
const DUSURME_SINIRI = 30000
// Kalibrasyon logu: $.store'da (oturumlar arası), son bu kadar ana model isteği.
const LOG_ANAHTARI = 'kararlar'
const LOG_AZAMI = 2000

type Karar = ReturnType<typeof secimYap>

async function kaydet($: EngineInterface, girdi: Record<string, unknown>) {
  const eski = ((await $.store.get(LOG_ANAHTARI)) as unknown[] | undefined) ?? []
  const t = new Date(await $.clock.now()).toISOString()
  await $.store.set(LOG_ANAHTARI, [...eski, { t, ...girdi }].slice(-LOG_AZAMI))
}

// Prompt satırının sağındaki mod etiketi (SessionMode). $.ui.status kullanılmaz: Claude Code onun başına
// "⚠<eklenti adı>:" ekler. Etiket değişince ui.render yeniden çalıştırılır.
let etiketMetni: string | undefined

function goster($: EngineInterface, d: Parameters<typeof etiket>[0]) {
  etiketMetni = etiket(d)
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  let karar: Karar | null = null
  let istemciModeli: string = MODELLER.sonnet

  on('ui.render', { component: 'SessionMode' }, ($, e, next) =>
    etiketMetni ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, etiketMetni] } }) : next(e),
  )

  on('session.start', async ($, e, next) => {
    $.ui.status(undefined) // eski sürümün bıraktığı status satırını temizle
    await $.command.register({
      name: 'auto-log',
      description: 'auto-model-effort: model/effort kararlarının ve cache kullanımının özeti',
    })
    return next(e)
  })

  on('command.run', { command: 'auto-log' }, async $ => ({
    text: logOzeti((await $.store.get(LOG_ANAHTARI)) as Parameters<typeof logOzeti>[0]),
  }))

  on('turn.start', async ($, e, next) => {
    // Boş metin prompt'suz bir turdur (arka plan ajanı bildirimi, devam): önceki karar sürer.
    if (e.text.trim()) {
      const mesajlar = await $.session.messages()
      karar = secimYap(e.text, {
        onceki: karar,
        istemciModeli,
        baglamTokeni: JSON.stringify(mesajlar).length / 4,
        dusurmeSiniri: DUSURME_SINIRI,
      })
      goster($, { karar })
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e) // alt ajanlar kendi modelinde kalır
    istemciModeli = e.model
    if (!karar || karar.pasif) return yield* next(e)
    if (!YONLENDIRILECEK.has(e.model)) {
      goster($, { atlandi: `model:${e.model}` })
      if (e.index === 0) await kaydet($, { adim: e.index, atlandi: `model:${e.model}` })
      return yield* next(e)
    }

    const { model, effort, seviye, skor, sebep } = karar
    const akis = next({ ...e, model, effort })
    let parcaGeldi = false
    for await (const parca of akis) {
      parcaGeldi = true
      yield parca
    }
    let sonuc = await akis.result

    // Hiç yanıt gelmedi (API yeniden yazılan isteği reddetti) ve kullanıcı durdurmadı:
    // bu prompt'un geri kalanında dokunma ve isteği oturumun kendi modeliyle bir kez daha gönder.
    const geriDonus = !parcaGeldi && sonuc.usage === null && sonuc.stopReason === null && !next.signal.aborted
    if (geriDonus) {
      karar = { ...karar, pasif: true, sebep: 'red' }
      sonuc = yield* next(e)
    }

    const u = sonuc.usage
    goster($, { karar, yanit_modeli: u?.model })
    await kaydet($, {
      adim: e.index,
      model,
      effort,
      seviye,
      skor,
      sebep,
      yanit_modeli: u?.model,
      cache_yazma: u?.cache_creation_input_tokens,
      cache_okuma: u?.cache_read_input_tokens,
      ...(geriDonus ? { geri_donus: true } : {}),
    })
    return sonuc
  })
}
