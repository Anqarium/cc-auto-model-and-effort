// Uçtan uca: sahte upstream ile gerçek router. Ağa çıkmaz, gerçek API'ye dokunmaz.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouter, ayarlar } from "../router.mjs";

function dinle(sunucu) {
  return new Promise((coz) => sunucu.listen(0, "127.0.0.1", () => coz(sunucu.address().port)));
}

async function kur(env = {}) {
  const alinan = [];
  const upstream = http.createServer((req, res) => {
    const p = [];
    req.on("data", (c) => p.push(c));
    req.on("end", () => {
      alinan.push({ yol: req.url, baslik: req.headers, govde: Buffer.concat(p).toString() });
      res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_test" });
      res.end('event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5-5"}}\n\n');
    });
  });
  const upPort = await dinle(upstream);
  const logDosyasi = join(mkdtempSync(join(tmpdir(), "router-")), "router.log");
  const cfg = ayarlar({ UPSTREAM_URL: `http://127.0.0.1:${upPort}`, ROUTER_LOG: logDosyasi, ...env });
  const router = createRouter(cfg);
  const port = await dinle(router);
  const kapat = () => Promise.all([upstream, router].map((s) => new Promise((c) => s.close(c))));
  return { alinan, port, logDosyasi, kapat };
}

function gonder(port, govde, basliklar = {}) {
  return new Promise((coz, red) => {
    const veri = Buffer.from(JSON.stringify(govde));
    const r = http.request(
      { host: "127.0.0.1", port, path: "/v1/messages?beta=true", method: "POST", headers: { "content-type": "application/json", "content-length": veri.length, authorization: "Bearer test-token", ...basliklar } },
      (res) => {
        let s = "";
        res.on("data", (c) => (s += c));
        res.on("end", () => coz({ durum: res.statusCode, govde: s }));
      }
    );
    r.on("error", red);
    r.end(veri);
  });
}

const PROMPT_EXPERT =
  "kök neden analizi: dağıtık sistemde race condition ve güvenlik açığı var; src/app.ts içinde hata çıkıyor. adım adım incele, karşılaştır.";

const istek = (metin, ek = {}) => ({
  model: "claude-sonnet-5-5",
  tools: [{ name: "Bash" }],
  output_config: { effort: "medium" },
  messages: [{ role: "user", content: [{ type: "text", text: metin }] }],
  ...ek,
});

test("zor prompt: upstream'e opus + high gider, başlıklar aynen iletilir", async () => {
  const k = await kur();
  try {
    const sonuc = await gonder(k.port, istek(PROMPT_EXPERT), { "x-claude-code-session-id": "sess-1", "anthropic-beta": "oauth-2025-04-20" });
    assert.equal(sonuc.durum, 200);
    const gelen = JSON.parse(k.alinan[0].govde);
    assert.equal(gelen.model, "claude-opus-5-5");
    assert.equal(gelen.output_config.effort, "high");
    assert.equal(k.alinan[0].baslik.authorization, "Bearer test-token");
    assert.equal(k.alinan[0].baslik["anthropic-beta"], "oauth-2025-04-20");
    assert.equal(k.alinan[0].baslik["accept-encoding"], undefined);

    const log = readFileSync(k.logDosyasi, "utf8");
    assert.match(log, /"yanit_modeli":"claude-opus-5-5"/);
    assert.doesNotMatch(log, /test-token/); // token loga sızmaz
    assert.doesNotMatch(log, /kök neden analizi: dağıtık/); // prompt metni loga sızmaz
  } finally {
    await k.kapat();
  }
});

test("kolay prompt: haiku + low", async () => {
  const k = await kur();
  try {
    await gonder(k.port, istek("bu fonksiyonu yeniden adlandır"), { "x-claude-code-session-id": "sess-2" });
    const gelen = JSON.parse(k.alinan[0].govde);
    assert.equal(gelen.model, "claude-haiku-5-5");
    assert.equal(gelen.output_config.effort, "low");
  } finally {
    await k.kapat();
  }
});

test("araçsız arka plan isteği ve başka model: gövde değişmez", async () => {
  const k = await kur();
  try {
    const arkaPlan = istek("mimari tasarım yap", { tools: undefined });
    await gonder(k.port, arkaPlan);
    const altAjan = istek("mimari tasarım yap", { model: "claude-haiku-5-5" });
    await gonder(k.port, altAjan);
    assert.equal(JSON.parse(k.alinan[0].govde).model, "claude-sonnet-5-5");
    assert.equal(JSON.parse(k.alinan[1].govde).model, "claude-haiku-5-5");
  } finally {
    await k.kapat();
  }
});

test("MODE=log: karar loglanır ama gövde değişmez", async () => {
  const k = await kur({ MODE: "log" });
  try {
    await gonder(k.port, istek("bu servisin mimari tasarımını yap"), { "x-claude-code-session-id": "sess-3" });
    assert.equal(JSON.parse(k.alinan[0].govde).model, "claude-sonnet-5-5");
    assert.match(readFileSync(k.logDosyasi, "utf8"), /"seviye":"complex"/);
  } finally {
    await k.kapat();
  }
});

test("bozuk JSON gövdesi isteği düşürmez, olduğu gibi iletilir", async () => {
  const k = await kur();
  try {
    await new Promise((coz, red) => {
      const r = http.request({ host: "127.0.0.1", port: k.port, path: "/v1/messages", method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        res.resume();
        res.on("end", coz);
      });
      r.on("error", red);
      r.end("{bozuk");
    });
    assert.equal(k.alinan[0].govde, "{bozuk");
  } finally {
    await k.kapat();
  }
});
