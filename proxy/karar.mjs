// Bir /v1/messages gövdesinden model + effort kararı üretir.
// Üç kural: (1) yalnızca ana ajan isteklerine dokun, (2) aynı kullanıcı prompt'u boyunca kararı sabit tut,
// (3) cache'i boşa harcama: büyük bağlamda model düşürme (yükseltme her zaman serbest).
import { skorla } from "./skor.mjs";

export const MODELLER = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};
const SIRA = { [MODELLER.haiku]: 0, [MODELLER.sonnet]: 1, [MODELLER.opus]: 2 };

// Seviye -> model + effort. Tek yerde, kolay ayarlanır.
export const ESLEME = {
  trivial: { model: MODELLER.haiku, effort: "low" },
  simple: { model: MODELLER.sonnet, effort: "low" },
  moderate: { model: MODELLER.sonnet, effort: "medium" },
  complex: { model: MODELLER.opus, effort: "medium" },
  expert: { model: MODELLER.opus, effort: "high" },
};

const SISTEM_BLOKLARI = /^\s*<(system-reminder|local-command|command-(name|message|args))/;
const KISA_DEVAM = 25; // "evet", "devam et", "tamam" gibi kısa yanıtlar önceki kararı sürdürür.

// Mesajlar arasında kullanıcının yazdığı gerçek son prompt (araç sonuçları ve sistem blokları hariç).
export function gercekPrompt(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const bloklar = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    if (!Array.isArray(bloklar)) continue;
    const metin = bloklar
      .filter((b) => b?.type === "text" && typeof b.text === "string" && !SISTEM_BLOKLARI.test(b.text))
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (metin) return { index: i, text: metin };
  }
  return null;
}

// Basit LRU: oturum başına son karar ve hangi prompt için verildiği.
export class Oturumlar {
  #harita = new Map();
  constructor(azami = 200) {
    this.azami = azami;
  }
  get(id) {
    const v = this.#harita.get(id);
    if (v) {
      this.#harita.delete(id);
      this.#harita.set(id, v);
    }
    return v;
  }
  set(id, deger) {
    this.#harita.delete(id);
    this.#harita.set(id, deger);
    if (this.#harita.size > this.azami) this.#harita.delete(this.#harita.keys().next().value);
  }
}

export function kararVer(body, oturumId, oturumlar, cfg) {
  if (!cfg.yonlendirilecek.includes(body?.model)) return null; // alt ajan / arka plan modelleri
  if (!Array.isArray(body.tools) || body.tools.length === 0) return null; // araçsız = arka plan isteği
  const prompt = gercekPrompt(body.messages);
  if (!prompt) return null;

  const onceki = oturumlar.get(oturumId);
  if (onceki && onceki.promptIndex === prompt.index) return { ...onceki.karar, sebep: "ayni-prompt" };

  let karar;
  if (onceki && prompt.text.length < KISA_DEVAM) {
    karar = { ...onceki.karar, sebep: "kisa-devam" };
  } else {
    const s = skorla(prompt.text);
    const hedef = ESLEME[s.seviye];
    karar = { ...hedef, skor: s.skor, seviye: s.seviye, sinyaller: s.sinyaller, sebep: "skor" };

    // İlk istekte taban istemcinin istediği model: büyük bir bağlamla (--resume) başlayan oturum
    // ucuz modele düşürülmez (cache + bağlam penceresi riski).
    const simdiki = onceki?.karar.model ?? body.model;
    const dusuruluyor = SIRA[hedef.model] < SIRA[simdiki];
    const baglamTokeni = JSON.stringify(body.messages).length / 4;
    if (dusuruluyor && baglamTokeni > cfg.dusurmeTokenSiniri) {
      karar = { ...karar, model: simdiki, sebep: "cache-histerezisi" };
    }
  }

  oturumlar.set(oturumId, { promptIndex: prompt.index, karar });
  return karar;
}

// Kararı gövdeye uygular; değişen bir şey varsa true döner.
export function uygula(body, karar) {
  const effortAyni = body.output_config?.effort === karar.effort;
  if (body.model === karar.model && effortAyni) return false;
  body.model = karar.model;
  body.output_config = { ...(body.output_config ?? {}), effort: karar.effort };
  return true;
}
