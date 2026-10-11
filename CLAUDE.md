# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Amaç

Claude Code'un girilen prompt'a göre modeli ve effort seviyesini otomatik seçmesini sağlamak. Kullanıcı Claude aboneliği (OAuth) kullanıyor, API key değil.

Repo kökü bir Claude Code eklentisi (mod): `auto-model-effort`. `turn.step` kancasıyla ana konuşmanın her model isteğinin model/effort'unu Claude Code'un içinde değiştirir. Kullanıcı kapsamında kalıcı kurulu (2026-10-11): kökteki `.claude-plugin/marketplace.json` (`anqarium`) yerel marketplace olarak eklendi ve eklenti bu klasörden okunur; kod değişikliği açık oturumda `/reload-plugins` ile yansır. Düz `claude` yeterli; oturum hangi modelde açılırsa açılsın (`/model` dahil) yönlendirir. Durdurmak için `/auto kapat` (yalnızca o oturum; yeni oturum açık başlar).

## Komutlar

Bağımlılık yok (yalnızca Node ≥ 22, yerleşik modüller). Windows/PowerShell birincil ortam.

```
node --test test/*.test.mjs                       # tüm testler
node --test --test-name-pattern "effort" test/secim.test.mjs   # tek test
claude plugin validate .                          # manifest, marketplace ve hooks modülünü doğrular
claude plugin list                                # auto-model-effort@anqarium: "Read from: <bu klasör>"; token-weather@anqarium (GitHub'dan kopya)
claude plugin marketplace update anqarium         # marketplace.json değişince
```

