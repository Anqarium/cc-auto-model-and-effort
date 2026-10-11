import test from "node:test";
import assert from "node:assert/strict";
import { MODELLER, Oturumlar, effortBul, gercekPrompt, kararVer, pasiflestir, uygula } from "../karar.mjs";

const cfg = { yonlendirilecek: [MODELLER.sonnet], dusurmeTokenSiniri: 30000 };
const arac = [{ name: "Bash" }];
const kullanici = (metin) => ({ role: "user", content: [{ type: "text", text: metin }] });
const gövde = (messages, ek = {}) => ({ model: MODELLER.sonnet, tools: arac, messages, ...ek });
const ana = (oturumId = "s", promptId) => ({ oturumId, sinif: "main", promptId });
const aracTuru = [
  { role: "assistant", content: [{ type: "tool_use", id: "1", name: "Bash", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "çıktı" }] },
];

test("gercekPrompt: araç sonucu, system-reminder ve task-notification bloklarını atlar", () => {
  const messages = [
    kullanici("mimari tasarım yap"),
    ...aracTuru,
    { role: "user", content: [{ type: "text", text: "<system-reminder>not</system-reminder>" }] },
    { role: "user", content: [{ type: "text", text: "<task-notification>ajan bitti</task-notification>" }] },
  ];
  assert.deepEqual(gercekPrompt(messages), { index: 0, text: "mimari tasarım yap" });
});

test("gercekPrompt: system-reminder ile karışık mesajda yalnızca kullanıcı metnini alır", () => {
  const m = {
    role: "user",
    content: [
      { type: "text", text: "<system-reminder>bağlam</system-reminder>" },
      { type: "text", text: "yeniden adlandır" },
    ],
  };
  assert.equal(gercekPrompt([m]).text, "yeniden adlandır");
});

test("zor prompt opus'a, açık kolay işaretli prompt haiku'ya", () => {
  const o = new Oturumlar();
  assert.equal(kararVer(gövde([kullanici("bu servisin mimari tasarımını yap")]), ana("s1"), o, cfg).model, MODELLER.opus);
  const kolay = kararVer(gövde([kullanici("bu fonksiyonu yeniden adlandır")]), ana("s2"), o, cfg);
  assert.deepEqual([kolay.model, kolay.effort], [MODELLER.haiku, "medium"]);
});

test("sinyalsiz prompt ucuz modele inmez: sonnet/medium", () => {
  const o = new Oturumlar();
  for (const [i, p] of ["Implement the feature described in the issue", "ödeme servisinde idempotency nasıl sağlarız"].entries()) {
    const k = kararVer(gövde([kullanici(p)]), ana(`s${i}`), o, cfg);
    assert.deepEqual([k.model, k.effort], [MODELLER.sonnet, "medium"], p);
  }
});

test("istek sınıfı: yalnızca main yönlendirilir", () => {
  const o = new Oturumlar();
  const b = gövde([kullanici("mimari tasarım yap")]);
  for (const sinif of ["subagent", "compaction", "auxiliary", "workflow"]) {
    assert.deepEqual(kararVer(b, { oturumId: "s", sinif }, o, cfg), { atla: true, sebep: `sinif:${sinif}` });
  }
  assert.equal(kararVer(b, ana(), o, cfg).model, MODELLER.opus);
});

test("başlıklar yoksa yedek sezgi: alt ajan kimliği ve araçsız istek atlanır", () => {
  const o = new Oturumlar();
  const m = [kullanici("mimari tasarım yap")];
  assert.equal(kararVer(gövde(m), { oturumId: "s", ajanId: "a1" }, o, cfg).sebep, "alt-ajan");
  assert.equal(kararVer({ model: MODELLER.sonnet, messages: m }, { oturumId: "s" }, o, cfg).sebep, "arac-yok");
  assert.equal(kararVer(gövde(m), { oturumId: "s" }, o, cfg).model, MODELLER.opus);
});

test("ROUTE_FROM dışındaki model atlanır ve sebebi söylenir", () => {
  const k = kararVer(gövde([kullanici("x")], { model: MODELLER.opus }), ana(), new Oturumlar(), cfg);
  assert.deepEqual(k, { atla: true, sebep: `model:${MODELLER.opus}` });
});

test("aynı prompt-id boyunca karar sabit kalır (ajan döngüsü)", () => {
  const o = new Oturumlar();
  const ilk = [kullanici("bu servisin mimari tasarımını yap")];
  const k1 = kararVer(gövde(ilk), ana("s", "p1"), o, cfg);
  const k2 = kararVer(gövde([...ilk, ...aracTuru]), ana("s", "p1"), o, cfg);
  assert.equal(k2.model, k1.model);
  assert.equal(k2.sebep, "ayni-prompt");
});

test("rewind: aynı indekse gelen farklı prompt yeniden skorlanır (prompt-id yokken)", () => {
  const o = new Oturumlar();
  kararVer(gövde([kullanici("bu servisin mimari tasarımını yap")]), ana(), o, cfg);
  const k = kararVer(gövde([kullanici("README'deki yazım hatasını düzelt")]), ana(), o, cfg);
  assert.equal(k.sebep, "skor");
  assert.notEqual(k.model, MODELLER.opus);
});

