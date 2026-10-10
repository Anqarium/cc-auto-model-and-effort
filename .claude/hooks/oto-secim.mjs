// UserPromptSubmit hook: prompt'u sınıflandırır ve Claude'a ilgili oto-* skill'ini
// çağırmasını söyler. Skill frontmatter'ındaki model/effort o tur için geçerli olur.
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOG = join(dirname(fileURLToPath(import.meta.url)), "..", "oto-secim.jsonl");

const ZOR = /mimari|tasar[ıi]m kararı|kök neden|root cause|güvenlik|security|algoritma|architecture|race condition|performans analiz|neden .*(çöküyor|bozuluyor)/i;
const KOLAY = /yeniden adland|rename|biçimlendir|format\b|listele|\bbul\b|nerede|typo|yazım hatası|boilerplate|^(ne|nedir|kaç)\b/i;

export function siniflandir(prompt) {
  const p = prompt.trim();
  if (p.length > 1500 || ZOR.test(p)) return "zor";
  if (p.length < 120 && KOLAY.test(p)) return "kolay";
  return "orta";
}

async function main() {
  let girdi;
  try {
    girdi = JSON.parse(readFileSync(0, "utf8"));
  } catch (e) {
    console.error(`oto-secim: stdin JSON okunamadı: ${e.message}`);
    process.exit(1);
  }
  const prompt = girdi.prompt ?? "";
  if (!prompt.trim() || prompt.trimStart().startsWith("/")) return; // slash komutlarına dokunma

  const seviye = siniflandir(prompt);
  try {
    appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), seviye, uzunluk: prompt.length }) + "\n");
  } catch (e) {
    console.error(`oto-secim: log yazılamadı: ${e.message}`);
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `[oto-secim] Bu istek "${seviye}" olarak sınıflandı. Başka hiçbir şey yapmadan ÖNCE Skill aracıyla "oto-${seviye}" skill'ini çağır; sonra kullanıcının isteğini normal şekilde yerine getir.`,
    },
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
