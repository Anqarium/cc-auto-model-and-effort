// Claude Code mod'u: her kullanıcı prompt'unu skorlar ve ana konuşmanın model isteklerini (turn.step)
// seçilen model + effort ile gönderir. Proxy'ye (proxy/router.mjs) gerek bırakmaz; seçim mantığı ve
// statusline metni proxy ile ortaktır (proxy/secim.mjs, proxy/gorunum.mjs).
import type { Register } from 'claude-code'
import { MODELLER, secimYap } from '../proxy/secim.mjs'
import { satir } from '../proxy/gorunum.mjs'

// Yalnızca oturum bu modeldeyken yönlendirilir; /model ile başka modele geçmek yönlendirmeyi kapatır.
const YONLENDIRILECEK = new Set<string>([MODELLER.sonnet])
// Konuşma bu kadar token'ı aşınca model düşürülmez (yeni model için cache baştan yazılır).
const DUSURME_SINIRI = 30000

type Karar = ReturnType<typeof secimYap>

export const register: Register = on => {
  let karar: Karar | null = null
  let istemciModeli: string = MODELLER.sonnet

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
      $.ui.status(satir({ karar }))
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e) // alt ajanlar kendi modelinde kalır
    istemciModeli = e.model
    if (!karar) return yield* next(e)
    if (!YONLENDIRILECEK.has(e.model)) {
      $.ui.status(satir({ atlandi: `model:${e.model}` }))
      return yield* next(e)
    }
    const sonuc = yield* next({ ...e, model: karar.model, effort: karar.effort })
    // usage.model: API'nin bildirdiği, isteği gerçekten yanıtlayan model.
    if (sonuc.usage) $.ui.status(satir({ karar, yanit_modeli: sonuc.usage.model }))
    return sonuc
  })
}