test("kısa ve sinyalsiz devam önceki kararı sürdürür; kısa ama sinyalli prompt skorlanır", () => {
  const o = new Oturumlar();
  const m1 = [kullanici("bu servisin mimari tasarımını yap")];
  const k1 = kararVer(gövde(m1), ana(), o, cfg);
  const m2 = [...m1, { role: "assistant", content: [{ type: "text", text: "tamam" }] }, kullanici("devam et")];
  const k2 = kararVer(gövde(m2), ana(), o, cfg);
  assert.deepEqual([k2.model, k2.sebep], [k1.model, "kisa-devam"]);
  const m3 = [...m2, { role: "assistant", content: "x" }, kullanici("neden çalışmıyor?")];
  assert.equal(kararVer(gövde(m3), ana(), o, cfg).sebep, "skor");
});

test("küçük bağlamda model düşürülür; büyük bağlamda cache korunur", () => {
  const o = new Oturumlar();
  kararVer(gövde([kullanici("bu servisin mimari tasarımını yap")]), ana(), o, cfg);
  const kucuk = [kullanici("x"), { role: "assistant", content: "y" }, kullanici("bu fonksiyonu yeniden adlandır")];
  assert.equal(kararVer(gövde(kucuk), ana(), o, cfg).model, MODELLER.haiku);

  const o2 = new Oturumlar();
  kararVer(gövde([kullanici("bu servisin mimari tasarımını yap")]), ana("b"), o2, cfg);
  const buyuk = [
    { role: "user", content: [{ type: "text", text: "bağlam " + "a".repeat(200000) }] },
    { role: "assistant", content: "y" },
    kullanici("bu fonksiyonu yeniden adlandır"),
  ];
  const k = kararVer(gövde(buyuk), ana("b"), o2, cfg);
  assert.deepEqual([k.model, k.sebep, k.effort], [MODELLER.opus, "cache-histerezisi", "medium"]);
});

test("oturumun ilk isteği büyük bağlamla gelirse (--resume) haiku'ya inilmez", () => {
  const buyuk = [
    { role: "user", content: [{ type: "text", text: "bağlam " + "a".repeat(200000) }] },
    { role: "assistant", content: "y" },
    kullanici("bu fonksiyonu yeniden adlandır"),
  ];
  const k = kararVer(gövde(buyuk), ana("yeni"), new Oturumlar(), cfg);
  assert.deepEqual([k.model, k.sebep], [MODELLER.sonnet, "cache-histerezisi"]);
});

test("pasifleştirilen prompt'a dokunulmaz; sonraki prompt yeniden skorlanır", () => {
  const o = new Oturumlar();
  const m = [kullanici("bu servisin mimari tasarımını yap")];
  kararVer(gövde(m), ana("s", "p1"), o, cfg);
  pasiflestir(o, "s", "red:400");
  const k = kararVer(gövde([...m, ...aracTuru]), ana("s", "p1"), o, cfg);
  assert.equal(k.pasif, true);
  const b = gövde(m);
  assert.equal(uygula(b, k), false);
  assert.equal(b.model, MODELLER.sonnet);
  assert.equal(kararVer(gövde([kullanici("bu fonksiyonu yeniden adlandır")]), ana("s", "p2"), o, cfg).model, MODELLER.haiku);
});

test("uygula: gövdeyi yeniden yazar, değişmiyorsa false döner", () => {
  const b = { model: MODELLER.sonnet, output_config: { effort: "medium", diger: 1 } };
  assert.equal(uygula(b, { model: MODELLER.opus, effort: "high" }), true);
  assert.deepEqual(b, { model: MODELLER.opus, output_config: { effort: "high", diger: 1 } });
  assert.equal(uygula(b, { model: MODELLER.opus, effort: "high" }), false);
  assert.equal(uygula(b, { atla: true, sebep: "x" }), false);
});

test("effort bantları: medium geniş, high yalnızca model eşiğinin üstünde, low yok", () => {
  assert.equal(effortBul(MODELLER.haiku, 100), "medium");
  assert.deepEqual([30, 31].map((s) => effortBul(MODELLER.sonnet, s)), ["medium", "high"]);
  assert.deepEqual([41, 75, 76].map((s) => effortBul(MODELLER.opus, s)), ["medium", "medium", "high"]);
  const o = new Oturumlar();
  const orta = kararVer(gövde([kullanici("veri çekme kodunda race condition olabilir mi? incele")]), ana("a"), o, cfg); // 27
  assert.deepEqual([orta.model, orta.effort], [MODELLER.sonnet, "medium"]);
  const ortaYuksek = kararVer(gövde([kullanici("veri çekme kodunda race condition olabilir mi? neden olur, incele ve alternatifleri karşılaştır")]), ana("b"), o, cfg); // 37
  assert.deepEqual([ortaYuksek.model, ortaYuksek.effort], [MODELLER.sonnet, "high"]);
  const mimari = kararVer(gövde([kullanici("bu servisin mimari tasarımını yap")]), ana("c"), o, cfg); // 44
  assert.deepEqual([mimari.model, mimari.effort], [MODELLER.opus, "medium"]);
});
