// secimYap: proxy (karar.mjs) ve mod (hooks/register.ts) ortak kullanır; mod tarafı Node'suz çalıştığı için
// burada doğrudan, istek gövdesi olmadan test edilir.
import test from "node:test";
import assert from "node:assert/strict";
import { MODELLER, secimYap } from "../secim.mjs";

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
