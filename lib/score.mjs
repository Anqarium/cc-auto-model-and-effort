// Prompt difficulty score (0-100), adapted from OmniRoute's specificityRules/Detector idea:
// rule points are summed per category, each category capped. Patterns cover Turkish and English
// prompts, so the Turkish keyword lists below are intentional.
// Pure function: no I/O, the same input always gives the same result.

// Regexes only scan the first this-many characters: some patterns (file paths) slow down
// quadratically on long input, and scoring runs synchronously on every prompt. Length is measured separately.
const SCAN_LIMIT = 4000;

const count = (text, re) => (text.match(re) ?? []).length;
// search() ignores lastIndex; test() on a regex with the g flag would give wrong results on repeated calls.
const distinct = (text, patterns) => patterns.filter((re) => text.search(re) >= 0).length;

// JS \b only knows ASCII (it misses words starting with Turkish letters like "çöküyor", "güvenlik"),
// so Unicode lookarounds are used instead.
const LEFT = String.raw`(?<![\p{L}\p{N}_])`;
const RIGHT = String.raw`(?![\p{L}\p{N}_])`;
// Stem match: boundary at the word start, any suffix allowed at the end (Turkish suffixes: mimarisi, güvenliği).
const stem = (...words) => new RegExp(String.raw`${LEFT}(?:${words.join("|")})\p{L}*`, "giu");
// Whole word: boundary on both ends; suffixes are spelled out in the pattern ("bul" does not match "bulut").
const word = (...words) => new RegExp(`${LEFT}(?:${words.join("|")})${RIGHT}`, "giu");

const CODE_PATTERNS = /\b(function|class|def|import|const|async|await|interface|SELECT|return|struct)\b/g;
const FILE_PATH = /\b[\w./\\-]+\.(mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|cs|cpp|c|rb|php|json|ya?ml|toml|sql|md|ps1|sh)\b/gi;
const ERROR_PATTERNS = stem("hata", "error", "exception", "traceback", "stack ?trace", "çök", "crash", "başarısız", "failed", "bozuk", "çalışmıyor");

const MATH = [
  /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/,
  stem("denklem", "türev", "integral", "olasılık", "matris", "polinom", "istatistik", "ispat", "teorem", "equation", "derivative", "probability", "matrix", "proof"),
  /[∑∏∫√∞π]/,
  stem("zaman karmaşıklığı", "big[- ]?o", "complexity"),
];

// Requests that signal a hard task even on their own (architecture, root cause, security hole...).
// Stems are cut before Turkish consonant softening: açık/açığı/açıkları → "açı", eşzamanlılık/-lığı → "eşzamanlı".
const HEAVY = [
  stem("mimari", "architecture"),
  stem("tasarla", "tasarım", "design"),
  stem("kök neden", "root cause"),
  stem("baştan yaz", "refactor", "yeniden yapılandır"),
  stem("yarış durumu", "race condition", "deadlock", "eşzamanlı", "concurren"),
  stem("güvenlik açı", "vulnerab", "zafiyet"),
];

const REASONING = [
  word("neden", "niçin", "why"), // whole word, not a stem: the conjunction "bu nedenle" must not match
  stem("analiz", "incele", "araştır", "değerlendir", "karşılaştır", "analy[sz]e", "investigate", "compare", "evaluate"),
  stem("strateji", "trade-?off", "avantaj", "dezavantaj", "alternatif", "seçenek"),
  stem("adım adım", "step by step", "planla", "yol haritası", "roadmap"),
  stem("taşı", "migrate", "entegre et", "integrate"),
  stem("optimiz", "performans", "ölçeklen", "scal(?:e|ing)"),
];

const DOMAIN = [
  stem("güvenlik", "security", "zafiyet", "vulnerab", "şifrele", "encrypt", "oauth", "jwt", "csrf", "xss", "sql injection"),
  stem("kimlik doğrulama", "authentication", "yetkilendirme", "authorization"),
  stem("dağıtık", "distributed", "konsensüs", "consensus", "transaction", "migration", "şema"),
  stem("kernel", "derleyici", "compiler", "parser", "bellek sızıntısı", "memory leak"),
  stem("finansal", "hukuki", "tıbbi", "medical", "legal", "financial"),
];

// Short, mechanical requests that signal an easy task. Whole words with explicit suffixes:
// "bulut", "okul", "gösterge" must not match.
const EASY = word(
  String.raw`yeniden adlandır\p{L}*`, String.raw`rename\p{L}*`, "typos?", String.raw`yazım hata\p{L}*`,
  String.raw`listele\p{L}*`, "göster(?:ir|ebilir|sene|in)?", "nedir", "ne demek", "oku(?:r|sana|yabilir)?",
  "bul(?:ur|sana|abilir)?", "nerede", "hangi(?:si)?", String.raw`format(?:la\p{L}*)?`, String.raw`biçimlendir\p{L}*`,
  String.raw`commit\p{L}*`, String.raw`push\p{L}*`, String.raw`çevir(?:i|ir|sene)?`, "translate", String.raw`özetle\p{L}*`
);

const LEVELS = [
  [5, "trivial"],
  [20, "simple"],
  [40, "moderate"],
  [65, "complex"],
  [Infinity, "expert"],
];

export function levelFor(score) {
  return LEVELS.find(([limit]) => score <= limit)[1];
}

export function scorePrompt(prompt) {
  const fullText = String(prompt ?? "");
  const text = fullText.slice(0, SCAN_LIMIT);
  const length = fullText.length;
  const categories = {
    code: Math.min(
      25,
      Math.round(
        count(text, /```[\s\S]*?```/g) * 5 +
          count(text, /`[^`\n]+`/g) * 0.5 +
          count(text, CODE_PATTERNS) * 2 +
          Math.min(3, count(text, FILE_PATH)) * 2 +
          count(text, ERROR_PATTERNS) * 2
      )
    ),
    math: Math.min(20, distinct(text, MATH) * 6),
    heavy: Math.min(44, distinct(text, HEAVY) * 22),
    reasoning: Math.min(25, distinct(text, REASONING) * 5 + Math.min(5, count(text, /^\s*\d+[.)]\s+\S/gm)) * 2),
    length: length > 2000 ? 15 : length > 1000 ? 10 : length > 400 ? 6 : length > 150 ? 3 : 0,
    domain: Math.min(10, distinct(text, DOMAIN) * 4),
  };

  // The easy marker only counts on a short prompt with no heavy/domain signal:
  // "bul ve düzelt: kök nedeni" must not drop to a cheap model because of "bul".
  const easyAllowed = length <= 250 && categories.heavy === 0 && categories.domain === 0;
  const easyMarkers = easyAllowed ? Math.min(2, count(text, EASY)) : 0;
  const total = Object.values(categories).reduce((a, b) => a + b, 0) - easyMarkers * 8;
  const score = Math.max(0, Math.min(100, total));

  const signals = Object.entries(categories)
    .filter(([, points]) => points > 0)
    .map(([name]) => name);
  if (easyMarkers) signals.push("easy-marker");

  return { score, level: levelFor(score), categories, signals };
}
