// Statusline metni. Saf modül: proxy'nin statusline.mjs'i ve Claude Code mod'u ($.ui.status) aynısını kullanır.
const ADLAR = { "claude-haiku-5-5": "Haiku 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5" };
const ad = (model) => ADLAR[model] ?? model ?? "?";

// d: { karar?, yanit_modeli?, atlandi? }
export function satir(d) {
  if (!d) return "⚡ auto · ilk prompt bekleniyor";
  if (d.atlandi) return `⚡ auto kapalı (${d.atlandi})`;
  const k = d.karar ?? {};
  if (k.pasif) return `⚡ auto geri döndü (${k.sebep}) → ${ad(d.yanit_modeli)}`;
  // Yanıt geldiyse sunucunun gerçekten çalıştırdığı model, gelmediyse verilen karar gösterilir.
  const parcalar = [`⚡ auto → ${ad(d.yanit_modeli ?? k.model)}`, k.effort, `${k.seviye} (${k.skor ?? "-"})`];
  // "ayni-prompt" ajan döngüsünde her istekte görünür, bilgi taşımaz; yalnızca istisnai sebepler gösterilir.
  if (k.sebep && !["skor", "ayni-prompt"].includes(k.sebep)) parcalar.push(k.sebep);
  return parcalar.filter(Boolean).join(" · ");
}
