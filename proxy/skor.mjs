// Prompt zorluk skoru (0-100). OmniRoute'un specificityRules/Detector fikrinden uyarlandı:
// kategori başına tavanı olan kural puanları toplanır; Türkçe ve İngilizce kalıplar birlikte aranır.
// Saf fonksiyon: I/O yok, aynı girdi her zaman aynı sonucu verir.

// Regex'ler yalnızca ilk bu kadar karaktere uygulanır: bazı kalıplar (dosya yolu) uzun girdide
// karesel yavaşlar ve skorlama proxy'nin event-loop'unda senkron çalışır. Uzunluk ayrıca ölçülür.
const TARAMA_SINIRI = 4000;

const say = (metin, re) => (metin.match(re) ?? []).length;
// search() lastIndex'i kullanmaz; g bayraklı regex ile test() ardışık çağrılarda yanlış sonuç verirdi.
const farkli = (metin, kaliplar) => kaliplar.filter((re) => metin.search(re) >= 0).length;

// JS'te \b yalnızca ASCII bilir ("çöküyor", "güvenlik" kaçar); bu yüzden Unicode lookaround kullanılır.
const SOL = String.raw`(?<![\p{L}\p{N}_])`;
const SAG = String.raw`(?![\p{L}\p{N}_])`;
// Kök eşleşmesi: kelime başında sınır, sonda her ek kabul (mimarisi, güvenliği).
const kok = (...kelimeler) => new RegExp(String.raw`${SOL}(?:${kelimeler.join("|")})\p{L}*`, "giu");
// Tam kelime: iki uçta sınır; ekler kalıbın içinde açıkça yazılır ("bul" → "bulut" eşleşmez).
const tam = (...kelimeler) => new RegExp(`${SOL}(?:${kelimeler.join("|")})${SAG}`, "giu");

const KOD_KALIPLARI = /\b(function|class|def|import|const|async|await|interface|SELECT|return|struct)\b/g;
const DOSYA_YOLU = /\b[\w./\\-]+\.(mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|cs|cpp|c|rb|php|json|ya?ml|toml|sql|md|ps1|sh)\b/gi;
const HATA_KALIPLARI = kok("hata", "error", "exception", "traceback", "stack ?trace", "çök", "crash", "başarısız", "failed", "bozuk", "çalışmıyor");

const MATEMATIK = [
  /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/,
  kok("denklem", "türev", "integral", "olasılık", "matris", "polinom", "istatistik", "ispat", "teorem", "equation", "derivative", "probability", "matrix", "proof"),
  /[∑∏∫√∞π]/,
  kok("zaman karmaşıklığı", "big[- ]?o", "complexity"),
];

// Tek başına bile işin zor olduğuna işaret eden ağır istekler (mimari, kök neden, güvenlik açığı...).
// Kökler ünsüz yumuşamasından önce kesilir: açık/açığı/açıkları → "açı", eşzamanlılık/-lığı → "eşzamanlı".
const AGIR = [
  kok("mimari", "architecture"),
  kok("tasarla", "tasarım", "design"),
  kok("kök neden", "root cause"),
  kok("baştan yaz", "refactor", "yeniden yapılandır"),
  kok("yarış durumu", "race condition", "deadlock", "eşzamanlı", "concurren"),
  kok("güvenlik açı", "vulnerab", "zafiyet"),
];

const AKIL = [
  tam("neden", "niçin", "why"), // kök değil: "bu nedenle" bağlacı eşleşmesin
  kok("analiz", "incele", "araştır", "değerlendir", "karşılaştır", "analy[sz]e", "investigate", "compare", "evaluate"),
  kok("strateji", "trade-?off", "avantaj", "dezavantaj", "alternatif", "seçenek"),
  kok("adım adım", "step by step", "planla", "yol haritası", "roadmap"),
  kok("taşı", "migrate", "entegre et", "integrate"),
  kok("optimiz", "performans", "ölçeklen", "scal(?:e|ing)"),
];

