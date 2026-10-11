import test from "node:test";
import assert from "node:assert/strict";
import { skorla, seviyeBul } from "../lib/skor.mjs";

test("mekanik istek: trivial + kolay işaret", () => {
  const s = skorla("bu fonksiyonu yeniden adlandır");
  assert.equal(s.seviye, "trivial");
  assert.ok(s.sinyaller.includes("kolay-isaret"));
});

test("tek cümlelik mimari isteği trivial/simple kalmaz", () => {
  const s = skorla("bu servisin mimari tasarımını yap");
  assert.ok(s.skor > 40, `skor ${s.skor}`);
  assert.equal(s.seviye, "complex");
});

test("Türkçe karakterle başlayan kelimeler eşleşir (çöküyor, şifrele)", () => {
  assert.ok(skorla("uygulama başlatınca çöküyor").kategoriler.kod > 0);
  assert.ok(skorla("token'ları şifrele ve oauth akışını güncelle").kategoriler.alan > 0);
});

test("Türkçe ekler tolere edilir (mimarisi, güvenliği)", () => {
  assert.ok(skorla("sistemin mimarisi nasıl olmalı").kategoriler.agir > 0);
  assert.ok(skorla("güvenlik açığı var mı").kategoriler.agir > 0);
});

test("ünsüz yumuşaması: açık/açığı/açıkları ve eşzamanlılık/eşzamanlılığı ağır sayılır", () => {
  for (const p of ["güvenlik açık", "güvenlik açığı var", "güvenlik açıklarını değerlendir", "eşzamanlılık sorunu", "eşzamanlılığı test et"]) {
    assert.ok(skorla(p).kategoriler.agir > 0, p);
  }
});

test("kolay işaret yanlış pozitifleri: bulut, okul, gösterge eşleşmez", () => {
  for (const p of ["bulut altyapısına geçelim", "okul projesi için api", "gösterge paneli ekle"]) {
    assert.ok(!skorla(p).sinyaller.includes("kolay-isaret"), p);
  }
  assert.ok(skorla("şu dosyayı bul").sinyaller.includes("kolay-isaret"));
});

test("'bu nedenle' bağlacı akıl yürütme sayılmaz, 'neden' sayılır", () => {
  assert.equal(skorla("bu nedenle metni çevir").kategoriler.akil, 0);
  assert.ok(skorla("bu neden böyle oluyor").kategoriler.akil > 0);
});

test("kolay işaret ağır sinyali silmez ('bul ve düzelt: kök nedeni')", () => {
  const s = skorla("bul ve düzelt: kök nedeni");
  assert.ok(!s.sinyaller.includes("kolay-isaret"));
  assert.ok(s.kategoriler.agir > 0);
});

test("kod bloğu, dosya yolu ve hata kod puanı getirir", () => {
  const s = skorla("src/app.ts içinde hata var:\n```ts\nconst x = await f();\n```");
  assert.ok(s.kategoriler.kod >= 10, `kod ${s.kategoriler.kod}`);
});

test("uzun, çok yönlü prompt expert'e çıkar", () => {
  const uzun =
    "Kök neden analizi yap: dağıtık sistemde race condition ve güvenlik açığı var.\n" +
    "1. incele\n2. karşılaştır\n3. refactor planla\n" +
    "```js\nasync function f() { return await g(); }\n```\n" +
    "x".repeat(1200);
  assert.equal(skorla(uzun).seviye, "expert");
});

test("uzun yapıştırma event-loop'u kilitlemez (ReDoS) ve uzunluk yine ölçülür", () => {
  const baslangic = performance.now();
  const s = skorla("a.".repeat(100000));
  const sure = performance.now() - baslangic;
  assert.ok(sure < 300, `${Math.round(sure)} ms`);
  assert.equal(s.kategoriler.ayrinti, 15);
});

test("aynı girdi her çağrıda aynı sonucu verir (g bayraklı regex durumu sızmaz)", () => {
  const p = "kök neden analizi: race condition ve güvenlik açığı";
  const sonuclar = Array.from({ length: 5 }, () => skorla(p).skor);
  assert.equal(new Set(sonuclar).size, 1);
});

test("boş ve geçersiz girdi çökmez", () => {
  assert.equal(skorla("").skor, 0);
  assert.equal(skorla(undefined).skor, 0);
});

test("seviye sınırları", () => {
  assert.equal(seviyeBul(5), "trivial");
  assert.equal(seviyeBul(6), "simple");
  assert.equal(seviyeBul(20), "simple");
  assert.equal(seviyeBul(21), "moderate");
  assert.equal(seviyeBul(40), "moderate");
  assert.equal(seviyeBul(41), "complex");
  assert.equal(seviyeBul(65), "complex");
  assert.equal(seviyeBul(66), "expert");
});
