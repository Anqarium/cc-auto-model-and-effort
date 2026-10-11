# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Amaç

Claude Code'un girilen prompt'a göre modeli ve effort seviyesini otomatik seçmesini sağlamak. Kullanıcı Claude aboneliği (OAuth) kullanıyor, API key değil. Önceki subagent yaklaşımı (`gorev-kolay/orta/zor` + global `CLAUDE.md`'deki "Model Yönlendirmesi" kuralı) çakıştığı için 2026-10-11'de kaldırıldı; ajan dosyaları `~/.claude/agents-yedek-20261011-132617/` altında.

İki uygulama var, aynı seçim mantığını paylaşırlar:
- **Mod (birincil):** repo kökü bir Claude Code eklentisi (`auto-model-effort`); `turn.step` kancasıyla her model isteğinin model/effort'unu Claude Code'un içinde değiştirir. Proxy, port, süreç yok.
- **Proxy (eski yol, yedek):** `proxy/router.mjs`, `ANTHROPIC_BASE_URL` ile araya girip istek gövdesini yeniden yazar. Mod kanıtlandıktan sonra emekliye ayrılması planlanıyor; kullanıcıya sormadan silme.

## Komutlar

Bağımlılık yok (yalnızca Node ≥ 22, yerleşik modüller). Windows/PowerShell birincil ortam.

```
node --test proxy/test/*.test.mjs                 # tüm testler (ağa çıkmaz, sahte upstream kullanır)
node --test --test-name-pattern "iptal" proxy/test/router.test.mjs   # tek test
claude plugin validate .                          # mod'un manifestini ve hooks modülünü doğrular
.\claude-auto.ps1 [claude argümanları]            # mod yüklü claude (= claude --plugin-dir <repo> --model sonnet ...)
.\proxy\claude-auto.ps1 [claude argümanları]      # proxy yolu: kendi portunda router + claude
MODE=log node proxy/router.mjs                    # proxy: yalnızca karar logla, gövdeye dokunma
node proxy/spike.mjs                              # gözlemci: gövdeye dokunmadan istek yapısını (model, output_config.effort) proxy/spike.log'a yazar
```

Mod'u gerçek API ile doğrulamak (giden isteği görmek için spike gözlemci olarak araya girer):
`node proxy/spike.mjs` arka planda, sonra `ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude -p "<prompt>" --model sonnet --plugin-dir <repo> --output-format json`; `proxy/spike.log`'da `govde.model` / `govde.output_config.effort`.

Kullanıcının PowerShell profilinde (`Documents 1\PowerShell\Microsoft.PowerShell_profile.ps1`) `claude-auto` fonksiyonu kökteki `claude-auto.ps1`'i çağırır; aynı dosyadaki `omni` fonksiyonu kullanıcınındır, dokunma. Betiklerde bilerek `param()` bloğu yok: `[Parameter]` PowerShell'e `-p`'yi ortak parametre öneki sandırır.

## Mimari

Ortak, saf (Node'suz) modüller — mod Node'suz bir ortamda çalıştığı için bunlar `node:` modülü içe aktaramaz:
- `proxy/skor.mjs` — `skorla(prompt)`: 0–100 zorluk skoru. OmniRoute'un `specificityRules` fikrinden uyarlandı: kategori başına tavanlı kural puanları (kod, matematik, **agir** = mimari/tasarım/kök neden/güvenlik açığı gibi tek başına zor işaretleri, akıl yürütme, ayrıntı, alan) ve kolay-işaret cezası. Kalıplar Türkçe+İngilizce. `kok()` kelime başında Unicode sınır + sonda ek toleransı, `tam()` iki uçta sınır (kolay kelimeleri için: "bul" → "bulut" eşleşmesin). JS `\b` ASCII bilir, Türkçe harfle başlayan kelimeleri kaçırır. Kökler ünsüz yumuşamasından önce kesilir (açık/açığı → "açı"). Regex'ler yalnızca ilk 4000 karaktere uygulanır (ReDoS; skorlama senkron). Kolay cezası ağır/alan sinyali varsa uygulanmaz.
- `proxy/secim.mjs` — `secimYap(metin, {onceki, istemciModeli, baglamTokeni, dusurmeSiniri})`. Model seviyeye göre (`ESLEME`): trivial/simple/moderate → sonnet, complex/expert → opus; yalnızca açık kolay işaretli trivial → haiku (`KOLAY_ESLEME`); kanıtsız prompt ucuza inmez. Effort skora göre ve model başına (`effortBul`, `YUKSEK_EFFORT_ESIGI`): medium her modelin varsayılanı olduğu için geniş (kullanıcı tercihi): haiku hep medium, sonnet > 30 high, opus > 75 high, low yok. Sinyalsiz, 25 karakterden kısa prompt ("devam et") önceki kararı sürdürür. Histerezis: konuşma tahmini > sınır ise model düşürülmez; ilk kararda taban istemcinin modeli. Effort histerezisten sonra, çalışacak modelin eşiğine göre.
- `proxy/gorunum.mjs` — `satir(d)`: statusline metni (`⚡ auto → Opus 5.5 · high · expert (72)`).

**Mod** (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`): `turn.start` kullanıcının prompt metnini verir (prompt'suz turda — arka plan ajanı bildirimi, devam — metin boş, önceki karar sürer); karar `secimYap` ile verilir, bağlam tahmini `$.session.messages()`'tan. `turn.step` her model isteğinde çalışır: `agentId` varsa (alt ajan) dokunmaz; oturum modeli `claude-sonnet-5-5` değilse (`/model` ile değiştirildiyse) yönlendirmez ve statusline'da söyler; aksi hâlde `next({ ...e, model, effort })`. Statusline `$.ui.status`, gerçek model yanıtın `usage.model`'inden. Mod API'si için tipler: plugin-authoring skill'inin `types/claude-code.d.ts`'i (`'turn.step'`, `TurnStepInput`, `TurnStepResult`); engine mod yüklenince `.claude-plugin/types/` yazar (gitignore'da). Eklenti adı `claude-` ile başlayamaz (Anthropic'e ayrılmış). Kalıcı log yok (`$.fs.write` dosyanın tamamını yazar, ekleme yok).

**Proxy** (`proxy/router.mjs` + `proxy/karar.mjs`): `karar.mjs` istek gövdesinden gerçek prompt'u bulur (tool_result, `<system-reminder>`, `<task-notification>` vb. atlanır), yalnızca `x-claude-code-request-class: main` isteklerini yönlendirir (başlıklar `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` ile açılır; yoksa yedek sezgi), karar anahtarı `x-claude-code-prompt-id` (yoksa indeks + metin özeti). `router.mjs`: hop-by-hop başlıklar ve `accept-encoding` iletilmez; Esc'te upstream kesilir; akış koparsa istemci kapatılır; yalnızca tam `/v1/messages` yönlendirilir; yeniden yazılmış istek 400/404 alırsa orijinalle bir kez tekrar denenir ve prompt pasifleşir; her kayıtta `onek` (system/tools sha1 özeti) cache kaçağı teşhisi için; durum dosyası `%TEMP%\claude-auto\<session_id>.json` → `proxy/statusline.mjs`. `proxy/claude-auto.ps1` her pencereye ayrı port/router açar, router üst süreci (`CLAUDE_AUTO_EBEVEYN`) ölünce kendini kapatır. Ortam değişkenleri: `PORT`, `UPSTREAM_URL`, `ROUTE_FROM`, `MODE`, `DOWNGRADE_MAX_TOKENS`, `ROUTER_LOG`, `CLAUDE_AUTO_DURUM`, `CLAUDE_AUTO_EBEVEYN`. Proxy yolunda Claude Code'un `modelUsage`/model göstergesi istemcinin *istediği* modeli gösterir; mod yolunda gerçek modeli gösterir.

## Doğrulananlar (2026-10-10/11, Claude Code v2.1.296, Claude Pro/OAuth)

- **Mod:** `claude -p --plugin-dir <repo>` ile kolay prompt → giden istek `claude-haiku-5-5`/`medium`, yanıt Haiku, Claude Code'un `modelUsage`'ı da `claude-haiku-5-5`; skor 37 prompt → `claude-sonnet-5-5`/`high`. (Spike gözlemci olarak, gövdeye dokunmadan.) `claude plugin validate .` geçiyor.
- Proxy: `Authorization: Bearer` + `anthropic-beta: ...oauth-2025-04-20...` aynen iletilince istek 200; gövde yeniden yazımı kabul edilir. `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1` ile `x-claude-code-request-class: main` geliyor. Mutasyon kontrolü: iptal, akış kopması, ReDoS ve üst süreç izleme düzeltmeleri geri alınınca ilgili testler kırılıyor.
- İnteraktif (proxy, stock-tracker-v2): aynı oturumda haiku → sonnet-medium → sonnet-high → opus-medium → opus-high geçişleri statusline'da göründü, hiç `geri_donus` yok (çok turlu thinking blokları sorun çıkarmadı).
- Cache: aynı model içinde okuma oranı %82–92; effort değişimi cache'i bozmuyor. Her modele ilk geçişte bağlamın tamamı yeniden yazılıyor (haiku 277k, sonnet 314k, opus 354k); taban bağlamın ~189k'sı MCP araç tanımları. Cache yazma okumadan ~12,5 kat pahalı (büyük bağlamda bir geçiş ≈ 12 normal tur). Kullanıcı geçiş kurallarını ve MCP'leri şimdilik böyle bırakmayı seçti (2026-10-11). Açıklanamayan kaçak: `<task-notification>` turunda aynı model/effort ile 371k yeniden yazıldı; proxy'de `onek` tanısı bundan sonra eklendi.

## Riskler ve doğrulanmayanlar

- Mod: yalnızca `claude -p` ile doğrulandı; interaktif oturumda `$.ui.status` görünümü, çok turlu geçiş ve `--resume` denenmedi. Yeniden yazılan istek reddedilirse (400) mod'da proxy'deki gibi geri dönüş yok. Mod API'si "EARLY ACCESS" (sürümler arasında değişebilir).
- Proxy: abonelik OAuth'u ile gövde yeniden yazmanın kullanım koşullarına uygunluğu belirsiz (protokol dokümanı gövdeyi değiştirmemeyi öneriyor). Mod belgelenmiş eklenti API'sini kullandığı için bu gri alan mod'da büyük ölçüde yok.
- Skorlayıcı kural tabanlı, gerçek kullanımla kalibre edilmedi. "tasarım" kelimesi UI işlerinde de ağır sayılır.
- Oturum başında Claude Code'un 79 token'lık `auxiliary` isteği ara sıra 429 alıyor (proxy ona dokunmuyor; proxy'siz karşılaştırılmadı).

## Elenen yaklaşımlar (kısa)

- **Hook + skill:** `UserPromptSubmit` hook'u model/effort değiştiremez. Skill frontmatter `model` override'ı ana modeli değiştirmiyor ([model-config](https://code.claude.com/docs/en/model-config): "Claude Code ignores the override …"); arayüz yine de `claude-opus-5-5` etiketi gösteriyor (yanıltıcı). Prototip `9075d5e` commit'inde.
- **MCP:** modele araç verir, isteğin modelini değiştiremez.
- **OmniRoute / CLIProxyAPI:** prompt zorluğuna göre değil maliyet/kota/sağlığa göre sağlayıcılar arası seçer; Claude effort yönetmez; abonelik tokenını üçüncü tarafa verir. Yalnızca OmniRoute'un zorluk skoru fikri alındı (`open-sse/services/specificityRules.ts`).
- **Subagent devri:** ana model değişmez.

## İşler bitince değinilecek (bu projenin konusu değil)

- **Kapanış hook'u (`SessionEnd`/`Stop`):** Kullanıcı daha önce bir tane yaptığını söylüyor, ama 2026-10-10'da `~/.claude/settings.json` içinde yok; eklentilerde veya başka bir katmanda olabilir, kontrol edilmedi.
- **Bağlam boyutu:** taban bağlam ≈ 280k token (~189k MCP araçları); kullanılmayan MCP sunucularını kapatmak her turu ve her model geçişini ucuzlatır.

## Sıradaki işler

1. Mod'u interaktif oturumda doğrula (statusline, çok turlu geçiş); sonra proxy'yi emekliye ayırma kararını kullanıcıyla ver.
2. Gerçek kullanımla skor ağırlıklarını ve `ESLEME`/effort eşiklerini kalibre et (mod'da kalıcı log yok; gerekirse `MODE=log` proxy ya da spike gözlemci).
3. İstenirse mod'u kalıcı kur (`.claude-plugin/marketplace.json` + `claude plugin marketplace add <repo>` + `/plugin install`), böylece `--plugin-dir` gerekmez.
