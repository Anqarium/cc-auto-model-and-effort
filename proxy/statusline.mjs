// Claude Code statusline komutu: claude-auto router'ının bu oturum için son kararını gösterir.
// Claude Code stdin'den oturum bilgisini (session_id dahil) JSON olarak verir; router aynı kimlikle
// durum dizinine (%TEMP%/claude-auto/<session_id>.json) yazar. claude-auto.ps1 bunu --settings ile bağlar.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { satir } from "./gorunum.mjs";
import { durumDizini } from "./router.mjs";

export { satir };

export function durumOku(sessionId, dizin = durumDizini()) {
  if (!/^[\w-]{1,100}$/.test(String(sessionId ?? ""))) return null;
  try {
    return JSON.parse(readFileSync(join(dizin, `${sessionId}.json`), "utf8"));
  } catch {
    return null; // henüz karar yok ya da router başka bir oturumu yönetiyor
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let girdi = {};
  try {
    girdi = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // statusline girdisi okunamazsa da bir satır basılmalı
  }
  console.log(satir(durumOku(girdi.session_id)));
}
