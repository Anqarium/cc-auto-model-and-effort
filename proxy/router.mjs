// Claude Code <-> Anthropic API arasındaki yerel yönlendirici: her kullanıcı prompt'unu skorlar,
// isteğin `model` ve `output_config.effort` alanlarını buna göre yeniden yazar.
// Mesaj içeriği ve token değeri loglanmaz; yalnızca karar ve yapı bilgisi yazılır.
//
// Ortam değişkenleri: PORT (8787), UPSTREAM_URL (https://api.anthropic.com), ROUTE_FROM (virgüllü model
// listesi, varsayılan claude-sonnet-5-5), MODE (route | log: log'ta gövdeye dokunulmaz),
// DOWNGRADE_MAX_TOKENS (30000), ROUTER_LOG (proxy/router.log)
import http from "node:http";
import https from "node:https";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELLER, Oturumlar, kararVer, uygula } from "./karar.mjs";

const SKIP_REQ = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding"]);
const SKIP_RES = new Set(["connection", "transfer-encoding"]);

export function ayarlar(env = process.env) {
  return {
    port: Number(env.PORT ?? 8787),
    upstream: new URL(env.UPSTREAM_URL ?? "https://api.anthropic.com"),
    yonlendirilecek: (env.ROUTE_FROM ?? MODELLER.sonnet).split(",").map((s) => s.trim()),
    mod: env.MODE ?? "route",
    dusurmeTokenSiniri: Number(env.DOWNGRADE_MAX_TOKENS ?? 30000),
    logDosyasi: env.ROUTER_LOG ?? join(dirname(fileURLToPath(import.meta.url)), "router.log"),
  };
}

export function createRouter(cfg) {
  const oturumlar = new Oturumlar();
  const istemci = cfg.upstream.protocol === "https:" ? https : http;

  function log(girdi) {
    try {
      appendFileSync(cfg.logDosyasi, JSON.stringify({ t: new Date().toISOString(), ...girdi }) + "\n");
    } catch (e) {
      console.error(`log yazılamadı: ${e.message}`);
    }
  }

  return http.createServer((req, res) => {
    const parcalar = [];
    req.on("data", (c) => parcalar.push(c));
    req.on("end", () => {
      let govde = Buffer.concat(parcalar);
      const basliklar = {};
      for (const [k, v] of Object.entries(req.headers)) if (!SKIP_REQ.has(k)) basliklar[k] = v;

      const kayit = { yol: req.url, yontem: req.method };
      const oturumId = String(req.headers["x-claude-code-session-id"] ?? "oturumsuz");

      if (req.method === "POST" && req.url.startsWith("/v1/messages") && govde.length) {
        try {
          const json = JSON.parse(govde.toString("utf8"));
          kayit.istek_modeli = json.model;
          const karar = kararVer(json, oturumId, oturumlar, cfg);
          if (karar) {
            kayit.karar = karar;
            if (cfg.mod === "route" && uygula(json, karar)) {
              kayit.yeniden_yazildi = { model: json.model, effort: json.output_config.effort };
              govde = Buffer.from(JSON.stringify(json));
            }
          }
        } catch (e) {
          // Yönlendirme hatası isteği düşürmemeli: gövdeye dokunmadan ilet, hatayı logla.
          kayit.hata = `yönlendirme atlandı: ${e.message}`;
        }
      }

      const ust = istemci.request(
        {
          hostname: cfg.upstream.hostname,
          port: cfg.upstream.port || undefined,
          path: req.url,
          method: req.method,
          headers: { ...basliklar, host: cfg.upstream.host, "content-length": govde.length },
        },
        (yanit) => {
          const rh = {};
          for (const [k, v] of Object.entries(yanit.headers)) if (!SKIP_RES.has(k)) rh[k] = v;
          log({ ...kayit, durum: yanit.statusCode, istek_id: yanit.headers["request-id"] });
          res.writeHead(yanit.statusCode, rh);

          // Sunucunun gerçekte çalıştırdığı model: SSE message_start içindeki ilk "model" alanı.
          let tampon = "";
          let bulundu = false;
          yanit.on("data", (c) => {
            if (bulundu || tampon.length > 20000) return;
            tampon += c.toString("utf8");
            const m = tampon.match(/"model"\s*:\s*"([^"]+)"/);
            if (m) {
              bulundu = true;
              log({ yol: kayit.yol, oturum: oturumId.slice(0, 8), yanit_modeli: m[1] });
            }
          });
          yanit.pipe(res);
        }
      );
      ust.on("error", (e) => {
        log({ ...kayit, hata: e.message });
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`router upstream hatası: ${e.message}`);
      });
      ust.end(govde);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = ayarlar();
  createRouter(cfg).listen(cfg.port, "127.0.0.1", () =>
    console.log(`router http://127.0.0.1:${cfg.port} -> ${cfg.upstream.origin} (mod=${cfg.mod}, yönlendirilecek=${cfg.yonlendirilecek})`)
  );
}
