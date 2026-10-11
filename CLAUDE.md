# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Amaç

Claude Code'un girilen prompt'a göre modeli ve effort seviyesini otomatik seçmesini sağlamak. Kullanıcı Claude aboneliği (OAuth) kullanıyor, API key değil. Önceki subagent denemesi (`gorev-kolay/orta/zor`) çok nadir kullanıldığı için beğenilmedi.

## Komutlar

Bağımlılık yok (yalnızca Node ≥ 22, yerleşik modüller). Windows/PowerShell birincil ortam.

```
node --test proxy/test/*.test.mjs                 # tüm testler (ağa çıkmaz, sahte upstream kullanır)
node --test proxy/test/skor.test.mjs              # tek test dosyası
.\proxy\claude-auto.ps1 [claude argümanları]      # router'ı gerekirse başlatıp claude'u onun üzerinden çalıştırır
node proxy/router.mjs                             # router'ı elle başlat (127.0.0.1:8787)
MODE=log node proxy/router.mjs                    # yalnızca karar logla, gövdeye dokunma
```

Router ortam değişkenleri: `PORT` (8787), `UPSTREAM_URL` (https://api.anthropic.com), `ROUTE_FROM` (virgüllü model listesi, varsayılan `claude-sonnet-5-5`), `MODE` (`route`|`log`), `DOWNGRADE_MAX_TOKENS` (30000), `ROUTER_LOG` (`proxy/router.log`).

Gerçek çalışan modeli görmek için `proxy/router.log` içindeki `yanit_modeli` alanına bak. Claude Code'un `modelUsage` ve statusline göstergeleri istemcinin *istediği* modeli gösterir, router'ın değiştirdiğini yansıtmaz.

## Mimari

`claude-auto.ps1` → `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` ile `claude --model sonnet` başlatır (değişken yalnızca o çalıştırma için ayarlanır, sonra geri alınır). Claude Code'un her `/v1/messages` isteği `proxy/router.mjs`'den geçer; router OAuth başlıklarını aynen `api.anthropic.com`'a iletir ve gövdedeki `model` ile `output_config.effort` alanlarını yeniden yazar. Üç modül:

- `proxy/skor.mjs` — saf fonksiyon `skorla(prompt)`: 0–100 zorluk skoru. OmniRoute'un `specificityRules` fikrinden uyarlandı: kategori başına tavanlı kural puanları (kod, matematik, **agir** = mimari/tasarım/kök neden/güvenlik açığı gibi tek başına zor işaretleri, akıl yürütme, ayrıntı, alan) ve kolay-işaret cezası. Kalıplar Türkçe+İngilizce; `kok()` yardımcısı Unicode-farkında kelime başı sınırı ve ek toleransı kullanır (JS `\b` ASCII bilir, `çöküyor`/`güvenlik` gibi kelimeleri kaçırır).
- `proxy/karar.mjs` — `kararVer`: `ESLEME` tablosu seviyeyi (trivial/simple/moderate/complex/expert) model+effort'a çevirir (haiku-low / sonnet-low / sonnet-medium / opus-medium / opus-high). Üç kural: (1) yalnızca `ROUTE_FROM` modelindeki **araçlı** istekler yönlendirilir (alt ajan ve arka plan istekleri atlanır); (2) aynı kullanıcı prompt'u boyunca (ajan döngüsü, tool_result turları) karar sabit kalır, anahtar `x-claude-code-session-id` + gerçek prompt'un mesaj indeksi; 25 karakterden kısa prompt ("devam et") önceki kararı sürdürür; (3) cache histerezisi: tahmini bağlam > `DOWNGRADE_MAX_TOKENS` ise model düşürülmez (yükseltme serbest, effort yine ayarlanır); ilk istekte taban istemcinin istediği modeldir.
- `proxy/router.mjs` — HTTP proxy. Yönlendirme hatası isteği düşürmez (gövdeyi olduğu gibi iletir). `accept-encoding` iletilmez ki yanıttaki gerçek model okunabilsin. Mesaj içeriği ve token değeri loglanmaz.

`proxy/spike.mjs` ilk keşif aracıdır (yalnızca iletir ve istek yapısını loglar); `router.mjs` onun yerini aldı, tanılama için duruyor.

## Doğrulananlar (2026-10-10/11, Claude Code v2.1.296, Claude Pro/OAuth)

- Proxy üzerinden `Authorization: Bearer` + `anthropic-beta: ...oauth-2025-04-20...` aynen iletilince istek 200 döner; ek giriş gerekmez.
- Gövde: model = üst düzey `model`; effort = `output_config.effort`. Yeniden yazılan gövde kabul edilir ve yanıt SSE `message_start` içinde yeni modelle gelir.
- Uçtan uca (`claude-auto.ps1 -p ...`): "yazım hatası düzelt" → skor 0 → haiku-low, yanıt `claude-haiku-5-5`; "kök neden / race condition / güvenlik" → skor 72 → opus-high, yanıt `claude-opus-5-5`.

## Riskler ve doğrulanmayanlar

- Abonelik OAuth'u ile yerel proxy kullanmanın Anthropic kullanım koşullarına uygunluğu doğrulanmadı; kullanıcı riski bilerek devam etti (2026-10-11).
- Model değişince prompt cache yeniden kurulur (cache modele özel, abonelik kullanım limitine yansır). Histerezis yalnızca *düşürmeyi* sınırlar; yükseltmede maliyet kabul edilir. Gerçek maliyet ölçülmedi.
- Skorlayıcı kural tabanlıdır; sınırlar ve ağırlıklar elle ayarlandı, gerçek kullanımla kalibre edilmedi. Karar logu (`router.log`: seviye, skor, sinyaller) kalibrasyon için kullanılabilir.
- Claude Code'un model davranışları (örn. 1M bağlam, thinking `adaptive`) istemci tarafında *istenen* modele göre ayarlanır; Haiku'ya yazılan isteklerde şimdiye kadar sorun görülmedi.

## Elenen yaklaşımlar (kısa)

- **Hook + skill:** `UserPromptSubmit` hook'u model/effort değiştiremez (yalnızca `additionalContext`). Skill frontmatter `model` override'ı v2.1.296'da gerçek modeli değiştirmiyor: arayüz `claude-opus-5-5` gösterse de skill sonrası mesaj `claude-sonnet-5-5` ile üretildi ve `cache_read_input_tokens` önceki Sonnet önekiyle birebir eşleşti (hem `claude -p` hem interaktif). Geri bildirim gönderildi. Prototip `9075d5e` commit'inde duruyor, kaldırıldı.
- **OmniRoute / CLIProxyAPI:** Prompt zorluğuna göre değil maliyet/kota/sağlık skoruna göre sağlayıcılar arası seçer ya da alias'ı istemciye bırakır; Claude effort yönetmez; abonelik tokenını üçüncü tarafa verir. Yalnızca OmniRoute'un zorluk skoru fikri alındı (kaynak: GitHub `diegosouzapw/OmniRoute`, `open-sse/services/specificityRules.ts`, `complexityRouter.ts`). Kurulum denemesi kaldırıldı.
- **Subagent devri:** ana model değişmez, her devir bağlamı sıfırdan yükler.
- Doküman bulguları: `opusplan` plan moduna bağlı; `--effort`/`CLAUDE_CODE_EFFORT_LEVEL` oturum düzeyinde; gateway dokümanı gövdeyi değiştirmemeyi önerir ama yeniden yazım pratikte kabul ediliyor.

## İşler bitince değinilecek (bu projenin konusu değil)

- **Kapanış hook'u (`SessionEnd`/`Stop`):** Kullanıcı daha önce bir tane yaptığını söylüyor, ama 2026-10-10'da `~/.claude/settings.json` (yalnızca `PreToolUse`/Agent ve `PostToolUse`/`git push`) içinde yok; interaktif oturum transkriptinde de `SessionEnd` kaydı yok. Eklentilerde (plugin) veya başka bir yapılandırma katmanında olabilir, orası kontrol edilmedi. Nerede olduğunu bul ya da yeniden kur.

## Sıradaki işler

1. Gerçek kullanımla birkaç gün çalıştır; `router.log`'daki karar dağılımına bakıp `skor.mjs` ağırlıklarını ve `ESLEME` tablosunu kalibre et.
2. Cache maliyetini ölç (model geçişlerinin `cache_creation_input_tokens` etkisi).
3. İstenirse `claude-auto`'yu PATH'e alacak kısayol (şimdilik `.\proxy\claude-auto.ps1`).
