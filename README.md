# cc-auto-model-and-effort

Claude Code'un modelini ve effort seviyesini, girilen prompt'un zorluğuna göre otomatik seçen bir Claude Code eklentisi (mod: `auto-model-effort`). Claude aboneliği (OAuth) ile çalışır; proxy veya arka plan süreci gerekmez.

## Kurulum

Gereksinim: Claude Code 2.1.296+ (mod API'si erken erişimde).

```
/plugin install auto-model-effort --marketplace Anqarium/cc-auto-model-and-effort
```

Yerel bir kopyadan kurmak için (kod değişiklikleri `/reload-plugins` ile yansır):

```
claude plugin marketplace add <bu repo klasörü>
claude plugin install auto-model-effort@anqarium
```

## Kullanım

Kurulduktan sonra düz `claude` yeterli. Oturum Sonnet ile açıldığında her prompt 0–100 arası skorlanır:

| Prompt | Skor | Model / effort |
|---|---|---|
| Açıkça mekanik (yeniden adlandır, typo, listele…) | 0–5 | Haiku / medium |
| Belirgin zorluk sinyali yok ya da orta | 0–30 | Sonnet / medium |
| Orta-zor (ağır işaret + analiz: race condition'ı incele ve karşılaştır…) | 31–40 | Sonnet / high |
| Zor (mimari + tasarım, kök neden + güvenlik…) | 41–75 | Opus / medium |
| Çok zor ve çok yönlü | 76+ | Opus / high |

Medium her modelin varsayılan effort'u olduğu için en geniş aralığı kaplar; low kullanılmaz. Alt ajanların modeline dokunulmaz. Seçilen model ve effort status line'da görünür: `⚡ auto → Opus 5.5 · high · expert (72)`.

Mod yalnızca Sonnet oturumunu yönlendirir; oturumda `/model` ile başka modele geçersen yönlendirme durur (status line'da `auto kapalı` görünür). Bir model isteği reddedilirse aynı istek oturumun kendi modeliyle tekrar gönderilir.

`/auto-log` komutu kararların dağılımını, gerçekte çalışan modeli ve cache kullanımını özetler.

Ayrıntılar (mimari, riskler, denenen yollar) için `CLAUDE.md`. Testler: `node --test test/*.test.mjs`, mod doğrulama: `claude plugin validate .`.
