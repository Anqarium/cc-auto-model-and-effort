# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Amaç

Claude Code'un girilen prompt'a göre modeli ve effort seviyesini otomatik seçmesini sağlamak. Önceki subagent denemesi (`gorev-kolay/orta/zor`) çok nadir kullanıldığı için beğenilmedi. Kullanıcı Claude aboneliği (OAuth) kullanıyor, API key değil.

## Komutlar

Build/lint/test altyapısı yok. Hook'u elle denemek için:

```
printf '{"prompt":"bu fonksiyonu yeniden adlandır"}' | node .claude/hooks/oto-secim.mjs
```

Gerçek model kullanımını görmek için: `claude -p "<prompt>" --model sonnet --output-format json` çıktısındaki `modelUsage` alanına bak.

## Mevcut prototip (`.claude/`)

- `hooks/oto-secim.mjs`: `UserPromptSubmit` hook'u. Prompt'u kural tabanlı (uzunluk + anahtar kelime) olarak `kolay | orta | zor` diye sınıflandırır, `additionalContext` ile Claude'a ilgili skill'i çağırmasını söyler. Slash komutlarına dokunmaz. Kararları `.claude/oto-secim.jsonl` dosyasına loglar (gitignore'da).
- `skills/oto-kolay|orta|zor`: frontmatter'da `model`/`effort` taşır (haiku/low, sonnet/medium, opus/high).
- `settings.json`: hook'u bağlar.
- Skill'ler oturum başında yüklenir; oturum açıkken eklenen skill sonraki oturuma kadar tanınmaz.

**Test sonucu (`claude -p`):** Hook doğru sınıflandırdı ama zor bir prompt'ta `modelUsage` yalnızca Sonnet gösterdi; skill'in `model` override'ı ana turu değiştirmedi. Interaktif oturumda skill çağrıldı (`Launching skill`) ancak oturum modelinin değiştiği doğrulanmadı. Skill yaklaşımı henüz çalışır kabul edilmemeli.

**Tekrar test (`--output-format stream-json --verbose`, `--model` bayraklı ve bayraksız):** `Skill:oto-zor` gerçekten çağrıldı, ama skill'den sonraki asistan mesajı yine `claude-sonnet-5-5` idi. Yani `claude -p` modunda skill `model` override'ı uygulanmıyor; bayrak veya skill'lerin sonradan eklenmesi sebep değil. 

**İnteraktif test (v2.1.296, `claude --model sonnet`):** Skill çağrıldı ve arayüz `Successfully loaded skill · claude-opus-5-5` gösterdi; transkripte "You are powered by Opus 5.5" kimlik metni de eklendi. Ama skill'den sonraki asistan mesajı `claude-sonnet-5-5` olarak kaydedildi ve `cache_read_input_tokens` (62400) önceki Sonnet önekiyle birebir eşleşti; yani istek Sonnet'te kaldı (cache modele özeldir). Sonuç: skill `model` override'ı bu sürümde yalnızca etiket/kimlik metnini değiştiriyor, gerçek modeli değiştirmiyor. Hook + skill yolu bu hâliyle ana modeli değiştiremez. Transkriptler: `~/.claude/projects/<proje>/*.jsonl`, `message.model` ve `usage` alanları ölçüm için kullanılabilir.

## Doküman doğrulamasının bulguları (code.claude.com)

- Hook'lar model/effort değiştiremez; `UserPromptSubmit` yalnızca engelleyebilir veya `additionalContext` ekleyebilir. Hook'tan `/model` tetiklemek belgelenmemiş.
- Skill `model` override'ı yalnızca o tur için geçerlidir, sonraki prompt'ta oturum modeline dönülür.
- Subagent frontmatter'ında `model`/`effort` var; Agent aracında per-invocation `model` ve (fork olmayanlarda) `effort` parametresi var, kararı Claude verir.
- `ANTHROPIC_BASE_URL` gateway'i abonelikle çalışır ama `anthropic-beta` başlığı aynen iletilmelidir. Gövdedeki `model` alanını yeniden yazmak belgelenmemiştir; doküman gateway'in gövdeyi değiştirmemesini önerir. Abonelik + proxy kullanım koşulları doğrulanmadı.
- `opusplan` plan moduna bağlıdır, prompt'a bağlı değildir. `CLAUDE_CODE_EFFORT_LEVEL` ve `--effort` oturum düzeyindedir.

## Değerlendirilen dış projeler

- **CLIProxyAPI / EasyCLIProxyAPI** (router-for-me): Yerel proxy; OAuth ile kendi başına giriş yapıp tokenları tutar, model alias'ı + reasoning eşlemesi sunar. Prompt'a göre seçim yapmaz, alias'ı istemci seçer. Abonelik tokenını üçüncü tarafa vermek hesap riski taşıyabilir (şartlar doğrulanmadı).
- **OmniRoute** (diegosouzapw): Çok sağlayıcılı gateway; kurulup denendi, kullanılmayacağına karar verildi ve kaldırıldı. Yalnızca kaynak koddan fikir alınacak (kaynak: `open-sse/services/` altında GitHub'da). Dashboard'daki "Intelligent Auto" stratejisi, sağlayıcılar arası çok faktörlü skorlamadır (maliyet/gecikme/kota/sağlık/görev uyumu; "Mode Pack" ağırlık profilleri, keşif oranı, bütçe tavanı). Claude effort yönetmez.
  - **Alınacak parça `specificityDetector.ts` + `specificityRules.ts` + `complexityRouter.ts`:** prompt'tan 0–100 zorluk skoru çıkarır. Altı kural kategorisi ve tavanları: kod karmaşıklığı (25; kod bloğu×5, satır içi kod×0.5, dil kalıpları×2), matematik (20), akıl yürütme derinliği (20; bağlaç/adım kalıpları×2 + mesaj derinliği), bağlam boyutu (15; tahmini token = karakter/4), araç kullanımı (10; araç sayısına göre), alan terimi (10). Ek kurallar: konuşma derinliği, dosya referansları, hata bağlamı. Seviyeler: ≤5 trivial, ≤20 simple, ≤40 moderate, ≤65 complex, üstü expert → minimum tier free/free/cheap/cheap/premium. Araç kullanan istek en az "cheap" seviyesine yükseltilir. Güven skoru = dolu kategori oranı.
  - Kural tabanlı, senkron, I/O yok. Kalıplar İngilizce; Türkçe karşılıkları eklenmeli.
  - OmniRoute'taki ayrı `intentClassifier.ts` ise yalnızca anahtar kelime listesidir ve uzun süre sonuca hiç etki etmemiştir (iki sözlük eşleşmiyordu); aynı hataya düşme: sınıf etiketini gerçekten model/effort kararına bağla.

## Proxy spike (`proxy/spike.mjs`) — çalışıyor

Bağımlılıksız Node proxy'si, yalnızca `127.0.0.1`'e bağlanır. Çalıştırma: `node proxy/spike.mjs` (yeniden yazım için `REWRITE_FROM=<model> REWRITE_TO=<model> REWRITE_EFFORT=<seviye>`), istemci tarafı: `ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude ...` (yalnızca o süreç için; global ayara yazma). Log: `proxy/spike.log` (başlık adları ve gövde yapısı; token değeri ve mesaj içeriği yazılmaz).

Doğrulananlar (2026-10-10, v2.1.296, Claude Pro aboneliği/OAuth):
- Sadece iletme: `Authorization: Bearer` + `anthropic-beta: ...oauth-2025-04-20...` başlıkları aynen iletilince istek 200 döner; ek giriş/anahtar gerekmez. Başka yola giden istekler de (`HEAD /api/hello`) sorunsuz geçer.
- Gövde alanları: model = üst düzey `model`; effort = `output_config.effort`; ayrıca `thinking: {type:"adaptive"}`, `max_tokens`, `stream`, `tools` (221 adet), `system`, `messages`.
- Gövde yeniden yazımı **kabul ediliyor**: `model` → `claude-haiku-5-5` ve `output_config.effort` → `low` yazılınca Anthropic 200 döndü ve yanıt SSE `message_start` içinde `"model":"claude-haiku-5-5"` ile geldi (gerçek çalışan model).
- Dikkat: Claude Code'un `--output-format json` içindeki `modelUsage` ve statusline gibi istemci tarafı göstergeleri, istemcinin **istediği** modeli gösterir; proxy'nin değiştirdiğini yansıtmaz. Gerçeği görmek için proxy logundaki `yanit_modeli`'ne bak.
- Not: Fazladan istemci isteği tipi olarak arka plan (ör. başlık üretimi) haiku çağrıları da gelir; yeniden yazım yalnızca `REWRITE_FROM` ile eşleşen modelde yapılır.

Henüz doğrulanmayanlar / riskler: model değişince prompt cache'in yeniden kurulumunun maliyeti (cache modele özel; her geçişte tüm bağlam yeniden yazılır, abonelik kullanım limitine yansır); ajan döngüsünde (tool_result turları) aynı kullanıcı prompt'u için kararın sabit tutulması; abonelik OAuth'u ile bir yerel proxy kullanmanın kullanım koşullarına uygunluğu (doğrulanmadı).

## İşler bitince değinilecek (bu projenin konusu değil)

- **Kapanış hook'u (`SessionEnd`/`Stop`):** Kullanıcı daha önce bir tane yaptığını söylüyor, ama 2026-10-10'da `~/.claude/settings.json` (yalnızca `PreToolUse`/Agent ve `PostToolUse`/`git push`) ve proje `.claude/settings.json` (yalnızca `UserPromptSubmit`) içinde yok; interaktif oturum transkriptinde de `SessionEnd` kaydı yok. Eklentilerde (plugin) veya başka bir yapılandırma katmanında olabilir, orası kontrol edilmedi. İşler bitince nerede olduğunu bul ya da yeniden kur.

## Sıradaki seçenekler

Seçilen yön: proxy (spike başarılı). Hook + skill yolu ana modeli değiştirmediği için elendi; `.claude/` altındaki prototip artık yalnızca referans (her prompt'a gereksiz bir skill çağrısı ekler, proxy sınıflandırıcısı hazır olunca `settings.json`'dan kaldırılmalı).

1. Sınıflandırıcıyı proxy'ye taşı: istekteki **son kullanıcı metnini** (tool_result olmayan, gerçek prompt) çıkar, OmniRoute tarzı çok kategorili 0–100 zorluk skoru (Türkçe kalıplarla) ver, kolay/orta/zor ↔ haiku/sonnet/opus + effort eşlemesine bağla.
2. Aynı kullanıcı prompt'u için ajan döngüsündeki tüm isteklerde kararı sabit tut (konuşma/prompt özeti anahtarıyla önbellek); arka plan haiku isteklerine (araçsız/kısa) dokunma.
3. Cache maliyeti için histerezis: model değişiminin faydası, bağlamı yeniden yazma maliyetini aşmıyorsa mevcut modelde kal.
4. Karar logu + `claude`'u proxy ile başlatan bir sarmalayıcı (ör. `claude-auto`).
