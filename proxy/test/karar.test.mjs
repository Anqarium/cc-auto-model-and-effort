import test from "node:test";
import assert from "node:assert/strict";
import { MODELLER, Oturumlar, gercekPrompt, kararVer, uygula } from "../karar.mjs";

const cfg = { yonlendirilecek: [MODELLER.sonnet], dusurmeTokenSiniri: 30000 };
const arac = [{ name: "Bash" }];
const kullanici = (metin) => ({ role: "user", content: [{ type: "text", text: metin }] });
const gövde = (messages, ek = {}) => ({ model: MODELLER.sonnet, tools: arac, messages, ...ek });

test("gercekPrompt: araç sonucu ve system-reminder bloklarını atlar", () => {
  const messages = [
    kullanici("mimari tasarım yap"),
    { role: "assistant", content: [{ type: "tool_use", id: "1", name: "Bash", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }] },
    { role: "user", content: [{ type: "text", text: "<system-reminder>not</system-reminder>" }] },
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

test("zor prompt opus'a yönlenir, kolay prompt haiku'ya", () => {
  const o = new Oturumlar();
  const zor = kararVer(gövde([kullanici("bu servisin mimari tasarımını yap")]), "s1", o, cfg);
  assert.equal(zor.model, MODELLER.opus);
  const kolay = kararVer(gövde([kullanici("bu fonksiyonu yeniden adlandır")]), "s2", o, cfg);
  assert.equal(kolay.model, MODELLER.haiku);
  assert.equal(kolay.effort, "low");
});

test("ajan döngüsünde aynı prompt için karar sabit kalır", () => {
  const o = new Oturumlar();
  const ilk = [kullanici("bu servisin mimari tasarımını yap")];
  const k1 = kararVer(gövde(ilk), "s", o, cfg);
  const donguMesajlari = [
    ...ilk,
    { role: "assistant", content: [{ type: "tool_use", id: "1", name: "Bash", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "çıktı" }] },
  ];
  const k2 = kararVer(gövde(donguMesajlari), "s", o, cfg);
  assert.equal(k2.model, k1.model);
  assert.equal(k2.sebep, "ayni-prompt");
});

test("kısa devam prompt'u önceki kararı sürdürür", () => {
  const o = new Oturumlar();
  const m1 = [kullanici("bu servisin mimari tasarımını yap")];
  const k1 = kararVer(gövde(m1), "s", o, cfg);
  const m2 = [...m1, { role: "assistant", content: [{ type: "text", text: "tamam" }] }, kullanici("devam et")];
  const k2 = kararVer(gövde(m2), "s", o, cfg);
  assert.equal(k2.model, k1.model);
  assert.equal(k2.sebep, "kisa-devam");
});

test("küçük bağlamda model düşürülür; büyük bağlamda cache korunur", () => {
  const o = new Oturumlar();
  kararVer(gövde([kullanici("bu servisin mimari tasarımını yap")]), "s", o, cfg);
  const kucuk = [kullanici("x"), { role: "assistant", content: "y" }, kullanici("bu fonksiyonu yeniden adlandır")];
  assert.equal(kararVer(gövde(kucuk), "s", o, cfg).model, MODELLER.haiku);

  const o2 = new Oturumlar();
  kararVer(gövde([kullanici("bu servisin mimari tasarımını yap")]), "b", o2, cfg);
  const buyuk = [
    { role: "user", content: [{ type: "text", text: "bağlam " + "a".repeat(200000) }] },
    { role: "assistant", content: "y" },
    kullanici("bu fonksiyonu yeniden adlandır"),
  ];
  const k = kararVer(gövde(buyuk), "b", o2, cfg);
  assert.equal(k.model, MODELLER.opus);
  assert.equal(k.sebep, "cache-histerezisi");
  assert.equal(k.effort, "low"); // model sabit kalsa da effort yine düşer
});

test("oturumun ilk isteği büyük bağlamla gelirse (--resume) haiku'ya inilmez", () => {
  const o = new Oturumlar();
  const buyuk = [
    { role: "user", content: [{ type: "text", text: "bağlam " + "a".repeat(200000) }] },
    { role: "assistant", content: "y" },
    kullanici("bu fonksiyonu yeniden adlandır"),
  ];
  const k = kararVer(gövde(buyuk), "yeni", o, cfg);
  assert.equal(k.model, MODELLER.sonnet);
  assert.equal(k.sebep, "cache-histerezisi");
});

test("araçsız (arka plan) ve yönlendirilmeyen modeller atlanır", () => {
  const o = new Oturumlar();
  const m = [kullanici("mimari tasarım yap")];
  assert.equal(kararVer({ model: MODELLER.sonnet, messages: m }, "s", o, cfg), null);
  assert.equal(kararVer({ model: MODELLER.haiku, tools: arac, messages: m }, "s", o, cfg), null);
});

test("uygula: gövdeyi yeniden yazar, değişmiyorsa false döner", () => {
  const b = { model: MODELLER.sonnet, output_config: { effort: "medium", diger: 1 } };
  assert.equal(uygula(b, { model: MODELLER.opus, effort: "high" }), true);
  assert.deepEqual(b, { model: MODELLER.opus, output_config: { effort: "high", diger: 1 } });
  assert.equal(uygula(b, { model: MODELLER.opus, effort: "high" }), false);
});
