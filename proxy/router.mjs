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
import { MODELLER, Oturumlar, kararVer, pasiflestir, uygula } from "./karar.mjs";

// Hop-by-hop başlıklar (RFC 9110 7.6.1) iletilmez. accept-encoding de iletilmez ki yanıttaki model okunabilsin.
const HOP = ["connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"];
const SKIP_REQ = new Set([...HOP, "host", "content-length", "accept-encoding"]);
const SKIP_RES = new Set(HOP);
// Yeniden yazılmış gövde bu kodlarla reddedilirse orijinal gövdeyle bir kez daha denenir.
const GERI_DONUS_KODLARI = new Set([400, 404]);
export const SAGLIK_YOLU = "/__router";

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

// SSE message_start'tan gerçek modeli ve cache kullanımını çıkarır (kalibrasyon için).
// `son` false iken son (yarım olabilecek) satır atlanır; akış bitince düz regex yedeğine düşülür.
export function yanitOzeti(metin, son) {
  const satirlar = metin.split("\n");
  if (!son) satirlar.pop();
  for (const s of satirlar) {
    if (!s.startsWith("data:") || !s.includes('"message_start"')) continue;
    try {
      const m = JSON.parse(s.slice(5)).message ?? {};
      const u = m.usage;
      return {
        yanit_modeli: m.model,
        usage: u && { girdi: u.input_tokens, cache_yazma: u.cache_creation_input_tokens, cache_okuma: u.cache_read_input_tokens },
      };
    } catch {
      return null;
    }
  }
  const model = son ? metin.match(/"model"\s*:\s*"([^"]+)"/)?.[1] : undefined;
  return model ? { yanit_modeli: model } : null;
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
    if (req.url === SAGLIK_YOLU) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ router: "cc-auto-model-and-effort", pid: process.pid, mod: cfg.mod }));
      return;
    }

    const parcalar = [];
    req.on("data", (c) => parcalar.push(c));
    req.on("end", () => {
      const orijinal = Buffer.concat(parcalar);
      let govde = orijinal;
      const basliklar = {};
      for (const [k, v] of Object.entries(req.headers)) if (!SKIP_REQ.has(k)) basliklar[k] = v;

      const kayit = { yol: req.url, yontem: req.method };
      const ipucu = {
        oturumId: String(req.headers["x-claude-code-session-id"] ?? "oturumsuz"),
        sinif: req.headers["x-claude-code-request-class"],
        promptId: req.headers["x-claude-code-prompt-id"],
        ajanId: req.headers["x-claude-code-agent-id"],
      };
      let yenidenYazildi = false;

      const yol = new URL(req.url, "http://yerel").pathname;
      if (req.method === "POST" && yol === "/v1/messages" && orijinal.length) {
        try {
          const json = JSON.parse(orijinal.toString("utf8"));
          Object.assign(kayit, { istek_modeli: json.model, sinif: ipucu.sinif, tahmini_token: Math.round(orijinal.length / 4) });
          const karar = kararVer(json, ipucu, oturumlar, cfg);
          if (karar.atla) {
            // Ana konuşmanın atlanması (ör. /model opus ile ROUTE_FROM dışı) sessiz kalmasın.
            if (ipucu.sinif === "main" || !ipucu.sinif) kayit.atlandi = karar.sebep;
          } else {
            kayit.karar = karar;
            if (cfg.mod === "route" && uygula(json, karar)) {
              kayit.yeniden_yazildi = { model: json.model, effort: json.output_config.effort };
              govde = Buffer.from(JSON.stringify(json));
              yenidenYazildi = true;
            }
          }
        } catch (e) {
          // Yönlendirme hatası isteği düşürmemeli: gövdeye dokunmadan ilet, hatayı logla.
          kayit.hata = `yönlendirme atlandı: ${e.message}`;
        }
      }

      let aktif;
      const ilet = (veri, geriDonulebilir) => {
        const ust = istemci.request(
          {
            hostname: cfg.upstream.hostname,
            port: cfg.upstream.port || undefined,
            path: req.url,
            method: req.method,
            headers: { ...basliklar, host: cfg.upstream.host, "content-length": veri.length },
          },
          (yanit) => {
            if (geriDonulebilir && GERI_DONUS_KODLARI.has(yanit.statusCode)) {
              // Yeniden yazım reddedildi: hata gövdesini (içerik değil, API hata mesajı) logla, orijinali gönder.
              let hata = "";
              yanit.on("data", (c) => (hata.length < 600 ? (hata += c) : null));
              yanit.on("end", () => {
                log({ ...kayit, durum: yanit.statusCode, geri_donus: true, api_hatasi: hata.slice(0, 600) });
                pasiflestir(oturumlar, ipucu.oturumId, `red:${yanit.statusCode}`);
                if (!res.destroyed) aktif = ilet(orijinal, false);
              });
              return;
            }

            const rh = {};
            for (const [k, v] of Object.entries(yanit.headers)) if (!SKIP_RES.has(k)) rh[k] = v;
            log({ ...kayit, durum: yanit.statusCode, istek_id: yanit.headers["request-id"], ...(geriDonulebilir || !yenidenYazildi ? {} : { orijinal_gonderildi: true }) });
            res.writeHead(yanit.statusCode, rh);

            let tampon = "";
            let bulundu = false;
            const dene = (son) => {
              if (bulundu) return;
              const ozet = yanitOzeti(tampon, son);
              if (ozet) {
                bulundu = true;
                log({ yol: kayit.yol, oturum: ipucu.oturumId.slice(0, 8), ...ozet });
              }
            };
            yanit.on("data", (c) => {
              if (bulundu || tampon.length > 50000) return;
              tampon += c.toString("utf8");
              dene(false);
            });
            yanit.on("end", () => dene(true));
            // Upstream akış ortasında koparsa istemciyi de kapat; yoksa istemci asılı kalır.
            yanit.on("close", () => {
              if (!yanit.complete) res.destroy();
            });
            yanit.pipe(res);
          }
        );
        ust.on("error", (e) => {
          log({ ...kayit, hata: e.message });
          if (res.headersSent) res.destroy();
          else if (!res.destroyed) {
            res.writeHead(502, { "content-type": "text/plain" });
            res.end(`router upstream hatası: ${e.message}`);
          }
        });
        ust.end(veri);
        return ust;
      };

      aktif = ilet(govde, yenidenYazildi && cfg.mod === "route");
      // İstemci iptal ederse (Esc) upstream isteğini de kes; yoksa üretim kota harcayarak sürer.
      res.on("close", () => {
        if (!res.writableFinished) aktif.destroy();
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = ayarlar();
  createRouter(cfg).listen(cfg.port, "127.0.0.1", () =>
    console.log(`router http://127.0.0.1:${cfg.port} -> ${cfg.upstream.origin} (mod=${cfg.mod}, yönlendirilecek=${cfg.yonlendirilecek})`)
  );
}
