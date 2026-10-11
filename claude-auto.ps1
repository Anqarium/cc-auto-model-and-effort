# claude'u auto-model-effort mod'u yüklü olarak çalıştırır: her prompt'ta model ve effort otomatik seçilir.
# Mod Claude Code'un kendi eklenti API'sini (turn.step) kullanır; proxy, port veya arka plan süreci yoktur.
# (Proxy tabanlı eski yol: proxy\claude-auto.ps1)
# Kullanım: .\claude-auto.ps1 [claude argümanları]

# Bilerek param() bloğu yok: [Parameter] betiği "gelişmiş" yapar ve PowerShell `-p` gibi claude
# bayraklarını ortak parametre öneki (-ProgressAction) sanıp reddeder. $args hepsini olduğu gibi alır.
$ClaudeArgs = @($args)

# Mod yalnızca sonnet oturumunu yönlendirir; kullanıcı model vermediyse sonnet ile başla.
if (-not ($ClaudeArgs | Where-Object { $_ -like '--model*' })) { $ClaudeArgs = @('--model', 'sonnet') + $ClaudeArgs }

& claude --plugin-dir $PSScriptRoot @ClaudeArgs
