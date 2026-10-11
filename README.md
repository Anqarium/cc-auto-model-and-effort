# cc-auto-model-and-effort

Claude Code'un modelini ve effort seviyesini, girilen prompt'un zorluğuna göre otomatik seçen yerel bir yönlendirici. Claude aboneliği (OAuth) ile çalışır.

## Kullanım

Gereksinim: Node.js 22+ (bağımlılık yok).

```
.\proxy\claude-auto.ps1
```

Router'ı başlatır, `claude`'u onun üzerinden çalıştırır ve çıkınca durdurur. Her prompt'u 0–100 arası skorlar ve isteği şuna çevirir: kolay işler Haiku/low, orta işler Sonnet, zor işler Opus (medium/high). Kararlar `proxy/router.log` dosyasına yazılır (prompt metni yazılmaz).

Ayrıntılar (mimari, ayarlar, riskler) için `CLAUDE.md`. Testler: `node --test proxy/test/*.test.mjs`.

> **Not:** Abonelik tokeniyle yerel proxy kullanmanın Anthropic kullanım koşullarına uygunluğu doğrulanmamıştır; kendi sorumluluğunda kullan.
