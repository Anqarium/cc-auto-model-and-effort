// Observer: a local proxy between Claude Code and api.anthropic.com, to check that the mod really changes
// the outgoing request (model, output_config.effort): ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude ...
// Note: with a non-first-party base URL Claude Code turns off MCP tool search, so the measured context grows.
// By default it only forwards and logs the request's STRUCTURE (no message content, no token values).
// To rewrite the body: REWRITE_FROM=<model> REWRITE_TO=<model> [REWRITE_EFFORT=<level>]
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
    console.error(`could not write log: ${e.message}`);
  }
}

// The body's structure: no message/system/tool content, only keys and small scalar fields.
function summarize(body) {
  const o = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "messages") o.messages = Array.isArray(v) ? v.length : "?";
    else if (k === "tools") o.tools = Array.isArray(v) ? v.length : "?";
    else if (k === "system") o.system_length = JSON.stringify(v).length;
    else if (JSON.stringify(v).length <= 200) o[k] = v;
    else o[k] = `<${JSON.stringify(v).length} chars>`;
  }
  return o;
}

// Rewrite only the model matching REWRITE_FROM (so background haiku requests are left alone).
function rewrite(body) {
  if (!REWRITE_TO || body.model !== REWRITE_FROM) return false;
  body.model = REWRITE_TO;
  if (REWRITE_EFFORT) body.output_config = { ...(body.output_config ?? {}), effort: REWRITE_EFFORT };
  return true;
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = Buffer.concat(chunks);
      const entry = { path: req.url, method: req.method };
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!SKIP_REQ.has(k)) headers[k] = v;

      entry.header_names = Object.keys(headers);
      entry.anthropic_beta = req.headers["anthropic-beta"];
      const auth = req.headers.authorization;
      entry.auth = auth ? `${auth.split(" ")[0]} <${auth.length} chars>` : req.headers["x-api-key"] ? "x-api-key" : "none";

      if (req.method === "POST" && String(req.headers["content-type"]).includes("json") && body.length) {
        try {
          const json = JSON.parse(body.toString("utf8"));
          entry.body = summarize(json);
          if (rewrite(json)) {
            entry.rewritten = { model: json.model, output_config: json.output_config };
            body = Buffer.from(JSON.stringify(json));
          }
        } catch (e) {
          entry.body_error = `could not parse JSON: ${e.message}`;
        }
      }

      const upstream = https.request(
        { host: UPSTREAM, path: req.url, method: req.method, headers: { ...headers, host: UPSTREAM, "content-length": body.length } },
        (response) => {
          const rh = {};
          for (const [k, v] of Object.entries(response.headers)) if (!SKIP_RES.has(k)) rh[k] = v;
          log({ ...entry, status: response.statusCode, request_id: response.headers["request-id"] });
          res.writeHead(response.statusCode, rh);
          // Look at the start of the response to find the model the server actually ran (SSE message_start).
          let buffer = "";
          let found = false;
          response.on("data", (c) => {
            if (found || buffer.length > 20000) return;
            buffer += c.toString("utf8");
            const m = buffer.match(/"model"\s*:\s*"([^"]+)"/);
            if (m) {
              found = true;
              log({ path: entry.path, response_model: m[1], response_encoding: response.headers["content-encoding"] });
            }
          });
          response.pipe(res);
        }
      );
      upstream.on("error", (e) => {
        log({ ...entry, error: e.message });
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`proxy upstream error: ${e.message}`);
      });
      upstream.end(body);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`spike proxy http://127.0.0.1:${PORT} -> https://${UPSTREAM}`));