const ALAN = [
  kok("güvenlik", "security", "zafiyet", "vulnerab", "şifrele", "encrypt", "oauth", "jwt", "csrf", "xss", "sql injection"),
  kok("kimlik doğrulama", "authentication", "yetkilendirme", "authorization"),
  kok("dağıtık", "distributed", "konsensüs", "consensus", "transaction", "migration", "şema"),
  kok("kernel", "derleyici", "compiler", "parser", "bellek sızıntısı", "memory leak"),
  kok("finansal", "hukuki", "tıbbi", "medical", "legal", "financial"),
];

// Kolay işlere işaret eden kısa, mekanik istekler. Tam kelime + açık ekler: "bulut", "okul", "gösterge" eşleşmez.
const KOLAY = tam(
  String.raw`yeniden adlandır\p{L}*`, String.raw`rename\p{L}*`, "typos?", String.raw`yazım hata\p{L}*`,
  String.raw`listele\p{L}*`, "göster(?:ir|ebilir|sene|in)?", "nedir", "ne demek", "oku(?:r|sana|yabilir)?",
  "bul(?:ur|sana|abilir)?", "nerede", "hangi(?:si)?", String.raw`format(?:la\p{L}*)?`, String.raw`biçimlendir\p{L}*`,
  String.raw`commit\p{L}*`, String.raw`push\p{L}*`, String.raw`çevir(?:i|ir|sene)?`, "translate", String.raw`özetle\p{L}*`
);

const SEVIYELER = [
  [5, "trivial"],
  [20, "simple"],
  [40, "moderate"],
  [65, "complex"],
  [Infinity, "expert"],
];

export function seviyeBul(skor) {
  return SEVIYELER.find(([sinir]) => skor <= sinir)[1];
}

export function skorla(prompt) {
  const tamMetin = String(prompt ?? "");
  const metin = tamMetin.slice(0, TARAMA_SINIRI);
  const uzunluk = tamMetin.length;
  const kategoriler = {
    kod: Math.min(
      25,
      Math.round(
        say(metin, /```[\s\S]*?```/g) * 5 +
          say(metin, /`[^`\n]+`/g) * 0.5 +
          say(metin, KOD_KALIPLARI) * 2 +
          Math.min(3, say(metin, DOSYA_YOLU)) * 2 +
          say(metin, HATA_KALIPLARI) * 2
      )
    ),
    matematik: Math.min(20, farkli(metin, MATEMATIK) * 6),
    agir: Math.min(44, farkli(metin, AGIR) * 22),
    akil: Math.min(25, farkli(metin, AKIL) * 5 + Math.min(5, say(metin, /^\s*\d+[.)]\s+\S/gm)) * 2),
    ayrinti: uzunluk > 2000 ? 15 : uzunluk > 1000 ? 10 : uzunluk > 400 ? 6 : uzunluk > 150 ? 3 : 0,
    alan: Math.min(10, farkli(metin, ALAN) * 4),
  };

  // Kolay işareti yalnızca kısa ve ağır/alan sinyali olmayan prompt'ta sayılır:
  // "bul ve düzelt: kök nedeni" gibi bir istek "bul" yüzünden ucuz modele düşmemeli.
  const kolayOlabilir = uzunluk <= 250 && kategoriler.agir === 0 && kategoriler.alan === 0;
  const kolayIsaret = kolayOlabilir ? Math.min(2, say(metin, KOLAY)) : 0;
  const toplam = Object.values(kategoriler).reduce((a, b) => a + b, 0) - kolayIsaret * 8;
  const skor = Math.max(0, Math.min(100, toplam));

  const sinyaller = Object.entries(kategoriler)
    .filter(([, puan]) => puan > 0)
    .map(([ad]) => ad);
  if (kolayIsaret) sinyaller.push("kolay-isaret");

  return { skor, seviye: seviyeBul(skor), kategoriler, sinyaller };
}
