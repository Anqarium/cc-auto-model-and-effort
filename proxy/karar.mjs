// Proxy için: bir /v1/messages gövdesinden model + effort kararı üretir.
// Kurallar: (1) yalnızca ana konuşma turlarına dokun, (2) aynı kullanıcı prompt'u boyunca kararı sabit tut.
// Model/effort seçiminin kendisi (kanıtsız prompt ucuza inmez, cache histerezisi, kısa devam) secim.mjs'te;
// Claude Code mod'u (hooks/register.ts) da aynısını kullanır.
import { createHash } from "node:crypto";
import { secimYap } from "./secim.mjs";

export { MODELLER, ESLEME, KOLAY_ESLEME, YUKSEK_EFFORT_ESIGI, effortBul } from "./secim.mjs";

// Claude Code'un kullanıcı adına enjekte ettiği bloklar; gerçek prompt sayılmaz.
const SISTEM_BLOKLARI = /^\s*<(system-reminder|local-command|command-(name|message|args)|task-notification|bash-(input|stdout|stderr))/;

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

  const karar = secimYap(prompt.text, {
    onceki: onceki?.karar ?? null,
    istemciModeli: body.model,
    baglamTokeni: JSON.stringify(body.messages).length / 4,
    dusurmeSiniri: cfg.dusurmeTokenSiniri,
  });
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
