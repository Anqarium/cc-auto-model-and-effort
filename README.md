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

Kurulduktan sonra düz `claude` yeterli. Oturum hangi modelde açılırsa açılsın (sonradan `/model` ile değiştirsen de) her prompt 0–100 arası skorlanır:

| Prompt | Skor | Model / effort |
|---|---|---|
| Açıkça mekanik (yeniden adlandır, typo, listele…) | 0–5 | Haiku / medium |
| Belirgin zorluk sinyali yok ya da orta | 0–30 | Sonnet / medium |
| Orta-zor (ağır işaret + analiz: race condition'ı incele ve karşılaştır…) | 31–40 | Sonnet / high |
| Zor (mimari + tasarım, kök neden + güvenlik…) | 41–75 | Opus / medium |
| Çok zor ve çok yönlü | 76+ | Opus / high |

Medium her modelin varsayılan effort'u olduğu için en geniş aralığı kaplar; low kullanılmaz. Alt ajanların modeline dokunulmaz. Seçilen model ve effort prompt satırının sağında soluk bir etiket olarak görünür: `⚡ Opus 5.5 · medium · complex 49`.

Belirli bir modeli zorlamak istediğinde `/auto kapat` yaz: o oturumda yönlendirme durur ve seçtiğin model kullanılır; `/auto ac` geri açar, argümansız `/auto` aç/kapat yapar. Yeni oturum her zaman açık başlar; açılışta ve `/auto` sonrası birkaç saniye `⚡ auto açık · /auto ile kapat` (ya da `auto kapalı · /auto ile aç`) bildirimi görünür. Bir model isteği reddedilirse aynı istek oturumun kendi modeliyle tekrar gönderilir.

`/auto-log` komutu kararların dağılımını, gerçekte çalışan modeli ve cache kullanımını özetler.

Ayrıntılar (mimari, riskler, denenen yollar) için `CLAUDE.md`. Testler: `node --test test/*.test.mjs`, mod doğrulama: `claude plugin validate .`.
