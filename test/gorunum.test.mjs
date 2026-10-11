import test from "node:test";
import assert from "node:assert/strict";
import { autoKomutu, durumBildirimi, etiket, logOzeti } from "../lib/gorunum.mjs";

test("'ayni-prompt' sebebi gürültü olduğu için etikete eklenmez", () => {
  const karar = { model: "claude-sonnet-5-5", effort: "medium", seviye: "simple", skor: 10, sebep: "ayni-prompt" };
  assert.equal(etiket({ karar }), "⚡ Sonnet 5.5 · medium · simple 10");
});

test("logOzeti: dağılım, gerçek model/cache toplamları, geri dönüş ve atlananlar", () => {
  assert.equal(logOzeti([]), "Henüz kayıt yok.");
  assert.equal(logOzeti(undefined), "Henüz kayıt yok.");
  const ozet = logOzeti([
    { t: "2026-10-11T14:00:00.000Z", adim: 0, model: "claude-haiku-5-5", effort: "medium", seviye: "trivial", skor: 0, sebep: "skor", yanit_modeli: "claude-haiku-5-5", cache_yazma: 100, cache_okuma: 0 },
    { t: "2026-10-11T14:00:05.000Z", adim: 1, model: "claude-haiku-5-5", effort: "medium", seviye: "trivial", skor: 0, sebep: "skor", yanit_modeli: "claude-haiku-5-5", cache_yazma: 0, cache_okuma: 300 },
    { t: "2026-10-11T14:02:00.000Z", adim: 0, model: "claude-opus-5-5", effort: "high", seviye: "expert", skor: 80, sebep: "skor", yanit_modeli: "claude-sonnet-5-5", geri_donus: true },
    { t: "2026-10-11T14:03:00.000Z", adim: 0, atlandi: "model:claude-opus-5-5" },
  ]);
  assert.match(ozet, /4 model isteği, 2 prompt kararı/);
  assert.match(ozet, /Haiku 5\.5: 2 istek, yazma 100, okuma 300 \(okuma %75\)/);
  assert.match(ozet, /Geri dönüş: 1 · Atlanan: 1/);
});

test("etiket: önek yok, kısa; karar yokken gösterilmez", () => {
  assert.equal(etiket(null), undefined);
  const karar = { model: "claude-opus-5-5", effort: "medium", seviye: "complex", skor: 49, sebep: "skor" };
  assert.equal(etiket({ karar }), "⚡ Opus 5.5 · medium · complex 49");
  assert.equal(etiket({ karar, yanit_modeli: "claude-haiku-5-5" }), "⚡ Haiku 5.5 · medium · complex 49");
  assert.equal(etiket({ karar: { ...karar, sebep: "kisa-devam" } }), "⚡ Opus 5.5 · medium · complex 49 · kisa-devam");
  assert.equal(etiket({ atlandi: "model:claude-opus-5-5" }), "auto kapalı");
  assert.equal(etiket({ karar: { pasif: true, sebep: "red" }, yanit_modeli: "claude-sonnet-5-5" }), "auto ↩ Sonnet 5.5");
});

test("autoKomutu: argümansız aç/kapat, ac/aç/on açar, kapat/off kapatır, bilinmeyen durumu korur", () => {
  assert.equal(autoKomutu("", true).acik, false);
  assert.equal(autoKomutu("  ", false).acik, true);
  for (const a of ["ac", "aç", "AÇ", "on"]) assert.equal(autoKomutu(a, false).acik, true, a);
  for (const a of ["kapat", "KAPAT", "off"]) assert.equal(autoKomutu(a, true).acik, false, a);
  const bilinmeyen = autoKomutu("belki", true);
  assert.equal(bilinmeyen.acik, true);
  assert.match(bilinmeyen.mesaj, /Kullanım: \/auto \[ac\|kapat\]/);
});

test("durumBildirimi: açık/kapalı ve nasıl değiştirileceği", () => {
  assert.equal(durumBildirimi(true), "⚡ auto açık · /auto ile kapat");
  assert.equal(durumBildirimi(false), "auto kapalı · /auto ile aç");
});
