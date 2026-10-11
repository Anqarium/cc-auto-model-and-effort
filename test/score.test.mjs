// Prompts in these tests are often Turkish on purpose: the scorer detects Turkish and English.
import test from "node:test";
import assert from "node:assert/strict";
import { scorePrompt, levelFor } from "../lib/score.mjs";

test("mechanical request: trivial + easy marker", () => {
  const s = scorePrompt("bu fonksiyonu yeniden adlandır"); // "rename this function"
  assert.equal(s.level, "trivial");
  assert.ok(s.signals.includes("easy-marker"));
});

test("a one-sentence architecture request does not stay trivial/simple", () => {
  const s = scorePrompt("bu servisin mimari tasarımını yap"); // "design this service's architecture"
  assert.ok(s.score > 40, `score ${s.score}`);
  assert.equal(s.level, "complex");
});

test("words starting with Turkish letters match (çöküyor, şifrele)", () => {
  assert.ok(scorePrompt("uygulama başlatınca çöküyor").categories.code > 0);
  assert.ok(scorePrompt("token'ları şifrele ve oauth akışını güncelle").categories.domain > 0);
});

test("Turkish suffixes are tolerated (mimarisi, güvenliği)", () => {
  assert.ok(scorePrompt("sistemin mimarisi nasıl olmalı").categories.heavy > 0);
  assert.ok(scorePrompt("güvenlik açığı var mı").categories.heavy > 0);
});

test("consonant softening: açık/açığı/açıkları and eşzamanlılık/eşzamanlılığı count as heavy", () => {
  for (const p of ["güvenlik açık", "güvenlik açığı var", "güvenlik açıklarını değerlendir", "eşzamanlılık sorunu", "eşzamanlılığı test et"]) {
    assert.ok(scorePrompt(p).categories.heavy > 0, p);
  }
});

test("easy-marker false positives: bulut, okul, gösterge do not match", () => {
  for (const p of ["bulut altyapısına geçelim", "okul projesi için api", "gösterge paneli ekle"]) {
    assert.ok(!scorePrompt(p).signals.includes("easy-marker"), p);
  }
  assert.ok(scorePrompt("şu dosyayı bul").signals.includes("easy-marker"));
});

test("the conjunction 'bu nedenle' is not reasoning, 'neden' (why) is", () => {
  assert.equal(scorePrompt("bu nedenle metni çevir").categories.reasoning, 0);
  assert.ok(scorePrompt("bu neden böyle oluyor").categories.reasoning > 0);
});

test("the easy marker does not cancel a heavy signal ('bul ve düzelt: kök nedeni')", () => {
  const s = scorePrompt("bul ve düzelt: kök nedeni");
  assert.ok(!s.signals.includes("easy-marker"));
  assert.ok(s.categories.heavy > 0);
});

test("code blocks, file paths and errors add code points", () => {
  const s = scorePrompt("src/app.ts içinde hata var:\n```ts\nconst x = await f();\n```");
  assert.ok(s.categories.code >= 10, `code ${s.categories.code}`);
});

test("a long, many-sided prompt reaches expert", () => {
  const long =
    "Kök neden analizi yap: dağıtık sistemde race condition ve güvenlik açığı var.\n" +
    "1. incele\n2. karşılaştır\n3. refactor planla\n" +
    "```js\nasync function f() { return await g(); }\n```\n" +
    "x".repeat(1200);
  assert.equal(scorePrompt(long).level, "expert");
});

test("a long paste does not block the event loop (ReDoS) and length is still measured", () => {
  const start = performance.now();
  const s = scorePrompt("a.".repeat(100000));
  const ms = performance.now() - start;
  assert.ok(ms < 300, `${Math.round(ms)} ms`);
  assert.equal(s.categories.length, 15);
});

test("the same input gives the same result every time (no g-flag regex state leaks)", () => {
  const p = "kök neden analizi: race condition ve güvenlik açığı";
  const results = Array.from({ length: 5 }, () => scorePrompt(p).score);
  assert.equal(new Set(results).size, 1);
});

test("empty and invalid input does not crash", () => {
  assert.equal(scorePrompt("").score, 0);
  assert.equal(scorePrompt(undefined).score, 0);
});

test("level boundaries", () => {
  assert.equal(levelFor(5), "trivial");
  assert.equal(levelFor(6), "simple");
  assert.equal(levelFor(20), "simple");
  assert.equal(levelFor(21), "moderate");
  assert.equal(levelFor(40), "moderate");
  assert.equal(levelFor(41), "complex");
  assert.equal(levelFor(65), "complex");
  assert.equal(levelFor(66), "expert");
});
