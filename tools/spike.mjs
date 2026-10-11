// Gözlemci: Claude Code <-> api.anthropic.com arasına giren yerel proxy. Mod'un gerçekten giden isteği
// (model, output_config.effort) değiştirdiğini doğrulamak için: ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude ...
// Not: base URL birinci taraf olmadığında Claude Code MCP tool search'ü kapatır, ölçülen bağlam büyür.
// Varsayılan olarak yalnızca iletir ve isteğin YAPISINI loglar (mesaj içeriği/token değeri yazılmaz).
// Gövde yeniden yazımı için: REWRITE_FROM=<model> REWRITE_TO=<model> [REWRITE_EFFORT=<seviye>]
import http from "node:http";
import https from "node:https";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8787);
const UPSTREAM = "api.anthropic.com";
const LOG = join(dirname(fileURLToPath(import.meta.url)), "spike.log");
const { REWRITE_FROM, REWRITE_TO, REWRITE_EFFORT } = process.env;

const SKIP_REQ = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding"]);
const SKIP_RES = new Set(["connection", "transfer-encoding"]);

function log(entry) {
  try {
    appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n");
  } catch (e) {
    console.error(`log yazılamadı: ${e.message}`);
  }
}

// Gövdenin yapısı: mesaj/sistem/araç içeriği yok, sadece anahtarlar ve küçük skaler alanlar.
function ozet(body) {
  const o = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "messages") o.messages = Array.isArray(v) ? v.length : "?";
    else if (k === "tools") o.tools = Array.isArray(v) ? v.length : "?";
    else if (k === "system") o.system_uzunluk = JSON.stringify(v).length;
    else if (JSON.stringify(v).length <= 200) o[k] = v;
    else o[k] = `<${JSON.stringify(v).length} karakter>`;
  }
  return o;
}

// Yeniden yazım: yalnızca REWRITE_FROM ile eşleşen model için (arka plan haiku istekleri bozulmasın).
function yeniden_yaz(body) {
  if (!REWRITE_TO || body.model !== REWRITE_FROM) return false;
  body.model = REWRITE_TO;
  if (REWRITE_EFFORT) body.output_config = { ...(body.output_config ?? {}), effort: REWRITE_EFFORT };
  return true;
}

http
  .createServer((req, res) => {
    const parcalar = [];
    req.on("data", (c) => parcalar.push(c));
    req.on("end", () => {
      let govde = Buffer.concat(parcalar);
      const giris = { yol: req.url, yontem: req.method };
      const basliklar = {};
      for (const [k, v] of Object.entries(req.headers)) if (!SKIP_REQ.has(k)) basliklar[k] = v;

      giris.baslik_adlari = Object.keys(basliklar);
      giris.anthropic_beta = req.headers["anthropic-beta"];
      const auth = req.headers.authorization;
      giris.auth = auth ? `${auth.split(" ")[0]} <${auth.length} karakter>` : req.headers["x-api-key"] ? "x-api-key" : "yok";

      if (req.method === "POST" && String(req.headers["content-type"]).includes("json") && govde.length) {
        try {
          const json = JSON.parse(govde.toString("utf8"));
          giris.govde = ozet(json);
          if (yeniden_yaz(json)) {
            giris.yeniden_yazildi = { model: json.model, output_config: json.output_config };
            govde = Buffer.from(JSON.stringify(json));
          }
        } catch (e) {
          giris.govde_hata = `JSON okunamadı: ${e.message}`;
        }
      }

      const ust = https.request(
        { host: UPSTREAM, path: req.url, method: req.method, headers: { ...basliklar, host: UPSTREAM, "content-length": govde.length } },
        (yanit) => {
          const rh = {};
          for (const [k, v] of Object.entries(yanit.headers)) if (!SKIP_RES.has(k)) rh[k] = v;
          log({ ...giris, durum: yanit.statusCode, istek_id: yanit.headers["request-id"] });
          res.writeHead(yanit.statusCode, rh);
          // Sunucunun gerçekte çalıştırdığı modeli bulmak için yanıtın ilk kısmına bakar (SSE message_start).
          let tampon = "";
          let bulundu = false;
          yanit.on("data", (c) => {
            if (bulundu || tampon.length > 20000) return;
            tampon += c.toString("utf8");
            const m = tampon.match(/"model"\s*:\s*"([^"]+)"/);
            if (m) {
              bulundu = true;
              log({ yol: giris.yol, yanit_modeli: m[1], yanit_kodlama: yanit.headers["content-encoding"] });
            }
          });
          yanit.pipe(res);
        }
      );
      ust.on("error", (e) => {
        log({ ...giris, hata: e.message });
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`proxy upstream hatası: ${e.message}`);
      });
      ust.end(govde);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`spike proxy http://127.0.0.1:${PORT} -> https://${UPSTREAM}`));
