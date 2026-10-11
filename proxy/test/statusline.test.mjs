import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { satir, durumOku } from "../statusline.mjs";

test("karar yokken bekleme mesajı", () => {
  assert.equal(satir(null), "⚡ auto · ilk prompt bekleniyor");
});

test("yanıt gelmişse gerçek model, gelmemişse karar gösterilir", () => {
  const karar = { model: "claude-opus-5-5", effort: "high", seviye: "expert", skor: 72, sebep: "skor" };
  assert.equal(satir({ karar }), "⚡ auto → Opus 5.5 · high · expert (72)");
  assert.equal(satir({ karar, yanit_modeli: "claude-sonnet-5-5" }), "⚡ auto → Sonnet 5.5 · high · expert (72)");
});

test("skor dışı sebep, atlama ve geri dönüş görünür", () => {
  const karar = { model: "claude-opus-5-5", effort: "low", seviye: "trivial", skor: 0, sebep: "cache-histerezisi" };
  assert.match(satir({ karar }), /cache-histerezisi$/);
  assert.equal(satir({ atlandi: "model:claude-opus-5-5" }), "⚡ auto kapalı (model:claude-opus-5-5)");
  assert.equal(satir({ karar: { pasif: true, sebep: "red:400" }, yanit_modeli: "claude-sonnet-5-5" }), "⚡ auto geri döndü (red:400) → Sonnet 5.5");
});

test("durumOku: dosyayı okur, geçersiz ya da yol içeren kimliği reddeder", () => {
  const dizin = mkdtempSync(join(tmpdir(), "durum-"));
  writeFileSync(join(dizin, "abc-123.json"), JSON.stringify({ atlandi: "x" }));
  assert.deepEqual(durumOku("abc-123", dizin), { atlandi: "x" });
  assert.equal(durumOku("yok", dizin), null);
  assert.equal(durumOku("../abc-123", dizin), null);
  assert.equal(durumOku(undefined, dizin), null);
});

test("'ayni-prompt' sebebi gürültü olduğu için gösterilmez", () => {
  const karar = { model: "claude-sonnet-5-5", effort: "medium", seviye: "simple", skor: 10, sebep: "ayni-prompt" };
  assert.equal(satir({ karar }), "⚡ auto → Sonnet 5.5 · medium · simple (10)");
});

test("logOzeti: dağılım, gerçek model/cache toplamları, geri dönüş ve atlananlar", async () => {
  const { logOzeti } = await import("../gorunum.mjs");
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
