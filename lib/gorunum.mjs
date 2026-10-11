// Mod'un status satırı ($.ui.status) ve /auto-log metni. Saf modül: mod Node'suz ortamda çalışır.
const ADLAR = { "claude-haiku-5-5": "Haiku 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5" };
const ad = (model) => ADLAR[model] ?? model ?? "?";

// Mod'un /auto-log komutu: $.store'daki kayıtlardan özet. Her kayıt bir ana model isteğidir:
// { t, adim, model, effort, seviye, skor, sebep, yanit_modeli?, cache_yazma?, cache_okuma?, geri_donus?, atlandi? }
export function logOzeti(kayitlar, sonKac = 15) {
  if (!kayitlar?.length) return "Henüz kayıt yok.";
  const modeller = {};
  for (const k of kayitlar) {
    if (!k.yanit_modeli) continue;
    const m = (modeller[ad(k.yanit_modeli)] ??= { istek: 0, yazma: 0, okuma: 0 });
    m.istek++;
    m.yazma += k.cache_yazma ?? 0;
    m.okuma += k.cache_okuma ?? 0;
  }
  const promptlar = kayitlar.filter((k) => k.adim === 0 && !k.atlandi);
  const dagilim = {};
  for (const k of promptlar) dagilim[`${ad(k.model)} / ${k.effort}`] = (dagilim[`${ad(k.model)} / ${k.effort}`] ?? 0) + 1;

  const satirlar = [`${kayitlar.length} model isteği, ${promptlar.length} prompt kararı`, "", "Karar dağılımı:"];
  for (const [k, n] of Object.entries(dagilim).sort((a, b) => b[1] - a[1])) satirlar.push(`  ${k}: ${n}`);
  satirlar.push("", "Gerçek model ve cache (token):");
  for (const [m, v] of Object.entries(modeller)) {
    const oran = v.yazma + v.okuma ? Math.round((v.okuma / (v.yazma + v.okuma)) * 100) : 0;
    satirlar.push(`  ${m}: ${v.istek} istek, yazma ${v.yazma}, okuma ${v.okuma} (okuma %${oran})`);
  }
  const geri = kayitlar.filter((k) => k.geri_donus).length;
  const atlanan = kayitlar.filter((k) => k.atlandi).length;
  satirlar.push("", `Geri dönüş: ${geri} · Atlanan: ${atlanan}`, "", `Son ${Math.min(sonKac, promptlar.length)} karar:`);
  for (const k of promptlar.slice(-sonKac)) {
    satirlar.push(`  ${String(k.t ?? "").slice(5, 16).replace("T", " ")}  ${ad(k.model)} ${k.effort}  ${k.seviye} (${k.skor})${k.sebep !== "skor" ? ` · ${k.sebep}` : ""}`);
  }
  return satirlar.join("\n");
}

// Açılışta ve /auto sonrası birkaç saniye gösterilen durum bildirimi.
export const durumBildirimi = (acik) => (acik ? "⚡ auto açık · /auto ile kapat" : "auto kapalı · /auto ile aç");

// /auto komutu: argümansız aç/kapat, "ac|aç|on" açar, "kapat|off" kapatır. Dönüş: yeni durum ve mesaj.
export function autoKomutu(args, acik) {
  const a = String(args ?? "").trim().toLocaleLowerCase("tr");
  const yeni = a === "" ? !acik : ["ac", "aç", "on"].includes(a) ? true : ["kapat", "off"].includes(a) ? false : null;
  if (yeni === null) return { acik, mesaj: `Bilinmeyen argüman: "${a}". Kullanım: /auto [ac|kapat]` };
  return {
    acik: yeni,
    mesaj: yeni
      ? "auto-model-effort açık: her prompt'ta model ve effort otomatik seçilir."
      : "auto-model-effort bu oturumda kapalı: oturumun kendi modeli ve effort'u kullanılır. Açmak için /auto ac.",
  };
}

// Prompt satırının sağındaki mod etiketi (SessionMode). $.ui.status'un aksine Claude Code başına
// eklenti adı eklemez. Karar yokken undefined: etiket gösterilmez.
// d: { karar?, yanit_modeli?, atlandi? }. Yanıt geldiyse API'nin bildirdiği gerçek model gösterilir;
// "ayni-prompt" ajan döngüsünde her istekte görünür ve bilgi taşımaz, yalnızca istisnai sebepler eklenir.
export function etiket(d) {
  if (!d) return undefined;
  if (d.atlandi) return "auto kapalı";
  const k = d.karar ?? {};
  if (k.pasif) return `auto ↩ ${ad(d.yanit_modeli)}`;
  const parcalar = [`⚡ ${ad(d.yanit_modeli ?? k.model)}`, k.effort, `${k.seviye} ${k.skor ?? "-"}`];
  if (k.sebep && !["skor", "ayni-prompt"].includes(k.sebep)) parcalar.push(k.sebep);
  return parcalar.filter(Boolean).join(" · ");
}
