// Claude Code statusline komutu: claude-auto router'ının bu oturum için son kararını gösterir.
// Claude Code stdin'den oturum bilgisini (session_id dahil) JSON olarak verir; router aynı kimlikle
// durum dizinine (%TEMP%/claude-auto/<session_id>.json) yazar. claude-auto.ps1 bunu --settings ile bağlar.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { durumDizini } from "./router.mjs";

const ADLAR = { "claude-haiku-5-5": "Haiku 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5" };
const ad = (model) => ADLAR[model] ?? model ?? "?";

export function satir(d) {
  if (!d) return "⚡ auto · ilk prompt bekleniyor";
  if (d.atlandi) return `⚡ auto kapalı (${d.atlandi})`;
  const k = d.karar ?? {};
  if (k.pasif) return `⚡ auto geri döndü (${k.sebep}) → ${ad(d.yanit_modeli)}`;
  // Yanıt geldiyse sunucunun gerçekten çalıştırdığı model, gelmediyse verilen karar gösterilir.
  const parcalar = [`⚡ auto → ${ad(d.yanit_modeli ?? k.model)}`, k.effort, `${k.seviye} (${k.skor ?? "-"})`];
  if (k.sebep && k.sebep !== "skor") parcalar.push(k.sebep);
  return parcalar.filter(Boolean).join(" · ");
}

export function durumOku(sessionId, dizin = durumDizini()) {
  if (!/^[\w-]{1,100}$/.test(String(sessionId ?? ""))) return null;
  try {
    return JSON.parse(readFileSync(join(dizin, `${sessionId}.json`), "utf8"));
  } catch {
    return null; // henüz karar yok ya da router başka bir oturumu yönetiyor
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let girdi = {};
  try {
    girdi = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // statusline girdisi okunamazsa da bir satır basılmalı
  }
  console.log(satir(durumOku(girdi.session_id)));
}
