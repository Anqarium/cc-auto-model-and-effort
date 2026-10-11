# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Amaç

Claude Code'un girilen prompt'a göre modeli ve effort seviyesini otomatik seçmesini sağlamak. Kullanıcı Claude aboneliği (OAuth) kullanıyor, API key değil. Önceki subagent yaklaşımı (`gorev-kolay/orta/zor` + global `CLAUDE.md`'deki "Model Yönlendirmesi" kuralı) router'la çakıştığı için 2026-10-11'de kaldırıldı; ajan dosyaları `~/.claude/agents-yedek-20261011-132617/` altında.

## Komutlar

Bağımlılık yok (yalnızca Node ≥ 22, yerleşik modüller). Windows/PowerShell birincil ortam.

```
node --test proxy/test/*.test.mjs                 # tüm testler (ağa çıkmaz, sahte upstream kullanır)
node --test --test-name-pattern "iptal" proxy/test/router.test.mjs   # tek test
.\proxy\claude-auto.ps1 [claude argümanları]      # kendi portunda router başlatıp claude'u onun üzerinden çalıştırır
.\proxy\claude-auto.ps1 --version                 # API'ye istek atmadan sarmalayıcıyı dener
node proxy/router.mjs                             # router'ı elle başlat (127.0.0.1:8787)
MODE=log node proxy/router.mjs                    # yalnızca karar logla, gövdeye dokunma
echo '{"session_id":"x"}' | node proxy/statusline.mjs   # statusline çıktısını elle dene
```

Kullanıcının PowerShell profilinde (`Documents 1\PowerShell\Microsoft.PowerShell_profile.ps1`) `claude-auto` fonksiyonu bu betiği çağırır; aynı dosyadaki `omni` fonksiyonu kullanıcınındır, dokunma.

Router ortam değişkenleri: `PORT` (8787), `UPSTREAM_URL` (https://api.anthropic.com), `ROUTE_FROM` (virgüllü model listesi, varsayılan `claude-sonnet-5-5`), `MODE` (`route`|`log`), `DOWNGRADE_MAX_TOKENS` (30000), `ROUTER_LOG` (`proxy/router.log`), `CLAUDE_AUTO_DURUM` (statusline durum klasörü, varsayılan `%TEMP%\claude-auto`), `CLAUDE_AUTO_EBEVEYN` (izlenecek üst süreç PID'i; ölünce router kapanır).

Gerçek çalışan modeli görmek için `proxy/router.log` içindeki `yanit_modeli` alanına bak (yanında gerçek `usage`: `cache_yazma`/`cache_okuma`). Claude Code'un `modelUsage` ve statusline göstergeleri istemcinin *istediği* modeli gösterir, router'ın değiştirdiğini yansıtmaz.

## Mimari

`claude-auto.ps1` → boş bir port seçip kendi router'ını başlatır (`/__router` sağlık yolu ile doğrular), `ANTHROPIC_BASE_URL` ve `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` ayarlayıp `claude --settings <geçici statusline ayarı> --model sonnet` çalıştırır (kullanıcı `--model` verdiyse dokunmaz), çıkışta router'ı durdurur ve değişkenleri geri alır. Her pencerenin ayrı router'ı vardır. Pencere X ile kapatılırsa PowerShell `finally` çalışmaz; bu yüzden router `CLAUDE_AUTO_EBEVEYN` PID'ini 3 sn'de bir yoklar ve süreç yoksa kendini kapatır. Betikte bilerek `param()` bloğu yok: `[Parameter]` PowerShell'e `-p`'yi ortak parametre öneki sandırır.

Statusline: Claude Code'un kendi model göstergesi istemcinin *istediği* modeli gösterir. Bu yüzden router her ana konuşma kararını ve yanıttaki gerçek modeli `%TEMP%\claude-auto\<session_id>.json` dosyasına yazar (`x-claude-code-session-id` = statusline girdisindeki `session_id`, transkript dosya adıyla da aynı; doğrulandı). `proxy/statusline.mjs` bunu okuyup `⚡ auto → Opus 5.5 · high · expert (72)` basar. Statusline yalnızca `claude-auto` oturumlarına `--settings` ile eklenir; kullanıcının global `statusLine` ayarı yok (ekrandaki "Clear · % of context" bandı bir eklentiden geliyor). Bir günden eski durum dosyaları router açılışında silinir.

Claude Code'un her `/v1/messages` isteği `proxy/router.mjs`'den geçer; OAuth başlıkları aynen `api.anthropic.com`'a iletilir, gövdedeki `model` ve `output_config.effort` yeniden yazılır. Üç modül:

- `proxy/skor.mjs` — saf `skorla(prompt)`: 0–100 zorluk skoru. OmniRoute'un `specificityRules` fikrinden uyarlandı: kategori başına tavanlı kural puanları (kod, matematik, **agir** = mimari/tasarım/kök neden/güvenlik açığı gibi tek başına zor işaretleri, akıl yürütme, ayrıntı, alan) ve kolay-işaret cezası. Kalıplar Türkçe+İngilizce. `kok()` kelime başında Unicode sınır + sonda ek toleransı, `tam()` iki uçta sınır (kolay kelimeleri için: "bul" → "bulut" eşleşmesin). JS `\b` ASCII bilir, Türkçe harfle başlayan kelimeleri kaçırır. Regex'ler yalnızca ilk 4000 karaktere uygulanır (dosya yolu regex'i uzun girdide karesel yavaşlar; skorlama event-loop'ta senkron). Kolay cezası ağır/alan sinyali varsa uygulanmaz.
- `proxy/karar.mjs` — `kararVer(body, ipucu, oturumlar, cfg)`; `{atla, sebep}` ya da karar döner. Kurallar: (1) yalnızca `x-claude-code-request-class: main` istekleri yönlendirilir (başlık yoksa yedek sezgi: `agent-id` varsa ya da `tools` boşsa atla); `ROUTE_FROM` dışı model atlanır ve sebebi loglanır. (2) Karar anahtarı `x-claude-code-prompt-id` (yoksa mesaj indeksi + metin özeti, rewind'a karşı); aynı prompt boyunca karar sabit. Sinyalsiz, 25 karakterden kısa prompt ("devam et") önceki kararı sürdürür. (3) Model seviyeye göre (`ESLEME`): trivial/simple/moderate → sonnet, complex/expert → opus; yalnızca açık kolay işaretli trivial prompt → haiku (`KOLAY_ESLEME`). Yanlış ucuz model daha zararlı olduğu için kanıtsız prompt ucuza inmez. Effort skora göre ve model başına (`effortBul`, `YUKSEK_EFFORT_ESIGI`): medium her modelin varsayılanı olduğu için geniş tutulur (kullanıcı tercihi); haiku hep medium, sonnet skor > 30 ise high, opus skor > 75 ise high; low kullanılmaz. Effort histerezisten sonra, gerçekten çalışacak modelin eşiğine göre belirlenir. (4) Histerezis: `messages` tahmini > `DOWNGRADE_MAX_TOKENS` ise model düşürülmez; ilk istekte taban istemcinin istediği model.
- `proxy/router.mjs` — HTTP proxy. Hop-by-hop başlıklar ve `accept-encoding` iletilmez. İstemci iptalinde (Esc) upstream isteği kesilir; upstream akış ortasında koparsa istemci bağlantısı da kapatılır. Yalnızca tam `/v1/messages` yolu yönlendirilir (`count_tokens` değil). Yeniden yazılmış istek 400/404 alırsa API hata mesajı loglanır, orijinal gövdeyle bir kez yeniden denenir ve o prompt pasifleşir (`pasiflestir`). Yönlendirme hatası isteği düşürmez. Mesaj içeriği ve token değeri loglanmaz.

`proxy/spike.mjs` ilk keşif aracıdır (yalnızca iletir ve istek yapısını loglar); `router.mjs` onun yerini aldı, tanılama için duruyor.

## Doğrulananlar (2026-10-10/11, Claude Code v2.1.296, Claude Pro/OAuth)

- Proxy üzerinden `Authorization: Bearer` + `anthropic-beta: ...oauth-2025-04-20...` aynen iletilince istek 200 döner; ek giriş gerekmez. Doküman ([llm-gateway](https://code.claude.com/docs/en/llm-gateway)) abonelik + gateway'i, OAuth başlığının iletilmesi şartıyla anlatıyor.
- Gövde: model = üst düzey `model`; effort = `output_config.effort`. Yeniden yazılan gövde kabul edilir, yanıt SSE `message_start` içinde yeni modelle gelir.
- `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` ile ana istek `x-claude-code-request-class: main` taşıyor (gerçek API ile doğrulandı). Başlıklar [llm-gateway-protocol](https://code.claude.com/docs/en/llm-gateway-protocol) dokümanında.
- Uçtan uca (`claude-auto.ps1 -p ...`): "yazım hatası düzelt" → haiku-low, yanıt `claude-haiku-5-5`; "kök neden / race condition / güvenlik" → opus-high, yanıt `claude-opus-5-5`.
- Cache: kullanıcının ortamında sabit önek (sistem + ~221 araç) ≈ 211 bin token. Önek model başına **oturumlar arası** cache'leniyor: önceki Haiku oturumlarından sonra yeni bir oturumun Haiku isteği `cache_okuma: 211231, cache_yazma: 0` gösterdi. Model değişiminin maliyeti esas olarak her modelin önekini TTL içinde bir kez yazmak. (Gövde baytı/4 tahmini gerçek token sayısının ~%65'i.)
- Mutasyon kontrolü: iptal, akış kopması ve ReDoS düzeltmelerinin her biri geri alınınca ilgili test kırılıyor.

## Riskler ve doğrulanmayanlar

- Abonelik OAuth'u ile gövde yeniden yazmanın kullanım koşullarına uygunluğu: açık hüküm bulunamadı; protokol dokümanı gövdeyi değiştirmemeyi öneriyor, [legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance) Anthropic'in önceden haber vermeden önlem alabileceğini söylüyor. Consumer Terms okunmadı. Kullanıcı riski bilerek devam etti (2026-10-11).
- Skorlayıcı kural tabanlı; ağırlıklar elle ayarlandı, gerçek kullanımla kalibre edilmedi. Bilinen zayıflık: "tasarım" kelimesi UI işlerinde de ağır sayılır (sonnet-high).
- `router.log` sınırsız büyür.
- Oturum başında Claude Code'un 79 token'lık `auxiliary` isteği ara sıra 429 alıyor; router bu isteğe dokunmuyor (gövde değişmeden gidiyor). Proxy'siz de olup olmadığı karşılaştırılmadı.

İnteraktif doğrulama (2026-10-11, stock-tracker-v2): aynı oturumda haiku → sonnet-medium → sonnet-high → opus-medium → opus-high geçişleri statusline'da beklenen skorlarla göründü, `router.log`'da hiç `geri_donus` yok (çok turlu thinking blokları sorun çıkarmadı).

## Elenen yaklaşımlar (kısa)

- **Hook + skill:** `UserPromptSubmit` hook'u model/effort değiştiremez. Skill frontmatter `model` override'ı ana modeli değiştirmiyor; [model-config](https://code.claude.com/docs/en/model-config) bir yerde "Claude Code ignores the override … runs on the session model" diyor (bağlamı tam okunmadı). Arayüz yine de `claude-opus-5-5` etiketi gösteriyor (yanıltıcı). Prototip `9075d5e` commit'inde, kaldırıldı.
- **OmniRoute / CLIProxyAPI:** prompt zorluğuna göre değil maliyet/kota/sağlık skoruna göre sağlayıcılar arası seçer ya da alias'ı istemciye bırakır; Claude effort yönetmez; abonelik tokenını üçüncü tarafa verir. Yalnızca OmniRoute'un zorluk skoru fikri alındı (`open-sse/services/specificityRules.ts`, `complexityRouter.ts`).
- **Subagent devri:** ana model değişmez. Agent aracının `effort` parametresi (v2.1.292+) var ama kararı model verir.
- Keşfedilmemiş tek resmi yol: changelog 2.1.290, `claude agents` üzerinden meşgul oturuma gönderilen `/model`, `/effort` (doğrulanmadı).

## İşler bitince değinilecek (bu projenin konusu değil)

- **Kapanış hook'u (`SessionEnd`/`Stop`):** Kullanıcı daha önce bir tane yaptığını söylüyor, ama 2026-10-10'da `~/.claude/settings.json` (yalnızca `PreToolUse`/Agent ve `PostToolUse`/`git push`) içinde yok; interaktif oturum transkriptinde de `SessionEnd` kaydı yok. Eklentilerde (plugin) veya başka bir yapılandırma katmanında olabilir, orası kontrol edilmedi.
- **Bağlam boyutu:** sabit önek ≈ 211 bin token (çoğu MCP araç tanımları). Her yeni model/TTL için bu kadar cache yazılıyor; kullanılmayan MCP sunucularını kapatmak maliyeti düşürür.

## Sıradaki işler

1. Gerçek kullanımla çalıştır; `router.log`'daki karar dağılımına, `geri_donus` ve `cache_yazma` değerlerine bakıp `skor.mjs` ağırlıklarını ve `ESLEME` tablosunu kalibre et.
2. İstenirse log döndürme ve `claude-auto`'yu PATH'e alan kısayol.
