# cc-auto-model-and-effort

Claude Code'un modelini ve effort seviyesini, girilen prompt'un zorluğuna göre otomatik seçen yerel bir yönlendirici. Claude aboneliği (OAuth) ile çalışır.

## Kullanım

Gereksinim: Node.js 22+ (bağımlılık yok).

```
.\proxy\claude-auto.ps1
```

Kendi router'ını boş bir portta başlatır, `claude`'u onun üzerinden çalıştırır ve çıkınca durdurur. Her prompt'u 0–100 arası skorlar:

| Prompt | Skor | Model / effort |
|---|---|---|
| Açıkça mekanik (yeniden adlandır, typo, listele…) | 0–5 | Haiku / medium |
| Belirgin zorluk sinyali yok ya da orta | 0–30 | Sonnet / medium |
| Orta-zor (ağır işaret + analiz: race condition'ı incele ve karşılaştır…) | 31–40 | Sonnet / high |
| Zor (mimari + tasarım, kök neden + güvenlik…) | 41–75 | Opus / medium |
| Çok zor ve çok yönlü | 76+ | Opus / high |

Medium her modelin varsayılan effort'u olduğu için en geniş aralığı kaplar; low kullanılmaz.

Alt ajan, özetleme (compaction) ve arka plan isteklerine dokunulmaz. Kararlar ve gerçek çalışan model `proxy/router.log` dosyasına yazılır (prompt metni yazılmaz).

Claude Code'un kendi model göstergesi hep başlattığın modeli (Sonnet) gösterir. Bu yüzden `claude-auto` oturumlarında altta ayrı bir statusline çıkar: `⚡ auto → Opus 5.5 · high · expert (72)`. Gösterilen model, Anthropic'in yanıtında gerçekten dönen modeldir.

Sarmalayıcı, `--model` vermezsen oturumu `sonnet` ile başlatır ve yalnızca o modeli yönlendirir. Claude Pro'da varsayılan model Opus'tur; `--model opus` verirsen ya da oturumda `/model` ile değiştirirsen yönlendirme durur (logda `atlandi` olarak görünür).

Ayrıntılar (mimari, ayarlar, riskler) için `CLAUDE.md`. Testler: `node --test proxy/test/*.test.mjs`.

> **Not:** Abonelik tokeniyle istek gövdesini değiştiren yerel bir proxy kullanmanın Anthropic kullanım koşullarına uygunluğu doğrulanmamıştır; kendi sorumluluğunda kullan.
