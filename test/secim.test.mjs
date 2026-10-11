// secimYap: mod'un (hooks/register.ts) karar mantığı. Mod Node'suz çalıştığı ve test kiti turn.step'i
// tetikleyemediği için mantık burada doğrudan test edilir.
import test from "node:test";
import assert from "node:assert/strict";
import { MODELLER, effortBul, secimYap } from "../lib/secim.mjs";

test("effort bantları: medium geniş, high yalnızca model eşiğinin üstünde, low yok", () => {
  assert.equal(effortBul(MODELLER.haiku, 100), "medium");
  assert.deepEqual([30, 31].map((s) => effortBul(MODELLER.sonnet, s)), ["medium", "high"]);
  assert.deepEqual([41, 75, 76].map((s) => effortBul(MODELLER.opus, s)), ["medium", "medium", "high"]);
  const orta = secimYap("veri çekme kodunda race condition olabilir mi? incele"); // 27
  assert.deepEqual([orta.model, orta.effort], [MODELLER.sonnet, "medium"]);
  const ortaYuksek = secimYap("veri çekme kodunda race condition olabilir mi? neden olur, incele ve alternatifleri karşılaştır"); // 37
  assert.deepEqual([ortaYuksek.model, ortaYuksek.effort], [MODELLER.sonnet, "high"]);
  const mimari = secimYap("bu servisin mimari tasarımını yap"); // 44
  assert.deepEqual([mimari.model, mimari.effort], [MODELLER.opus, "medium"]);
});

test("kısa ama sinyalli prompt önceki kararı devralmaz, skorlanır", () => {
  const onceki = secimYap("bu servisin mimari tasarımını yap");
  assert.equal(secimYap("neden çalışmıyor?", { onceki }).sebep, "skor");
});

test("varsayılanlarla: kolay → haiku/medium, sinyalsiz → sonnet/medium, zor → opus", () => {
  assert.deepEqual(
    [secimYap("bu fonksiyonu yeniden adlandır").model, secimYap("bu fonksiyonu yeniden adlandır").effort],
    [MODELLER.haiku, "medium"]
  );
  assert.deepEqual([secimYap("Implement the feature").model, secimYap("Implement the feature").effort], [MODELLER.sonnet, "medium"]);
  assert.equal(secimYap("bu servisin mimari tasarımını yap").model, MODELLER.opus);
});

test("kısa sinyalsiz devam önceki kararı sürdürür; pasif önceki karar sürdürülmez", () => {
  const onceki = secimYap("bu servisin mimari tasarımını yap");
  assert.deepEqual([secimYap("devam et", { onceki }).model, secimYap("devam et", { onceki }).sebep], [MODELLER.opus, "kisa-devam"]);
  assert.equal(secimYap("devam et", { onceki: { pasif: true, sebep: "red:400" } }).sebep, "skor");
});

test("histerezis: büyük bağlamda önceki modelden ya da istemci modelinden aşağı inilmez", () => {
  const onceki = secimYap("bu servisin mimari tasarımını yap");
  const k = secimYap("bu fonksiyonu yeniden adlandır", { onceki, baglamTokeni: 50000 });
  assert.deepEqual([k.model, k.sebep, k.effort], [MODELLER.opus, "cache-histerezisi", "medium"]);
  const ilk = secimYap("bu fonksiyonu yeniden adlandır", { istemciModeli: MODELLER.sonnet, baglamTokeni: 50000 });
  assert.equal(ilk.model, MODELLER.sonnet);
  assert.equal(secimYap("bu fonksiyonu yeniden adlandır", { onceki, baglamTokeni: 1000 }).model, MODELLER.haiku);
});
