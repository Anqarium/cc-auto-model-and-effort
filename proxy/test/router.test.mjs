// Uçtan uca: sahte upstream ile gerçek router. Ağa çıkmaz, gerçek API'ye dokunmaz.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRouter, ayarlar, yanitOzeti, SAGLIK_YOLU } from "../router.mjs";

const MESSAGE_START =
  'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":5,"cache_creation_input_tokens":100,"cache_read_input_tokens":7,"cache_creation":{"ephemeral_5m_input_tokens":100}}}}\n\n';

function dinle(sunucu) {
  return new Promise((coz) => sunucu.listen(0, "127.0.0.1", () => coz(sunucu.address().port)));
}

// Varsayılan sahte upstream: gövdeyi kaydeder, SSE message_start ile yanıtlar.
const varsayilanUpstream = (alinan) => (req, res, govde) => {
  alinan.push({ yol: req.url, baslik: req.headers, govde });
  res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_test" });
  res.end(MESSAGE_START);
};

async function kur({ env = {}, isleyici } = {}) {
  const alinan = [];
  const isle = isleyici ?? varsayilanUpstream(alinan);
  const upstream = http.createServer((req, res) => {
    const p = [];
    req.on("data", (c) => p.push(c));
    req.on("end", () => isle(req, res, Buffer.concat(p).toString(), alinan));
  });
  const upPort = await dinle(upstream);
  const gecici = mkdtempSync(join(tmpdir(), "router-"));
  const logDosyasi = join(gecici, "router.log");
  const durum = join(gecici, "durum");
  const cfg = ayarlar({ UPSTREAM_URL: `http://127.0.0.1:${upPort}`, ROUTER_LOG: logDosyasi, CLAUDE_AUTO_DURUM: durum, ...env });
  const router = createRouter(cfg);
  const port = await dinle(router);
  const kapat = () => {
    upstream.closeAllConnections();
    router.closeAllConnections();
    return Promise.all([upstream, router].map((s) => new Promise((c) => s.close(c))));
  };
  const durumu = (id) => JSON.parse(readFileSync(join(durum, `${id}.json`), "utf8"));
  return { alinan, port, logDosyasi, kapat, durumu, log: () => readFileSync(logDosyasi, "utf8") };
}

