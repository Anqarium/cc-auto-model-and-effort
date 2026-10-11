// Prompt metninden model + effort seçimi. Saf modül: Node'a bağımlı değildir, çünkü Claude Code mod'u
// (hooks/register.ts) Node'suz bir ortamda çalışır.
import { skorla } from "./skor.mjs";

export const MODELLER = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};
const SIRA = { [MODELLER.haiku]: 0, [MODELLER.sonnet]: 1, [MODELLER.opus]: 2 };

// Seviye -> model. Yanlış ucuz model, yanlış pahalı modelden daha zararlı olduğu için
// sinyalsiz/az sinyalli prompt sonnet'te kalır; haiku yalnızca açık kolay işaretle (yeniden adlandır, listele...).
export const ESLEME = {
  trivial: MODELLER.sonnet,
  simple: MODELLER.sonnet,
  moderate: MODELLER.sonnet,
  complex: MODELLER.opus,
  expert: MODELLER.opus,
};
export const KOLAY_ESLEME = { trivial: MODELLER.haiku };

// Effort skora göre, model başına: medium her modelin varsayılanı olduğu için geniş tutulur;
// skor eşiği aşınca high. low kullanılmaz.
export const YUKSEK_EFFORT_ESIGI = { [MODELLER.haiku]: Infinity, [MODELLER.sonnet]: 30, [MODELLER.opus]: 75 };
export const effortBul = (model, skor) => (skor > (YUKSEK_EFFORT_ESIGI[model] ?? Infinity) ? "high" : "medium");

const KISA_DEVAM = 25; // sinyalsiz kısa yanıt ("evet", "devam et") önceki kararı sürdürür.

// Yeni bir kullanıcı prompt'u için karar.
// onceki: aynı oturumun önceki kararı (yoksa null); istemciModeli: oturumun kendi modeli;
// baglamTokeni: konuşmanın tahmini token sayısı; dusurmeSiniri: bunun üstünde model düşürülmez (cache).
export function secimYap(metin, { onceki = null, istemciModeli = MODELLER.sonnet, baglamTokeni = 0, dusurmeSiniri = 30000 } = {}) {
  const s = skorla(metin);
  if (onceki && !onceki.pasif && s.skor === 0 && metin.length < KISA_DEVAM) return { ...onceki, sebep: "kisa-devam" };

  const hedefModel = (s.sinyaller.includes("kolay-isaret") && KOLAY_ESLEME[s.seviye]) || ESLEME[s.seviye];
  let karar = { model: hedefModel, skor: s.skor, seviye: s.seviye, sinyaller: s.sinyaller, sebep: "skor" };

  // İlk kararda taban istemcinin modeli: büyük bağlamla (--resume) başlayan oturum düşürülmez.
  const simdiki = (onceki && !onceki.pasif && onceki.model) || istemciModeli;
  if (SIRA[hedefModel] < SIRA[simdiki] && baglamTokeni > dusurmeSiniri) {
    karar = { ...karar, model: simdiki, sebep: "cache-histerezisi" };
  }
  // Effort, sonunda hangi model çalışacaksa onun eşiğine göre belirlenir.
  karar.effort = effortBul(karar.model, s.skor);
  return karar;
}
