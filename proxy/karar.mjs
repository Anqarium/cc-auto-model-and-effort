// Bir /v1/messages gövdesinden model + effort kararı üretir.
// Kurallar: (1) yalnızca ana konuşma turlarına dokun, (2) aynı kullanıcı prompt'u boyunca kararı sabit tut,
// (3) cache'i boşa harcama: büyük bağlamda model düşürme (yükseltme serbest),
// (4) kanıt yoksa ucuz modele inme: varsayılan sonnet/medium, haiku yalnızca açık "kolay" işaretiyle.
import { createHash } from "node:crypto";
import { skorla } from "./skor.mjs";

export const MODELLER = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};
const SIRA = { [MODELLER.haiku]: 0, [MODELLER.sonnet]: 1, [MODELLER.opus]: 2 };

// Seviye -> model + effort. Yanlış ucuz model, yanlış pahalı modelden daha zararlı olduğu için
// sinyalsiz/az sinyalli prompt sonnet/medium'da kalır.
export const ESLEME = {
  trivial: { model: MODELLER.sonnet, effort: "medium" },
  simple: { model: MODELLER.sonnet, effort: "medium" },
  moderate: { model: MODELLER.sonnet, effort: "high" },
  complex: { model: MODELLER.opus, effort: "medium" },
  expert: { model: MODELLER.opus, effort: "high" },
};
// Prompt'ta açık bir kolay işaret (yeniden adlandır, typo, listele...) varsa ucuz tarafa inilir.
export const KOLAY_ESLEME = {
  trivial: { model: MODELLER.haiku, effort: "low" },
  simple: { model: MODELLER.sonnet, effort: "low" },
};

// Claude Code'un kullanıcı adına enjekte ettiği bloklar; gerçek prompt sayılmaz.
const SISTEM_BLOKLARI = /^\s*<(system-reminder|local-command|command-(name|message|args)|task-notification|bash-(input|stdout|stderr))/;
const KISA_DEVAM = 25; // sinyalsiz kısa yanıt ("evet", "devam et") önceki kararı sürdürür.

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

const atla = (sebep) => ({ atla: true, sebep });

// ipucu: { oturumId, sinif, promptId, ajanId } — Claude Code gateway başlıkları
// (x-claude-code-session-id, -request-class, -prompt-id, -agent-id; CLAUDE_CODE_GATEWAY_HINT_HEADERS=1 gerekir).
// Dönüş: { atla: true, sebep } ya da { model, effort, sebep, ... }.
export function kararVer(body, ipucu, oturumlar, cfg) {
  if (ipucu.sinif) {
    if (ipucu.sinif !== "main") return atla(`sinif:${ipucu.sinif}`);
  } else {
    // Başlıklar kapalıysa yedek sezgiler (daha az güvenilir).
    if (ipucu.ajanId) return atla("alt-ajan");
    if (!Array.isArray(body?.tools) || body.tools.length === 0) return atla("arac-yok");
  }
  if (!cfg.yonlendirilecek.includes(body?.model)) return atla(`model:${body?.model}`);
  const prompt = gercekPrompt(body.messages);
  if (!prompt) return atla("prompt-yok");

  // prompt-id varsa doğrudan onu kullan; yoksa indeks + metin özeti (rewind'da aynı indekse farklı prompt gelebilir).
  const anahtar = ipucu.promptId
    ? `p:${ipucu.promptId}`
    : `i:${prompt.index}:${createHash("sha1").update(prompt.text).digest("hex").slice(0, 12)}`;

  const onceki = oturumlar.get(ipucu.oturumId);
  if (onceki?.anahtar === anahtar) return { ...onceki.karar, sebep: onceki.karar.pasif ? onceki.karar.sebep : "ayni-prompt" };

  const s = skorla(prompt.text);
  const hedef = (s.sinyaller.includes("kolay-isaret") && KOLAY_ESLEME[s.seviye]) || ESLEME[s.seviye];
  let karar = { ...hedef, skor: s.skor, seviye: s.seviye, sinyaller: s.sinyaller, sebep: "skor" };

  if (onceki && !onceki.karar.pasif && s.skor === 0 && prompt.text.length < KISA_DEVAM) {
    karar = { ...onceki.karar, sebep: "kisa-devam" };
  } else {
    // İlk istekte taban istemcinin istediği model: büyük bağlamla (--resume) başlayan oturum düşürülmez.
    const simdiki = (!onceki?.karar.pasif && onceki?.karar.model) || body.model;
    const baglamTokeni = JSON.stringify(body.messages).length / 4;
    if (SIRA[hedef.model] < SIRA[simdiki] && baglamTokeni > cfg.dusurmeTokenSiniri) {
      karar = { ...karar, model: simdiki, sebep: "cache-histerezisi" };
    }
  }

  oturumlar.set(ipucu.oturumId, { anahtar, karar });
  return karar;
}

// Yeniden yazılan istek reddedilince (ör. 400) o prompt'un geri kalanında gövdeye dokunulmaz.
export function pasiflestir(oturumlar, oturumId, sebep) {
  const kayit = oturumlar.get(oturumId);
  if (kayit) oturumlar.set(oturumId, { ...kayit, karar: { pasif: true, sebep } });
}

// Kararı gövdeye uygular; değişen bir şey varsa true döner.
export function uygula(body, karar) {
  if (karar.atla || karar.pasif) return false;
  const effortAyni = body.output_config?.effort === karar.effort;
  if (body.model === karar.model && effortAyni) return false;
  body.model = karar.model;
  body.output_config = { ...(body.output_config ?? {}), effort: karar.effort };
  return true;
}