function gonder(port, govde, basliklar = {}, yol = "/v1/messages?beta=true") {
  return new Promise((coz, red) => {
    const veri = Buffer.from(typeof govde === "string" ? govde : JSON.stringify(govde));
    const r = http.request(
      { host: "127.0.0.1", port, path: yol, method: "POST", headers: { "content-type": "application/json", "content-length": veri.length, authorization: "Bearer test-token", ...basliklar } },
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

const bekle = (ms) => new Promise((c) => setTimeout(c, ms));
const PROMPT_EXPERT =
  "kök neden analizi: dağıtık sistemde race condition ve güvenlik açığı var; src/app.ts içinde hata çıkıyor. " +
  "adım adım incele, karşılaştır, performans etkisini değerlendir.\n" +
  "1. akışı çıkar\n2. alternatifleri tart\n3. refactor planla\n```ts\nconst x = await f();\n```"; // skor 93 → opus/high
const ANA = { "x-claude-code-session-id": "sess-1", "x-claude-code-request-class": "main", "x-claude-code-prompt-id": "p-1" };

const istek = (metin, ek = {}) => ({
  model: "claude-sonnet-5-5",
  tools: [{ name: "Bash" }],
  output_config: { effort: "medium" },
  messages: [{ role: "user", content: [{ type: "text", text: metin }] }],
  ...ek,
});

test("zor prompt: upstream'e opus + high gider, başlıklar aynen, usage loglanır, gizli veri sızmaz", async () => {
  const k = await kur();
  try {
    const sonuc = await gonder(k.port, istek(PROMPT_EXPERT), { ...ANA, "anthropic-beta": "oauth-2025-04-20", "keep-alive": "timeout=5" });
    assert.equal(sonuc.durum, 200);
    const gelen = JSON.parse(k.alinan[0].govde);
    assert.deepEqual([gelen.model, gelen.output_config.effort], ["claude-opus-5-5", "high"]);
    assert.equal(k.alinan[0].baslik.authorization, "Bearer test-token");
    assert.equal(k.alinan[0].baslik["anthropic-beta"], "oauth-2025-04-20");
    assert.equal(k.alinan[0].baslik["accept-encoding"], undefined);
    assert.equal(k.alinan[0].baslik["keep-alive"], undefined);

    const log = k.log();
    assert.match(log, /"yanit_modeli":"claude-opus-5-5"/);
    assert.match(log, /"cache_yazma":100/);
    assert.doesNotMatch(log, /test-token/);
    assert.doesNotMatch(log, /kök neden analizi: dağıtık/);
    assert.doesNotMatch(log, /alternatifleri tart/);
  } finally {
    await k.kapat();
  }
});

test("kolay prompt: haiku + medium", async () => {
  const k = await kur();
  try {
    await gonder(k.port, istek("bu fonksiyonu yeniden adlandır"), ANA);
    const gelen = JSON.parse(k.alinan[0].govde);
    assert.deepEqual([gelen.model, gelen.output_config.effort], ["claude-haiku-5-5", "medium"]);
  } finally {
    await k.kapat();
  }
});

test("alt ajan / compaction sınıfı ve count_tokens yoluna dokunulmaz", async () => {
  const k = await kur();
  try {
    await gonder(k.port, istek(PROMPT_EXPERT), { ...ANA, "x-claude-code-request-class": "subagent" });
    await gonder(k.port, istek(PROMPT_EXPERT), { ...ANA, "x-claude-code-request-class": "compaction" });
    await gonder(k.port, istek(PROMPT_EXPERT), ANA, "/v1/messages/count_tokens?beta=true");
    for (const a of k.alinan) assert.equal(JSON.parse(a.govde).model, "claude-sonnet-5-5", a.yol);
  } finally {
    await k.kapat();
  }
});

test("ROUTE_FROM dışındaki ana istek atlanır ve logda görünür", async () => {
  const k = await kur();
  try {
    await gonder(k.port, istek(PROMPT_EXPERT, { model: "claude-opus-5-5" }), ANA);
    assert.match(k.log(), /"atlandi":"model:claude-opus-5-5"/);
  } finally {
    await k.kapat();
  }
});

test("MODE=log: karar loglanır ama gövde değişmez", async () => {
  const k = await kur({ env: { MODE: "log" } });
  try {
    await gonder(k.port, istek("bu servisin mimari tasarımını yap"), ANA);
    assert.equal(JSON.parse(k.alinan[0].govde).model, "claude-sonnet-5-5");
    assert.match(k.log(), /"seviye":"complex"/);
  } finally {
    await k.kapat();
  }
});

test("bozuk JSON gövdesi isteği düşürmez, olduğu gibi iletilir", async () => {
  const k = await kur();
  try {
    await gonder(k.port, "{bozuk", {}, "/v1/messages");
    assert.equal(k.alinan[0].govde, "{bozuk");
  } finally {
    await k.kapat();
  }
});

test("yeniden yazılan istek 400 alırsa orijinalle tekrar denenir ve o prompt pasifleşir", async () => {
  const alinan = [];
  const k = await kur({
    isleyici: (req, res, govde) => {
      alinan.push(JSON.parse(govde).model);
      if (JSON.parse(govde).model !== "claude-sonnet-5-5") {
        res.writeHead(400, { "content-type": "application/json" });
        res.end('{"type":"error","error":{"type":"invalid_request_error","message":"thinking signature invalid"}}');
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(MESSAGE_START);
    },
  });
  try {
    const sonuc = await gonder(k.port, istek(PROMPT_EXPERT), ANA);
    assert.equal(sonuc.durum, 200);
    assert.deepEqual(alinan, ["claude-opus-5-5", "claude-sonnet-5-5"]);
    assert.match(k.log(), /"geri_donus":true/);
    assert.match(k.log(), /thinking signature invalid/);

    await gonder(k.port, istek(PROMPT_EXPERT), ANA); // aynı prompt-id: artık dokunulmaz
    assert.deepEqual(alinan.slice(2), ["claude-sonnet-5-5"]);
  } finally {
    await k.kapat();
  }
});

test("istemci iptal ederse (Esc) upstream isteği de kesilir", async () => {
  let upstreamKapandi = false;
  const k = await kur({
    isleyici: (req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(MESSAGE_START);
      const zamanlayici = setInterval(() => res.write("data: {}\n\n"), 20);
      res.on("close", () => {
        clearInterval(zamanlayici);
        upstreamKapandi = true;
      });
    },
  });
  try {
    await new Promise((coz) => {
      const veri = JSON.stringify(istek("merhaba"));
      const r = http.request({ host: "127.0.0.1", port: k.port, path: "/v1/messages", method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        res.once("data", () => {
          r.destroy();
          coz();
        });
      });
      r.on("error", () => {});
      r.end(veri);
    });
    for (let i = 0; i < 25 && !upstreamKapandi; i++) await bekle(20);
    assert.ok(upstreamKapandi, "upstream bağlantısı açık kaldı");
  } finally {
    await k.kapat();
  }
});

test("upstream akış ortasında koparsa istemci asılı kalmaz", async () => {
  const k = await kur({
    isleyici: (req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(MESSAGE_START);
      setTimeout(() => res.socket.destroy(), 30);
    },
  });
  try {
    const sonuc = await new Promise((coz) => {
      const r = http.request({ host: "127.0.0.1", port: k.port, path: "/v1/messages", method: "POST", headers: { "content-type": "application/json" } }, (res) => {
        res.on("data", () => {});
        res.on("close", () => coz("kapandi"));
      });
      r.on("error", () => coz("kapandi"));
      r.end(JSON.stringify(istek("merhaba")));
      setTimeout(() => coz("asili"), 1000);
    });
    assert.equal(sonuc, "kapandi");
  } finally {
    await k.kapat();
  }
});

test("statusline durumu: ana konuşmanın kararı ve gerçek modeli yazılır, alt ajan yanıtı ezmez", async () => {
  const k = await kur();
  try {
    await gonder(k.port, istek(PROMPT_EXPERT), ANA);
    assert.deepEqual(
      [k.durumu("sess-1").karar.model, k.durumu("sess-1").karar.seviye, k.durumu("sess-1").yanit_modeli],
      ["claude-opus-5-5", "expert", "claude-opus-5-5"]
    );
    // Sahte upstream hep opus döner; alt ajan yanıtı ana durumu değiştirmemeli.
    const once = k.durumu("sess-1").t;
    await gonder(k.port, istek("x"), { ...ANA, "x-claude-code-request-class": "subagent" });
    assert.equal(k.durumu("sess-1").t, once);

    await gonder(k.port, istek(PROMPT_EXPERT, { model: "claude-opus-5-5" }), { ...ANA, "x-claude-code-prompt-id": "p-2" });
    assert.equal(k.durumu("sess-1").atlandi, "model:claude-opus-5-5");
    assert.equal(k.durumu("sess-1").karar, undefined);
  } finally {
    await k.kapat();
  }
});

test("geçersiz oturum kimliği dosya adına girmez", async () => {
  const k = await kur();
  try {
    await gonder(k.port, istek(PROMPT_EXPERT), { ...ANA, "x-claude-code-session-id": "../kotu" });
    assert.throws(() => k.durumu("../kotu"));
  } finally {
    await k.kapat();
  }
});

test("üst süreç (claude-auto penceresi) ölünce router kendini kapatır", async () => {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const routerYolu = fileURLToPath(new URL("../router.mjs", import.meta.url));
  const ebeveyn = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
  const router = spawn(process.execPath, [routerYolu], {
    env: { ...process.env, PORT: "0", CLAUDE_AUTO_EBEVEYN: String(ebeveyn.pid), CLAUDE_AUTO_DURUM: mkdtempSync(join(tmpdir(), "durum-")), ROUTER_LOG: join(tmpdir(), "router-ebeveyn-test.log") },
    stdio: "ignore",
  });
  const kapandi = new Promise((coz) => router.on("exit", () => coz(true)));
  try {
    await bekle(300);
    ebeveyn.kill();
    const sonuc = await Promise.race([kapandi, bekle(6000).then(() => false)]);
    assert.ok(sonuc, "router yetim kaldı");
  } finally {
    ebeveyn.kill();
    router.kill();
  }
});

test("sağlık yolu router'ı tanıtır", async () => {
  const k = await kur();
  try {
    const sonuc = await new Promise((coz, red) => {
      http.get({ host: "127.0.0.1", port: k.port, path: SAGLIK_YOLU }, (res) => {
        let s = "";
        res.on("data", (c) => (s += c));
        res.on("end", () => coz(JSON.parse(s)));
      }).on("error", red);
    });
    assert.equal(sonuc.router, "cc-auto-model-and-effort");
  } finally {
    await k.kapat();
  }
});

test("yanitOzeti: yarım satırı beklemez, iç içe usage'ı okur, akış sonunda regex yedeği", () => {
  assert.equal(yanitOzeti(MESSAGE_START.slice(0, 60), false), null);
  assert.deepEqual(yanitOzeti(MESSAGE_START, false), {
    yanit_modeli: "claude-opus-5-5",
    usage: { girdi: 5, cache_yazma: 100, cache_okuma: 7 },
  });
  assert.deepEqual(yanitOzeti('{"model":"claude-haiku-5-5"}', true), { yanit_modeli: "claude-haiku-5-5" });
});