Gerçek API ile doğrulama: `claude -p "<prompt>" --output-format json` → `modelUsage` gerçek modeli gösterir (mod Claude Code'un içinde çalıştığı için istemci gerçek modeli bilir). Giden isteğin `output_config.effort`'unu görmek için gözlemci: `node tools/spike.mjs` arka planda, sonra `ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude -p ...`; `tools/spike.log`'da `govde.model` / `govde.output_config.effort` (gövdeye dokunmaz). Bu sırada tool search kapanır, bağlam büyür (aşağıda). `claude -p "/auto-log"` PowerShell'den çalıştırılmalı: Git Bash `/auto-log`'u bir Windows yoluna çevirir.

`anqarium` marketplace'i (`.claude-plugin/marketplace.json`) iki eklenti listeler: `auto-model-effort` (`"./"`, yerel klasörden okunur) ve kullanıcının diğer mod'u `token-weather` (GitHub kaynağı `Anqarium/token-weather`, private; kurulum repodan kopya alır, kaynak klasörü `~/.claude/mods/token-weather`). İki marketplace aynı adı taşıyamaz; kullanıcı eklentilerinin hepsinin `anqarium` altında görünmesini istiyor. `claude-auto` sarmalayıcısı ve profil fonksiyonu 2026-10-11'de kaldırıldı (mod her modelde çalıştığı için gereksizdi); kullanıcının PowerShell profilindeki `omni` fonksiyonu kullanıcınındır, dokunma.

## Mimari

Mod Node'suz bir ortamda çalışır (DOM ve `node:` modülleri yok), yalnızca eklenti klasöründeki dosyaları `import` ile alabilir. Bu yüzden mantık Node'da test edilebilen saf modüllerde, mod kodu ince:

- `lib/skor.mjs` — `skorla(prompt)`: 0–100 zorluk skoru. OmniRoute'un `specificityRules` fikrinden uyarlandı: kategori başına tavanlı kural puanları (kod, matematik, **agir** = mimari/tasarım/kök neden/güvenlik açığı gibi tek başına zor işaretleri, akıl yürütme, ayrıntı, alan) ve kolay-işaret cezası. Kalıplar Türkçe+İngilizce. `kok()` kelime başında Unicode sınır + sonda ek toleransı, `tam()` iki uçta sınır (kolay kelimeleri için: "bul" → "bulut" eşleşmesin). JS `\b` ASCII bilir, Türkçe harfle başlayan kelimeleri kaçırır. Kökler ünsüz yumuşamasından önce kesilir (açık/açığı → "açı"). Regex'ler yalnızca ilk 4000 karaktere uygulanır (dosya yolu regex'i uzun girdide karesel yavaşlar). Kolay cezası ağır/alan sinyali varsa uygulanmaz.
- `lib/secim.mjs` — `secimYap(metin, {onceki, istemciModeli, baglamTokeni, dusurmeSiniri})`. Model seviyeye göre (`ESLEME`): trivial/simple/moderate → sonnet, complex/expert → opus; yalnızca açık kolay işaretli trivial → haiku (`KOLAY_ESLEME`); kanıtsız prompt ucuza inmez (yanlış ucuz model daha zararlı). Effort skora göre ve model başına (`effortBul`, `YUKSEK_EFFORT_ESIGI`): medium her modelin varsayılanı olduğu için geniş tutulur (kullanıcı tercihi): haiku hep medium, sonnet > 30 high, opus > 75 high, low yok. Sinyalsiz, 25 karakterden kısa prompt ("devam et") önceki kararı sürdürür. Histerezis: konuşma tahmini > sınır ise model düşürülmez; ilk kararda taban istemcinin modeli. Effort histerezisten sonra, çalışacak modelin eşiğine göre.
- `lib/gorunum.mjs` — `etiket(d)`: prompt satırının sağındaki mod etiketi (`⚡ Opus 5.5 · medium · complex 49`); `logOzeti(kayitlar)`: `/auto-log` metni.
- `hooks/register.ts` (+ `hooks/hooks.json`, `.claude-plugin/plugin.json`):
  - `turn.start` kullanıcının prompt metnini verir; prompt'suz turda (arka plan ajanı bildirimi, devam) metin boştur ve önceki karar sürer. Karar `secimYap` ile, bağlam tahmini `$.session.messages()`'tan.
  - `turn.step` her model isteğinde çalışır: `agentId` varsa (alt ajan) dokunmaz; `/auto kapat` ile kapatıldıysa dokunmaz (etiket `auto kapalı`, logda `atlandi: kapali`); aksi hâlde oturum modeli ne olursa olsun `next({ ...e, model, effort })`. Eskiden yalnızca sonnet oturumu yönlendiriliyordu ve `/model` kaçış yoluydu; kullanıcı her zaman çalışmasını istedi (2026-10-11), kaçış yolu `/auto` komutu oldu (`autoKomutu`: argümansız aç/kapat, `ac|aç|on`, `kapat|off`).
  - Geri dönüş: yeniden yazılan istekte hiç parça gelmez, `usage` ve `stopReason` null ve `next.signal` iptal değilse (kullanıcı Esc'e basmadıysa) istek oturumun kendi modeliyle bir kez daha gönderilir ve o prompt pasifleşir (`next()` her çağrıda alttakini baştan çalıştırır).
  - Gösterim: `ui.render` `SessionMode` kancası, prompt satırının sağındaki soluk mod etiketlerine (`modes`) metin ekler; değişince `$.ui.invalidate('ui.render')`. İki katman: kalıcı etiket (`etiket()`: son karar ya da `auto kapalı`) ve onun yerine `BILDIRIM_MS` (4 sn) görünen geçici bildirim (`durumBildirimi()`: `⚡ auto açık · /auto ile kapat` / `auto kapalı · /auto ile aç`); bildirim session.start'ta (açılış ve `/reload-plugins`) ve `/auto` sonrası, `$.clock.after` ile kalkar (hook bittikten sonra çalışan zamanlayıcı; `$.clock.sleep` hook bütçesini yer, kullanılmaz). `$.ui.status` bilerek kullanılmaz: Claude Code onun başına `⚠<eklenti adı>:` ekler (session.start'ta eski sürümden kalanı temizlemek için yalnızca `$.ui.status(undefined)`). Gerçek model yanıtın `usage.model`'inden. Doğrulayıcı kuralı: `$` yalnızca dosyanın üst düzeyinde tanımlı fonksiyonlara verilebilir (`register` içindeki bir const fonksiyona değil); bu yüzden `goster` ve `etiketMetni` modül düzeyinde.
  - Log: her ana model isteği `$.store`'da `kararlar` anahtarına (son 2000; model, effort, seviye, skor, sebep, gerçek model, cache_yazma/okuma, geri_donus); `/auto-log` komutu özetler. `$.fs.write` dosyanın tamamını yazdığı için dosya logu yok.
- Mod API'sinin tipleri: plugin-authoring skill'inin `types/claude-code.d.ts`'i (`'turn.step'`, `TurnStepInput`, `TurnStepResult`, `HookStream`). Engine mod yüklenince `.claude-plugin/types/` ve kökte `tsconfig.json` yazar (ikisi de gitignore'da). Test kiti (`claude plugin test`) `turn.step`'i tetikleyemez; bu yüzden mantık `test/*.test.mjs` ile Node'da test edilir. Eklenti adı `claude-` ile başlayamaz (Anthropic'e ayrılmış). Mod API'si "EARLY ACCESS": Claude Code sürümleriyle değişebilir.

## Doğrulananlar (2026-10-10/11, Claude Code v2.1.296, Claude Pro/OAuth)

- Kurulu mod, düz `claude -p` ile: kolay prompt → giden istek `claude-haiku-5-5`/`medium`, yanıt Haiku, `modelUsage` `claude-haiku-5-5`; skor 37 → `claude-sonnet-5-5`/`high` (spike gözlemciyle). İnteraktif: haiku → sonnet geçişi görüldü; `/auto-log` gerçek kayıtları gösterdi; `SessionMode` etiketi `/reload-plugins` sonrası prompt satırının sağında öneksiz göründü (`⚡ Sonnet 5.5 · medium · trivial 0`).
- **Tool search ve base URL:** Claude Code, `ANTHROPIC_BASE_URL` birinci taraf olmayan bir sunucuyu gösterince MCP tool search'ü kapatıp tüm MCP araçlarını baştan yükler ([mcp](https://code.claude.com/docs/en/mcp), "Configure tool search"). Eski proxy yolunda taban bağlam ~280k (189k MCP araçları) idi; mod ile ~68k.
- Cache: aynı model içinde okuma oranı %82–92; effort değişimi cache'i bozmuyor. Her modele ilk geçişte bağlamın tamamı yeniden yazılır; cache yazma okumadan ~12,5 kat pahalı. Kullanıcı geçiş kurallarını böyle bırakmayı seçti (2026-10-11).
- Çok turlu model geçişi (haiku → opus, thinking blokları dahil) API tarafından reddedilmedi (proxy döneminde, interaktif).

## Riskler ve doğrulanmayanlar

- Geri dönüş yolu gerçek bir API reddiyle tetiklenip denenmedi. Mod'da opus'a geçiş ve `--resume` interaktifte henüz denenmedi.
- Skorlayıcı kural tabanlı, gerçek kullanımla kalibre edilmedi. "tasarım" kelimesi UI işlerinde de ağır sayılır.

## Geçmiş ve elenen yaklaşımlar (kısa)

- **Proxy (2026-10-11'de silindi):** `ANTHROPIC_BASE_URL` ile yerel router istek gövdesindeki `model` ve `output_config.effort`'u yeniden yazıyordu; abonelik OAuth başlıkları aynen iletilince çalışıyordu. Sorunları: tool search'ü kapatıp bağlamı 4 kat şişirmesi, Claude Code'un gerçek modeli bilmemesi, ToS gri alanı. Kod git geçmişinde (`5abccb7` ve öncesi). Proxy döneminin karar/cache logu `tools/router-proxy-donemi.log` (git dışı).
- **Hook + skill:** `UserPromptSubmit` hook'u model/effort değiştiremez. Skill frontmatter `model` override'ı ana modeli değiştirmiyor ([model-config](https://code.claude.com/docs/en/model-config): "Claude Code ignores the override …"); arayüz yine de `claude-opus-5-5` etiketi gösteriyor (yanıltıcı). Prototip `9075d5e` commit'inde.
- **MCP:** modele araç verir, isteğin modelini değiştiremez.
- **Subagent devri** (`gorev-kolay/orta/zor` + global `CLAUDE.md` "Model Yönlendirmesi"): ana model değişmez, nadir kullanılıyordu; 2026-10-11'de kaldırıldı, ajan dosyaları `~/.claude/agents-yedek-20261011-132617/`.
- **OmniRoute / CLIProxyAPI:** prompt zorluğuna göre değil maliyet/kota/sağlığa göre sağlayıcılar arası seçer; abonelik tokenını üçüncü tarafa verir. Yalnızca OmniRoute'un zorluk skoru fikri alındı. Kullanıcının `settings.json`'undaki eski CPA env kalıntıları 2026-10-11'de kaldırıldı (yedek `~/.claude/settings.json.yedek-20261011-171206`).

## İşler bitince değinilecek (bu projenin konusu değil)

- **Kapanış hook'u (`SessionEnd`/`Stop`):** Kullanıcı daha önce bir tane yaptığını söylüyor, ama 2026-10-10'da `~/.claude/settings.json` içinde yoktu; eklentilerde veya başka bir katmanda olabilir, kontrol edilmedi.

## Sıradaki işler

1. Gerçek kullanımla skor ağırlıklarını ve `ESLEME`/effort eşiklerini kalibre et (`/auto-log`).
